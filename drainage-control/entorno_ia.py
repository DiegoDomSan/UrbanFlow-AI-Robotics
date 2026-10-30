"""Entorno de IA: la red theta convertida en un "juego" para aprendizaje por refuerzo.

Cada 5 minutos de simulación el agente:
    - VE:      nivel de los dos depósitos, caudal de salida, posición de las válvulas,
               la lluvia de la hora actual y de las 2 siguientes, y la lluvia total
               prevista entre 3 y 12 horas después (previsión).
    - DECIDE:  cuánto abrir o cerrar cada válvula, poco a poco, en escala logarítmica
               (la apertura va de 1 % a 100 %).
    - RECIBE:  una recompensa negativa por el agua que sale por encima del límite,
               por desbordar un depósito, por mover las válvulas bruscamente y por el
               agua que queda retenida al final de la partida.

En cada partida (episodio) la tormenta es distinta: cambia su intensidad, su duración y
la hora a la que empieza. En la mitad de las partidas llega una segunda tormenta entre
3 y 16 horas después de la primera: así el agente aprende a vaciar los depósitos a
tiempo para dejar espacio.

Este archivo solo define el entorno. Para entrenar: entrenar_ia.py
"""
import os

# SWMM y PyTorch traen cada uno su propia copia de la librería OpenMP (libomp). En Mac,
# cuando las dos trabajan a la vez, Python se cierra con "segmentation fault". Estas dos
# líneas lo evitan; tienen que ir antes de importar pyswmm, pystorms o torch.
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OMP_NUM_THREADS", "1")

from datetime import datetime, timedelta
from pathlib import Path

import gymnasium as gym
import numpy as np
from gymnasium import spaces
from pystorms.networks import load_network
from pyswmm import Links, Nodes, Simulation
from pyswmm.simulation import _sim_state_instance

# --- Datos de la red theta ----------------------------------------------------------
UMBRAL_SALIDA = 0.5          # m³/s que admite la red aguas abajo
PROFUNDIDAD_MAXIMA = 2.0     # m, capacidad de cada depósito
DEPOSITOS = ["P1", "P2"]
VALVULAS = ["1", "2"]
TUBERIA_SALIDA = "8"
INICIO_SIMULACION = datetime(2018, 2, 25)   # fecha de inicio del archivo theta.inp
HORAS_SIMULACION = 78                       # la simulación de theta dura 78 horas

# Tormenta original de theta: lluvia (mm/h) de cada hora a partir de la 01:00
TORMENTA_BASE = [1.2, 2.3, 3.2, 3.1, 3.1, 2.1, 1.1, 0.1]

# --- Parámetros del "juego" ---------------------------------------------------------
SEGUNDOS_POR_DECISION = 300      # el agente decide cada 5 minutos
HORAS_DESPUES_DE_LLOVER = 12     # tiempo que se sigue simulando para vaciar los depósitos
PESO_EXCESO = 1 / 100            # castigo por cada m³ que sale por encima del umbral
PESO_DESBORDE = 1.0              # castigo por cada m³ desbordado (100 veces más grave)
PESO_CAMBIO_VALVULA = 0.1        # castigo por mover las válvulas (evita oscilaciones)
PESO_AGUA_FINAL = 1 / 100        # castigo por cada m³ que queda en los depósitos al final
PASO_MAXIMO = 0.1                # cuánto puede mover cada válvula en una decisión (escala 0-1)
LLUVIA_MIN, LLUVIA_MAX = 0.5, 2.0   # rango del factor de lluvia de las tormentas
PROBABILIDAD_DOBLE = 0.5         # partidas con una segunda tormenta
SEPARACION_MIN, SEPARACION_MAX = 3, 16   # horas entre el final de la 1.ª y la 2.ª tormenta

# Capa de seguridad ("escudo"): si un depósito pasa de este nivel, su válvula se abre
# gradualmente decida lo que decida la IA. Así la IA nunca puede llevar un depósito a
# desbordarse por una mala decisión. Es como se usa la IA en sistemas críticos.
NIVEL_SEGURIDAD = 1.9            # m (capacidad 2 m)

CARPETA_TEMPORAL = Path(__file__).parent / "resultados" / "tormentas_entrenamiento"

# Escala logarítmica de la válvula. Medimos que las válvulas de theta solo cambian el
# resultado cuando están casi cerradas (por debajo del 15 %); entre el 15 y el 100 % todo
# es casi igual. Por eso el agente no elige la apertura directamente, sino un valor de 0 a 1
# que se traduce así:  0 -> 1 %,  0.5 -> 10 %,  1 -> 100 %.
APERTURA_MINIMA_IA = 0.01
TAMANO_OBSERVACION = 9


