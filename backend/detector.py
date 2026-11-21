"""Detector de averías: compara lo que miden los sensores (planta) con lo que debería
pasar (gemelo digital sano) y, si no cuadra, dice QUÉ se ha roto y DÓNDE.

Cómo decide, paso a paso (cada 5 minutos):
    1. Calcula la diferencia ("residuo") entre planta y gemelo en cada sensor.
    2. Un residuo cuenta como "sospechoso" solo si es mayor que el ruido normal de un
       sensor real. Por eso a las lecturas de la planta se les añade un poco de ruido.
    3. Para no dar falsas alarmas, el residuo tiene que repetirse 2 pasos seguidos (10 min).
    4. El patrón de residuos indica el tipo de avería:
         - Un pozo (P1J, P2J, PJ3) más lleno de lo normal = el agua no sale de él:
           la tubería que va a continuación está OBSTRUIDA.
         - Por una válvula pasa menos (o más) agua de la que corresponde a su orden y no
           hay ningún pozo atascado detrás: la válvula está ATASCADA.
    5. Aparte, si sale agua a la calle por un pozo o un depósito, avisa de INUNDACIÓN,
       sea o no por una avería.
"""
import numpy as np

RUIDO_NIVEL = 0.01      # m: error típico de un sensor de nivel
RUIDO_CAUDAL = 0.01     # m³/s: error típico de un caudalímetro
PASOS_PARA_CONFIRMAR = 2

# Qué tubería sale de cada pozo, y qué válvula alimenta cada pozo
TUBERIA_DESPUES_DE = {"P1J": "7", "P2J": "9", "PJ3": "8"}
VALVULA_DE = {"1": ("P1", "P1J"), "2": ("P2", "P2J")}

NOMBRES = {
    "1": "Válvula 1 (depósito P1)", "2": "Válvula 2 (depósito P2)",
    "7": "Tubería 7 (P1J → PJ3)", "9": "Tubería 9 (P2J → PJ3)", "8": "Tubería 8 (colector a la salida)",
    "P1": "Depósito P1", "P2": "Depósito P2", "P1J": "Pozo P1J", "P2J": "Pozo P2J", "PJ3": "Pozo PJ3",
    "O": "Salida al barranco",
}


def anadir_ruido(lecturas, rng):
    """Simula sensores reales: cada lectura lleva un pequeño error aleatorio."""
    return {
        "niveles": {k: max(0.0, v + rng.normal(0, RUIDO_NIVEL / 2)) for k, v in lecturas["niveles"].items()},
        "caudales": {k: max(0.0, v + rng.normal(0, RUIDO_CAUDAL / 2)) for k, v in lecturas["caudales"].items()},
    }


