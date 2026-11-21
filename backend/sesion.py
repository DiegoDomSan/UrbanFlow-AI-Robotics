"""Una sesión = una tormenta simulada de principio a fin, paso a paso (cada 5 minutos).

En cada paso:
    1. La estrategia elegida (sin control, reglas o IA) decide las válvulas.
    2. Avanzan 5 minutos la planta (con sus averías) y el gemelo digital (siempre sano).
    3. El detector compara las dos y lanza alertas si algo no cuadra.
    4. Se actualiza el agua en la calle y qué calles quedan cortadas.
    5. Se envían robots a las alertas y avanzan por el mapa.
    6. Se devuelve un "fotograma" (diccionario) con todo, que el servidor manda al navegador.
"""
import os

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OMP_NUM_THREADS", "1")

import sys
from datetime import datetime

import numpy as np

from ciudad import Ciudad
from detector import Detector, NOMBRES, anadir_ruido
from planta import CARPETA_DRENAJE, CARPETA_TEMPORAL, RedSimulada
from robots import Despacho

sys.path.insert(0, str(CARPETA_DRENAJE))
from entorno_ia import (HORAS_DESPUES_DE_LLOVER, HORAS_SIMULACION, UMBRAL_SALIDA,  # noqa: E402
                        construir_observacion, mover_valvulas, tormenta)

SEGUNDOS_POR_PASO = 300
UMBRAL_ALERTA_BARRANCO_M3 = 50   # m³ fuera del cauce para avisar (evita alertas por un pico de un minuto)
ESTRATEGIAS = {"sin_control": "Sin control", "reglas": "Reglas", "ia": "IA (PPO)"}
TIPOS_AVERIA = {
    "valvula_atascada": {"elementos": ["1", "2"], "nombre": "Válvula atascada"},
    "tuberia_obstruida": {"elementos": ["7", "9", "8"], "nombre": "Tubería obstruida"},
}

_agente = None   # la red neuronal se carga una sola vez (tarda un par de segundos)


def cargar_ia():
    global _agente
    if _agente is None:
        from evaluar_ia import cargar_agente
        _agente = cargar_agente()
    return _agente


def construir_lluvia(factor=1.0, duracion_h=8, separacion_h=None):
    lluvia = tormenta(factor=factor, duracion_h=duracion_h)
    if separacion_h is not None:
        lluvia = lluvia + tormenta(factor=factor, duracion_h=duracion_h, inicio_h=1 + duracion_h + separacion_h)
    return lluvia