def accion_a_apertura(accion):
    """Valor en la escala del agente (0-1) -> apertura real de la válvula (0.01-1)."""
    return APERTURA_MINIMA_IA ** (1.0 - np.clip(accion, 0.0, 1.0))


def apertura_a_accion(apertura):
    """Apertura real de la válvula (0.01-1) -> valor en la escala del agente (0-1)."""
    apertura = np.clip(apertura, APERTURA_MINIMA_IA, 1.0)
    return 1.0 - np.log(apertura) / np.log(APERTURA_MINIMA_IA)


def aplicar_escudo(posicion_nueva, posicion_actual, niveles):
    """Si un depósito está casi lleno, obliga a abrir su válvula al menos PASO_MAXIMO."""
    posicion_nueva = np.array(posicion_nueva, dtype=float)
    for i, nivel in enumerate(niveles):
        if nivel > NIVEL_SEGURIDAD:
            posicion_nueva[i] = max(posicion_nueva[i], min(1.0, posicion_actual[i] + PASO_MAXIMO))
    return posicion_nueva


def mover_valvulas(apertura_actual, accion, niveles):
    """Aplica la decisión del agente (cuánto mover cada válvula) y la capa de seguridad.
    Devuelve la nueva apertura real y cuánto se han movido las válvulas."""
    posicion = apertura_a_accion(np.asarray(apertura_actual, dtype=float))
    movimiento = np.clip(np.asarray(accion, dtype=float), -1.0, 1.0) * PASO_MAXIMO
    nueva = np.clip(posicion + movimiento, 0.0, 1.0)
    nueva = aplicar_escudo(nueva, posicion, niveles)
    return accion_a_apertura(nueva), float(np.abs(nueva - posicion).sum())


def construir_observacion(nivel_p1, nivel_p2, caudal, apertura, lluvia, hora):
    """Lo que ve el agente, escalado a valores cercanos a 0-1."""
    h = int(hora)

    def lluvia_en(i):
        return lluvia[i] if 0 <= i < len(lluvia) else 0.0

    proximas_horas = sum(lluvia_en(i) for i in range(h + 3, h + 13))
    return np.array([
        nivel_p1 / PROFUNDIDAD_MAXIMA,
        nivel_p2 / PROFUNDIDAD_MAXIMA,
        min(caudal / UMBRAL_SALIDA, 10.0),
        *apertura_a_accion(np.asarray(apertura, dtype=float)),
        lluvia_en(h) / 5.0,
        lluvia_en(h + 1) / 5.0,
        lluvia_en(h + 2) / 5.0,
        proximas_horas / 20.0,
    ], dtype=np.float32)


def tormenta(factor=1.0, duracion_h=8, inicio_h=1):
    """Lluvia hora a hora (mm/h) durante toda la simulación: la forma de la tormenta
    original, estirada a 'duracion_h' horas, multiplicada por 'factor' y empezando en
    'inicio_h'. Con los valores por defecto se obtiene exactamente la tormenta de theta."""
    base = np.array(TORMENTA_BASE)
    forma = np.interp(np.linspace(0, 1, duracion_h), np.linspace(0, 1, len(base)), base)
    lluvia = np.zeros(HORAS_SIMULACION)
    fin = min(inicio_h + duracion_h, HORAS_SIMULACION)
    lluvia[inicio_h:fin] = (forma * factor)[:fin - inicio_h]
    return lluvia


def escribir_red(lluvia, ruta):
    """Copia la red theta cambiando su serie de lluvia por la que se le pasa."""
    texto = Path(load_network("theta")).read_text()
    antes, despues = texto.split("[TIMESERIES]")
    resto = despues[despues.index("\n["):] if "\n[" in despues else ""
    lineas = []
    for h, valor in enumerate(lluvia):
        momento = INICIO_SIMULACION + timedelta(hours=h)
        lineas.append(f"T  {momento:%m/%d/%Y}  {momento:%H:%M}  {valor:.3f}\n")
    ruta.write_text(antes + "[TIMESERIES]\n;;Name  Date  Time  Value\n" + "".join(lineas) + resto)


