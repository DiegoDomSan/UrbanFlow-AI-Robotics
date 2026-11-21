"""La red de drenaje simulada con SWMM, en un proceso aparte.

Usamos DOS simulaciones de la misma red a la vez:

    - La PLANTA: hace de red real. Aquí se pueden provocar averías (una válvula que se
      queda atascada, una tubería que se obstruye). Es lo que "miden los sensores".
    - El GEMELO DIGITAL: la misma red, siempre sana, con la misma lluvia y las mismas
      órdenes a las válvulas. Es lo que "debería pasar".

Comparando las dos sabemos si algo se ha roto (detector.py).

¿Por qué en procesos aparte? La librería de SWMM solo permite UNA simulación abierta
por proceso. Así que cada simulación vive en su propio proceso de Python y el programa
principal le habla por una "tubería" de mensajes (multiprocessing.Pipe): le manda
órdenes ("avanza 5 minutos con estas aperturas") y recibe las lecturas de los sensores.
"""
import multiprocessing as mp
import os
import sys
from datetime import timedelta
from pathlib import Path

CARPETA_DRENAJE = Path(__file__).resolve().parent.parent / "drainage-control"
CARPETA_TEMPORAL = Path(__file__).resolve().parent / "temporal"

# Sensores que tendría una red real
SENSORES_NIVEL = ["P1", "P2", "P1J", "P2J", "PJ3"]   # nivel en depósitos y pozos (m)
SENSORES_CAUDAL = ["1", "2", "8"]                     # caudalímetros: 2 válvulas y la salida (m³/s)
NODOS_QUE_PUEDEN_INUNDAR = ["P1", "P2", "P1J", "P2J", "PJ3"]


def _preparar_rutas():
    """Hace que este proceso encuentre los módulos de drainage-control."""
    os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    if str(CARPETA_DRENAJE) not in sys.path:
        sys.path.insert(0, str(CARPETA_DRENAJE))


def escribir_red_desde(lluvia, ruta, inicio):
    """Como escribir_red de entorno_ia.py, pero la simulación empieza en 'inicio'.
    Sirve para arrancar el gemelo desde un momento concreto (resincronizarlo)."""
    _preparar_rutas()
    from entorno_ia import escribir_red
    escribir_red(lluvia, ruta)
    texto = ruta.read_text()
    lineas = []
    for linea in texto.splitlines(keepends=True):
        clave = linea.split()[0] if linea.split() else ""
        if clave in ("START_DATE", "REPORT_START_DATE"):
            linea = f"{clave:<21}{inicio:%m/%d/%Y}\n"
        elif clave in ("START_TIME", "REPORT_START_TIME"):
            linea = f"{clave:<21}{inicio:%H:%M:%S}\n"
        lineas.append(linea)
    ruta.write_text("".join(lineas))