class Detector:
    def __init__(self, semilla=0):
        self.rng = np.random.default_rng(semilla)
        self.sospechas = {}     # clave del síntoma -> pasos seguidos que se ha visto
        self.alertas = {}       # id -> alerta
        self._siguiente = 1

    def _nueva_alerta(self, tipo, elemento, hora, titulo, explicacion, evidencia, severidad):
        id_alerta = f"A{self._siguiente}"
        self._siguiente += 1
        alerta = {
            "id": id_alerta, "tipo": tipo, "elemento": elemento, "nombre": NOMBRES.get(elemento, elemento),
            "titulo": titulo, "explicacion": explicacion, "evidencia": evidencia,
            "severidad": severidad, "estado": "detectada", "hora_deteccion": round(hora, 2),
            "historial": [{"hora": round(hora, 2), "estado": "detectada", "texto": explicacion}],
        }
        self.alertas[id_alerta] = alerta
        return alerta

    def alerta_activa(self, tipo, elemento):
        return next((a for a in self.alertas.values()
                     if a["tipo"] == tipo and a["elemento"] == elemento and a["estado"] != "resuelta"), None)

    def _confirmado(self, clave, ocurre):
        """Cuenta cuántos pasos seguidos se ve un síntoma; True cuando llega al mínimo."""
        self.sospechas[clave] = self.sospechas.get(clave, 0) + 1 if ocurre else 0
        return self.sospechas[clave] >= PASOS_PARA_CONFIRMAR

    def analizar(self, medida, gemelo, inundacion_m3, hora):
        """medida: lecturas con ruido de la planta; gemelo: lecturas del gemelo.
        Devuelve las alertas NUEVAS de este paso."""
        nuevas = []
        nivel_m, nivel_g = medida["niveles"], gemelo["niveles"]
        caudal_m, caudal_g = medida["caudales"], gemelo["caudales"]

        # 1) Tuberías obstruidas: el pozo de antes se llena más de lo que debería
        pozos_atascados = set()
        for pozo, tuberia in TUBERIA_DESPUES_DE.items():
            exceso_nivel = nivel_m[pozo] - nivel_g[pozo]
            ocurre = exceso_nivel > max(0.15, 3 * RUIDO_NIVEL)
            if ocurre:
                pozos_atascados.add(pozo)
            if self._confirmado(("obstruccion", tuberia), ocurre) and not self.alerta_activa("tuberia_obstruida", tuberia):
                nuevas.append(self._nueva_alerta(
                    "tuberia_obstruida", tuberia, hora,
                    f"Posible obstrucción en la {NOMBRES[tuberia]}",
                    f"El pozo {pozo} tiene {nivel_m[pozo]:.2f} m de agua y debería tener "
                    f"{nivel_g[pozo]:.2f} m: el agua no consigue salir por la tubería {tuberia}.",
                    {"sensor": f"nivel_{pozo}", "medido": round(nivel_m[pozo], 3),
                     "esperado": round(nivel_g[pozo], 3), "unidad": "m"},
                    "alta"))

        # Si PJ3 está atascado, también se llenan P1J y P2J: la causa es la tubería 8
        if "PJ3" in pozos_atascados:
            pozos_atascados |= {"P1J", "P2J"}

        # 2) Válvulas atascadas: pasa un caudal distinto al que corresponde a la orden
        for valvula, (deposito, pozo) in VALVULA_DE.items():
            diferencia = caudal_m[valvula] - caudal_g[valvula]
            limite = max(4 * RUIDO_CAUDAL, 0.2 * caudal_g[valvula])
            ocurre = abs(diferencia) > limite and pozo not in pozos_atascados
            if self._confirmado(("valvula", valvula), ocurre) and not self.alerta_activa("valvula_atascada", valvula):
                cerrada = diferencia < 0
                nuevas.append(self._nueva_alerta(
                    "valvula_atascada", valvula, hora,
                    f"La {NOMBRES[valvula]} no responde ({'se queda cerrada' if cerrada else 'se queda abierta'})",
                    f"Por la válvula {valvula} pasan {caudal_m[valvula]:.3f} m³/s, pero con la orden "
                    f"dada deberían pasar {caudal_g[valvula]:.3f} m³/s. El pozo {pozo} está normal, "
                    f"así que el problema está en la propia válvula.",
                    {"sensor": f"caudal_valvula_{valvula}", "medido": round(caudal_m[valvula], 3),
                     "esperado": round(caudal_g[valvula], 3), "unidad": "m³/s"},
                    "alta" if cerrada else "media"))

        # 3) Agua en la calle (por avería o porque la red no da más de sí)
        for nodo, volumen in inundacion_m3.items():
            if volumen > 1.0 and not self.alerta_activa("inundacion", nodo):
                nuevas.append(self._nueva_alerta(
                    "inundacion", nodo, hora, f"Sale agua a la calle en {NOMBRES.get(nodo, nodo)}",
                    f"En los últimos 5 minutos han salido {volumen:.0f} m³ de agua a la calle por {nodo}.",
                    {"sensor": f"inundacion_{nodo}", "medido": round(volumen, 1), "esperado": 0, "unidad": "m³"},
                    "alta"))
        return nuevas

    def cambiar_estado(self, id_alerta, estado, hora, texto):
        alerta = self.alertas[id_alerta]
        alerta["estado"] = estado
        alerta["historial"].append({"hora": round(hora, 2), "estado": estado, "texto": texto})

    def olvidar_sospechas(self):
        """Tras resincronizar el gemelo, se empieza a contar de cero."""
        self.sospechas.clear()