class EntornoDrenaje(gym.Env):
    """Red theta con tormentas variables, en el formato estándar de Gymnasium."""

    def __init__(self, tormenta_fija=None, semilla=None):
        super().__init__()
        self.tormenta_fija = tormenta_fija   # si se pasa, siempre se usa esta lluvia
        self.rng = np.random.default_rng(semilla)
        self.sim = None
        self.observation_space = spaces.Box(low=0.0, high=10.0, shape=(TAMANO_OBSERVACION,),
                                            dtype=np.float32)
        # Lo que decide: cuánto abrir (+) o cerrar (-) cada válvula respecto a su posición
        # actual. -1 = cerrar el máximo permitido en 5 minutos, +1 = abrir el máximo.
        self.action_space = spaces.Box(low=-1.0, high=1.0, shape=(2,), dtype=np.float32)

    # --- Funciones internas ---------------------------------------------------------
    def _tormenta_aleatoria(self, inicio_minimo, inicio_maximo):
        return tormenta(
            factor=self.rng.uniform(LLUVIA_MIN, LLUVIA_MAX),
            duracion_h=int(self.rng.integers(4, 13)),
            inicio_h=int(self.rng.integers(inicio_minimo, inicio_maximo + 1)),
        )

    def _elegir_tormenta(self):
        if self.tormenta_fija is not None:
            return self.tormenta_fija
        lluvia = self._tormenta_aleatoria(1, 5)
        if self.rng.random() < PROBABILIDAD_DOBLE:
            fin_primera = int(np.nonzero(lluvia)[0].max()) + 1
            lluvia = lluvia + self._tormenta_aleatoria(fin_primera + SEPARACION_MIN,
                                                       fin_primera + SEPARACION_MAX)
        return lluvia

    def _cerrar(self):
        if self.sim is not None:
            self.sim._model.swmm_end()
            self.sim._model.swmm_close()
            self.sim = None
        _sim_state_instance.sim_is_instantiated = False

    def _hora_actual(self):
        return (self.sim.current_time - self.sim.start_time).total_seconds() / 3600

    def _niveles(self):
        return [self.nodos[d].depth for d in DEPOSITOS]

    def _observacion(self):
        p1, p2 = self._niveles()
        return construir_observacion(p1, p2, self.tuberias[TUBERIA_SALIDA].flow,
                                     self.apertura, self.lluvia, self._hora_actual())

    # --- Funciones estándar de Gymnasium --------------------------------------------
    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        if seed is not None:
            self.rng = np.random.default_rng(seed)
        self._cerrar()

        self.lluvia = self._elegir_tormenta()
        CARPETA_TEMPORAL.mkdir(parents=True, exist_ok=True)
        # Un archivo por proceso: al entrenar se ejecutan varias simulaciones en paralelo
        ruta = CARPETA_TEMPORAL / f"tormenta_{os.getpid()}.inp"
        escribir_red(self.lluvia, ruta)

        self.sim = Simulation(str(ruta))
        self.sim.start()
        self.nodos = Nodes(self.sim)
        self.tuberias = Links(self.sim)
        self.apertura = np.array([1.0, 1.0])
        ultima_hora_lluvia = int(np.nonzero(self.lluvia)[0].max()) + 1
        self.horas_episodio = min(ultima_hora_lluvia + HORAS_DESPUES_DE_LLOVER, HORAS_SIMULACION - 1)
        self.registro = {"exceso_m3": 0.0, "desborde_m3": 0.0, "agua_final_m3": 0.0}
        return self._observacion(), {}

    def step(self, accion):
        self.apertura, cambio = mover_valvulas(self.apertura, accion, self._niveles())
        for valvula, valor in zip(VALVULAS, self.apertura):
            self.tuberias[valvula].target_setting = float(valor)

        # Avanzar 5 minutos sumando el exceso y el desborde de cada paso de SWMM
        exceso = desborde = 0.0
        avanzado = 0.0
        terminado = False
        anterior = self.sim.current_time
        while avanzado < SEGUNDOS_POR_DECISION:
            if self.sim._model.swmm_step() <= 0:
                terminado = True
                break
            actual = self.sim.current_time
            dt = (actual - anterior).total_seconds()
            anterior = actual
            avanzado += dt
            exceso += max(0.0, self.tuberias[TUBERIA_SALIDA].flow - UMBRAL_SALIDA) * dt
            desborde += sum(self.nodos[d].flooding for d in DEPOSITOS) * dt

        self.registro["exceso_m3"] += exceso
        self.registro["desborde_m3"] += desborde
        recompensa = -(PESO_EXCESO * exceso + PESO_DESBORDE * desborde + PESO_CAMBIO_VALVULA * cambio)

        if not terminado and self._hora_actual() >= self.horas_episodio:
            terminado = True
        if terminado:
            # El agua que queda en los depósitos al final cuenta como exceso futuro:
            # así el agente aprende a vaciarlos (despacio, sin pasar del umbral).
            agua_final = sum(self.nodos[d].volume for d in DEPOSITOS)
            self.registro["agua_final_m3"] = agua_final
            recompensa -= PESO_AGUA_FINAL * agua_final
            observacion = np.zeros(TAMANO_OBSERVACION, dtype=np.float32)
            self._cerrar()
        else:
            observacion = self._observacion()
        return observacion, float(recompensa), terminado, False, dict(self.registro)

    def close(self):
        self._cerrar()