class Sesion:
    def __init__(self, factor=1.0, duracion_h=8, separacion_h=None, estrategia="ia",
                 averias=None, despacho_automatico=True, semilla=0, ciudad=None):
        if estrategia not in ESTRATEGIAS:
            raise ValueError(f"Estrategia desconocida: {estrategia}. Opciones: {list(ESTRATEGIAS)}")
        self.estrategia = estrategia
        self.lluvia = construir_lluvia(factor, int(duracion_h), separacion_h)
        self.tormenta = {"factor": factor, "duracion_h": int(duracion_h), "separacion_h": separacion_h}
        ultima_hora = int(np.nonzero(self.lluvia)[0].max()) + 1
        self.horas_total = min(ultima_hora + HORAS_DESPUES_DE_LLOVER, HORAS_SIMULACION - 1)

        self.ciudad = ciudad or Ciudad()
        self.ciudad.charcos = {}
        self.detector = Detector(semilla)
        self.despacho = Despacho(self.ciudad)
        self.despacho_automatico = despacho_automatico
        self.rng = np.random.default_rng(semilla)

        self.planta = RedSimulada(self.lluvia, "planta")
        self.gemelo = RedSimulada(self.lluvia, "gemelo")
        if estrategia == "ia":
            self.agente, self.normalizacion = cargar_ia()

        self.averias_programadas = sorted(averias or [], key=lambda a: a.get("hora", 0))
        self.averias_activas = {}     # id -> avería que hay de verdad en la planta
        self._contador_averias = 0
        self.apertura = np.array([1.0, 1.0])
        self.ultima = None            # últimas lecturas de la planta
        self.hora = 0.0
        self.fecha = None
        self.exceso_total = self.desborde_total = 0.0
        self.pendientes = []          # (id_alerta, tarea) esperando un robot libre
        self.terminado = False

    # --- Averías -----------------------------------------------------------------------
    def provocar_averia(self, tipo, elemento, **opciones):
        if tipo not in TIPOS_AVERIA or elemento not in TIPOS_AVERIA[tipo]["elementos"]:
            raise ValueError(f"Avería no válida: {tipo} en {elemento}")
        self._contador_averias += 1
        averia = {"id": f"F{self._contador_averias}", "tipo": tipo, "elemento": elemento,
                  "hora": round(self.hora, 2), **opciones}
        if tipo == "tuberia_obstruida":
            averia.setdefault("caudal_max", 0.05)
        averia = self.planta.provocar_averia(averia)["averia"]
        self.averias_activas[averia["id"]] = averia
        return averia

    # --- Decisión de las válvulas ------------------------------------------------------
    def _decidir(self):
        """Devuelve (modo, aperturas) para la planta según la estrategia."""
        if self.estrategia == "sin_control":
            return "fijo", [1.0, 1.0]
        if self.estrategia == "reglas":
            return "reglas", None
        # IA: ve lo que miden los sensores de la planta (no el gemelo)
        niveles = [self.ultima["niveles"]["P1"], self.ultima["niveles"]["P2"]] if self.ultima else [0.0, 0.0]
        caudal = self.ultima["caudales"]["8"] if self.ultima else 0.0
        observacion = construir_observacion(*niveles, caudal, self.apertura, self.lluvia, self.hora)
        accion, _ = self.agente.predict(self.normalizacion.normalize_obs(observacion[None, :]), deterministic=True)
        self.apertura, _ = mover_valvulas(self.apertura, accion[0], niveles)
        return "fijo", [float(a) for a in self.apertura]

    # --- Gemelo ------------------------------------------------------------------------
    def _resincronizar_gemelo(self):
        """Tras una reparación, el gemelo vuelve a empezar desde el estado real de la planta."""
        ruta = CARPETA_TEMPORAL / f"estado_{os.getpid()}_{id(self)}.hsf"
        info = self.planta.guardar_estado(ruta)
        self.gemelo.cerrar()
        self.gemelo = RedSimulada(self.lluvia, "gemelo", inicio=datetime.fromisoformat(info["fecha"]),
                                  ruta_hotstart=str(ruta))
        self.detector.olvidar_sospechas()

    # --- Robots ------------------------------------------------------------------------
    def _asignar(self, id_alerta, tarea, cortadas, eventos):
        alerta = self.detector.alertas[id_alerta]
        if tarea == "inspeccion":
            decision = self.despacho.enviar_inspeccion(alerta, self.hora, cortadas)
        elif tarea == "reparacion":
            decision = self.despacho.enviar_reparacion(alerta, self.hora, cortadas)
        else:
            decision = self.despacho.enviar_vigilancia(alerta, self.hora)
        if decision["robot"] is None:
            if (id_alerta, tarea) not in self.pendientes:
                self.pendientes.append((id_alerta, tarea))
                self.detector.cambiar_estado(id_alerta, "en_espera", self.hora, decision["razonamiento"][-1])
        else:
            estado = {"inspeccion": "inspeccionando", "reparacion": "reparando", "vigilancia": "vigilando"}[tarea]
            self.detector.cambiar_estado(id_alerta, estado, self.hora,
                                         f"Se envía {decision['robot']}. " + " ".join(decision["razonamiento"]))
            eventos.append(f"{decision['robot']} sale hacia {alerta['nombre']} ({tarea}).")
        return decision

    def _al_terminar_trabajo(self, robot, cortadas, eventos, decisiones):
        alerta = self.detector.alertas.get(robot.mision)
        tarea = robot.tarea
        self.despacho.volver_a_base(robot, cortadas)
        if alerta is None:
            return
        if tarea == "inspeccion":
            averia = next((a for a in self.averias_activas.values() if a["elemento"] == alerta["elemento"]), None)
            if averia:
                texto = f"{robot.id} confirma la avería en {alerta['nombre']}."
                self.detector.cambiar_estado(alerta["id"], "confirmada", self.hora, texto)
                eventos.append(texto)
                decisiones.append(self._asignar(alerta["id"], "reparacion", cortadas, eventos))
            else:
                texto = f"{robot.id} no encuentra ninguna avería en {alerta['nombre']}: falsa alarma."
                self.detector.cambiar_estado(alerta["id"], "resuelta", self.hora, texto)
                eventos.append(texto)
        elif tarea == "reparacion":
            reparadas = [a for a in list(self.averias_activas.values()) if a["elemento"] == alerta["elemento"]]
            for averia in reparadas:
                self.planta.reparar(averia["id"])
                del self.averias_activas[averia["id"]]
            self._resincronizar_gemelo()
            texto = (f"{robot.id} repara {alerta['nombre']}. El gemelo digital se resincroniza con la red real."
                     if reparadas else f"{robot.id} no encuentra nada que reparar en {alerta['nombre']}.")
            self.detector.cambiar_estado(alerta["id"], "resuelta", self.hora, texto)
            eventos.append(texto)
        elif tarea == "vigilancia":
            zona = next((z for z in self.ciudad.zonas_inundadas() if z["nodo"] == alerta["elemento"]), None)
            if zona:
                texto = (f"{robot.id} mide la zona inundada junto a {alerta['nombre']}: "
                         f"radio {zona['radio_m']:.0f} m, unos {zona['volumen_m3']} m³ de agua.")
            else:
                texto = f"{robot.id} llega a {alerta['nombre']} y ya no hay agua en la calle."
            alerta["evidencia"]["zona"] = zona
            eventos.append(texto)
            self.detector.cambiar_estado(alerta["id"], "vigilando", self.hora, texto)

    # --- Un paso de 5 minutos ----------------------------------------------------------
    def paso(self):
        if self.terminado:
            return None
        eventos, decisiones = [], []

        # Averías programadas para esta hora
        while self.averias_programadas and self.averias_programadas[0].get("hora", 0) <= self.hora:
            programada = dict(self.averias_programadas.pop(0))
            programada.pop("hora", None)
            averia = self.provocar_averia(programada.pop("tipo"), programada.pop("elemento"), **programada)
            eventos.append(f"[Simulación] Se provoca: {TIPOS_AVERIA[averia['tipo']]['nombre']} en "
                           f"{NOMBRES[averia['elemento']]} (el sistema todavía no lo sabe).")

        modo, aperturas = self._decidir()
        real = self.planta.paso(SEGUNDOS_POR_PASO, modo, aperturas=aperturas)
        gemelo = self.gemelo.paso(SEGUNDOS_POR_PASO, "reproducir" if modo == "reglas" else "fijo",
                                  aperturas=aperturas, ordenes=real["ordenes"])
        if modo == "reglas":
            self.apertura = np.array(real["apertura_ordenada"])
        self.ultima = real
        self.hora = real["segundos"] / 3600
        self.fecha = real["fecha"]
        self.exceso_total += real["exceso_m3"]
        self.desborde_total += real["inundacion_m3"]["P1"] + real["inundacion_m3"]["P2"]

        # Detector (con sensores reales, que tienen ruido)
        medida = anadir_ruido(real, self.rng)
        nuevas = self.detector.analizar(medida, gemelo, real["inundacion_m3"], self.hora)
        for alerta in nuevas:
            eventos.append(f"ALERTA {alerta['id']}: {alerta['titulo']}")

        # Agua en la calle
        self.ciudad.actualizar_charcos(real["inundacion_m3"], real["exceso_m3"], SEGUNDOS_POR_PASO)
        zonas = self.ciudad.zonas_inundadas()
        cortadas = self.ciudad.calles_cortadas(zonas)
        if self.ciudad.charcos.get("O", 0) > UMBRAL_ALERTA_BARRANCO_M3 and not self.detector.alerta_activa("inundacion", "O"):
            alerta = self.detector._nueva_alerta(
                "inundacion", "O", self.hora, "El barranco se desborda junto a la salida",
                f"Sale más agua de la que admite el cauce ({real['caudales']['8']:.2f} m³/s, límite {UMBRAL_SALIDA}).",
                {"sensor": "caudal_salida", "medido": round(real["caudales"]["8"], 3),
                 "esperado": UMBRAL_SALIDA, "unidad": "m³/s"}, "alta")
            nuevas.append(alerta)
            eventos.append(f"ALERTA {alerta['id']}: {alerta['titulo']}")
        # Las inundaciones se dan por resueltas cuando la calle se seca
        for alerta in self.detector.alertas.values():
            if alerta["tipo"] == "inundacion" and alerta["estado"] != "resuelta" \
                    and self.ciudad.charcos.get(alerta["elemento"], 0) < 1:
                self.detector.cambiar_estado(alerta["id"], "resuelta", self.hora, "La calle ya está seca.")

        # Robots: primero lo que estaba esperando, luego las alertas nuevas
        if self.despacho_automatico:
            for id_alerta, tarea in list(self.pendientes):
                if self.detector.alertas[id_alerta]["estado"] == "resuelta":
                    self.pendientes.remove((id_alerta, tarea))
                    continue
                decision = self._asignar(id_alerta, tarea, cortadas, eventos)
                if decision["robot"] is not None:
                    self.pendientes.remove((id_alerta, tarea))
                    decisiones.append(decision)
            for alerta in nuevas:
                tarea = "vigilancia" if alerta["tipo"] == "inundacion" else "inspeccion"
                decisiones.append(self._asignar(alerta["id"], tarea, cortadas, eventos))

        for robot in self.despacho.robots:
            if robot.estado == "esperando":
                self.despacho.volver_a_base(robot, cortadas)
        for robot, evento in self.despacho.avanzar(SEGUNDOS_POR_PASO):
            if evento == "llego":
                eventos.append(f"{robot.id} llega a su destino ({robot.tarea}).")
            elif evento == "termino":
                self._al_terminar_trabajo(robot, cortadas, eventos, decisiones)

        self.terminado = real["terminado"] or self.hora >= self.horas_total
        return self._fotograma(real, gemelo, medida, zonas, cortadas, eventos, decisiones)

    def _fotograma(self, real, gemelo, medida, zonas, cortadas, eventos, decisiones):
        hora_entera = int(self.hora)
        return {
            "tipo": "paso",
            "hora": round(self.hora, 3),
            "fecha_simulada": self.fecha,
            "progreso": round(min(1.0, self.hora / self.horas_total), 3),
            "lluvia_mm_h": float(self.lluvia[hora_entera]) if hora_entera < len(self.lluvia) else 0.0,
            "estrategia": self.estrategia,
            "red": {
                "niveles_m": {k: round(v, 3) for k, v in medida["niveles"].items()},
                "caudales_m3s": {k: round(v, 4) for k, v in medida["caudales"].items()},
                "volumen_depositos_m3": {k: round(v, 1) for k, v in real["volumen_depositos"].items()},
                "apertura_ordenada": [round(a, 4) for a in real["apertura_ordenada"]],
                "apertura_real": [round(a, 4) for a in real["apertura_real"]],
                "gemelo": {
                    "niveles_m": {k: round(v, 3) for k, v in gemelo["niveles"].items()},
                    "caudales_m3s": {k: round(v, 4) for k, v in gemelo["caudales"].items()},
                },
            },
            "salida": {"caudal_m3s": round(real["caudales"]["8"], 4), "umbral_m3s": UMBRAL_SALIDA,
                       "por_encima": real["caudales"]["8"] > UMBRAL_SALIDA},
            "inundacion": {
                "zonas": zonas,
                "calles_cortadas": [[list(a), list(b)] for a, b in cortadas],
            },
            "alertas": list(self.detector.alertas.values()),
            "robots": self.despacho.estado_para_enviar(),
            "decisiones": decisiones,
            "eventos": eventos,
            "metricas": {"exceso_total_m3": round(self.exceso_total), "desborde_total_m3": round(self.desborde_total)},
            "terminado": self.terminado,
        }

    def cerrar(self):
        self.planta.cerrar()
        self.gemelo.cerrar()