def _trabajador(conexion, ruta_inp, ruta_hotstart):
    """Lo que hace el proceso aparte: abre SWMM y obedece mensajes hasta que le digan 'cerrar'."""
    _preparar_rutas()
    from control_por_reglas import control_por_reglas
    from entorno_ia import DEPOSITOS, TUBERIA_SALIDA, UMBRAL_SALIDA, VALVULAS
    from pyswmm import Links, Nodes, Simulation

    sim = Simulation(str(ruta_inp))
    if ruta_hotstart:
        sim.use_hotstart(str(ruta_hotstart))   # empieza con el agua que tenía la planta
    sim.start()
    nodos, tuberias = Nodes(sim), Links(sim)
    averias = {}           # id -> datos de la avería activa
    apertura = [1.0, 1.0]  # última orden dada a cada válvula
    terminado = False

    def segundos():
        return (sim.current_time - sim.start_time).total_seconds()

    def lecturas():
        return {
            "niveles": {n: float(nodos[n].depth) for n in SENSORES_NIVEL},
            "caudales": {t: float(tuberias[t].flow) for t in SENSORES_CAUDAL},
            "volumen_depositos": {d: float(nodos[d].volume) for d in DEPOSITOS},
            "apertura_real": [float(tuberias[v].current_setting) for v in VALVULAS],
        }

    def aplicar(ordenes):
        """Manda las órdenes a las válvulas, salvo a las que están atascadas."""
        for i, valvula in enumerate(VALVULAS):
            atascada = next((a for a in averias.values()
                             if a["tipo"] == "valvula_atascada" and a["elemento"] == valvula), None)
            tuberias[valvula].target_setting = float(atascada["apertura"] if atascada else ordenes[i])

    while True:
        mensaje = conexion.recv()
        tipo = mensaje["tipo"]

        if tipo == "paso":
            # Avanza 'segundos' de simulación. Modos:
            #   fijo:       mantiene las aperturas que se le pasan (IA y sin control)
            #   reglas:     aplica el control por reglas en cada paso de SWMM
            #   reproducir: repite una lista de órdenes con su momento (lo usa el gemelo)
            modo = mensaje["modo"]
            fin = segundos() + mensaje["segundos"]
            ordenes_dadas = []
            exceso = 0.0
            inundacion = {n: 0.0 for n in NODOS_QUE_PUEDEN_INUNDAR}
            if modo == "fijo":
                apertura = list(mensaje["aperturas"])
            reproducir = list(mensaje.get("ordenes", []))
            anterior = segundos()
            while not terminado and segundos() < fin:
                if modo == "reglas":
                    sensores = {"caudal_salida": tuberias[TUBERIA_SALIDA].flow,
                                "nivel_P1": nodos["P1"].depth, "nivel_P2": nodos["P2"].depth}
                    apertura = control_por_reglas(sensores, apertura)
                    ordenes_dadas.append([segundos(), *apertura])
                elif modo == "reproducir":
                    while reproducir and reproducir[0][0] <= segundos() + 1e-6:
                        apertura = list(reproducir.pop(0)[1:])
                aplicar(apertura)
                if sim._model.swmm_step() <= 0:
                    terminado = True
                    break
                dt = segundos() - anterior
                anterior = segundos()
                exceso += max(0.0, tuberias[TUBERIA_SALIDA].flow - UMBRAL_SALIDA) * dt
                for n in NODOS_QUE_PUEDEN_INUNDAR:
                    inundacion[n] += nodos[n].flooding * dt
            if modo == "fijo":
                ordenes_dadas = [[anterior, *apertura]]
            conexion.send({
                "segundos": segundos(),
                "fecha": sim.current_time.isoformat(),
                "terminado": terminado,
                "apertura_ordenada": list(apertura),
                "ordenes": ordenes_dadas,
                "exceso_m3": exceso,
                "inundacion_m3": inundacion,
                **lecturas(),
            })

        elif tipo == "averia":
            averia = dict(mensaje["averia"])
            if averia["tipo"] == "valvula_atascada":
                indice = VALVULAS.index(averia["elemento"])
                # Si no se dice en qué posición se atasca, se queda donde está ahora
                averia.setdefault("apertura", float(tuberias[averia["elemento"]].current_setting
                                                    or apertura[indice]))
            elif averia["tipo"] == "tuberia_obstruida":
                # La obstrucción deja pasar como máximo 'caudal_max' m³/s
                tuberias[averia["elemento"]].flow_limit = float(averia["caudal_max"])
            averias[averia["id"]] = averia
            conexion.send({"ok": True, "averia": averia})

        elif tipo == "reparar":
            averia = averias.pop(mensaje["id"], None)
            if averia and averia["tipo"] == "tuberia_obstruida":
                tuberias[averia["elemento"]].flow_limit = 0.0   # 0 = sin límite en SWMM
            conexion.send({"ok": averia is not None})

        elif tipo == "guardar_estado":
            sim.save_hotstart(str(mensaje["ruta"]))
            conexion.send({"ok": True, "fecha": sim.current_time.isoformat()})

        elif tipo == "cerrar":
            try:
                sim._model.swmm_end()
                sim._model.swmm_close()
            finally:
                conexion.send({"ok": True})
            return


class RedSimulada:
    """Mando a distancia de una simulación que corre en otro proceso."""

    _contador = 0

    def __init__(self, lluvia, nombre, inicio=None, ruta_hotstart=None):
        _preparar_rutas()
        from entorno_ia import INICIO_SIMULACION, escribir_red
        CARPETA_TEMPORAL.mkdir(parents=True, exist_ok=True)
        RedSimulada._contador += 1
        ruta = CARPETA_TEMPORAL / f"{nombre}_{os.getpid()}_{RedSimulada._contador}.inp"
        if inicio is None or inicio == INICIO_SIMULACION:
            escribir_red(lluvia, ruta)
        else:
            escribir_red_desde(lluvia, ruta, inicio)
        contexto = mp.get_context("spawn")
        self._conexion, extremo_hijo = contexto.Pipe()
        self._ruta = ruta
        self._proceso = contexto.Process(target=_trabajador, daemon=True,
                                         args=(extremo_hijo, str(ruta), ruta_hotstart))
        self._proceso.start()

    def _pedir(self, **mensaje):
        self._conexion.send(mensaje)
        return self._conexion.recv()

    def paso(self, segundos, modo, aperturas=None, ordenes=None):
        return self._pedir(tipo="paso", segundos=segundos, modo=modo,
                           aperturas=aperturas, ordenes=ordenes or [])

    def provocar_averia(self, averia):
        return self._pedir(tipo="averia", averia=averia)

    def reparar(self, id_averia):
        return self._pedir(tipo="reparar", id=id_averia)["ok"]

    def guardar_estado(self, ruta):
        return self._pedir(tipo="guardar_estado", ruta=str(ruta))

    def cerrar(self):
        if self._proceso.is_alive():
            try:
                self._pedir(tipo="cerrar")
            except (EOFError, BrokenPipeError):
                pass
            self._proceso.join(timeout=5)
        if self._proceso.is_alive():
            self._proceso.kill()
        for extension in (".inp", ".out", ".rpt"):   # borra los archivos temporales de SWMM
            self._ruta.with_suffix(extension).unlink(missing_ok=True)


def momento(inicio, segundos):
    return inicio + timedelta(seconds=segundos)
