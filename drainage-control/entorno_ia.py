"""Entorno de IA: la red theta convertida en un "juego" para aprendizaje por refuerzo.

Cada 5 minutos de simulación el agente:
    - VE:      nivel de los dos depósitos, caudal de salida, apertura actual de las válvulas
               y la lluvia de la hora actual y de las 2 horas siguientes (previsión).
    - DECIDE:  cuánto abrir o cerrar cada válvula, poco a poco, en escala logarítmica
               (la apertura va de 1 % a 100 %).
    - RECIBE:  una recompensa negativa por el agua que sale por encima del límite,
               por desbordar un depósito y por mover las válvulas bruscamente.

En cada partida (episodio) la tormenta es distinta: cambia su intensidad, su duración
y la hora a la que empieza. Así el agente no se aprende una tormenta de memoria.

Este archivo solo define el entorno. Para entrenar: entrenar_ia.py
"""
import os

# SWMM y PyTorch traen cada uno su propia copia de la librería OpenMP (libomp). En Mac,
# cuando las dos trabajan a la vez, Python se cierra con "segmentation fault". Estas dos
# líneas lo evitan; tienen que ir antes de importar pyswmm, pystorms o torch.
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OMP_NUM_THREADS", "1")

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

# Tormenta original de theta: lluvia (mm/h) de cada hora a partir de la 01:00
TORMENTA_BASE = [1.2, 2.3, 3.2, 3.1, 3.1, 2.1, 1.1, 0.1]

# --- Parámetros del "juego" ---------------------------------------------------------
SEGUNDOS_POR_DECISION = 300      # el agente decide cada 5 minutos
HORAS_DESPUES_DE_LLOVER = 12     # tiempo que se sigue simulando para vaciar los depósitos
PESO_EXCESO = 1 / 100            # castigo por cada m³ que sale por encima del umbral
PESO_DESBORDE = 1.0              # castigo por cada m³ desbordado (100 veces más grave)
PESO_CAMBIO_VALVULA = 0.1        # castigo por mover las válvulas (evita oscilaciones)
PASO_MAXIMO = 0.1                # cuánto puede mover cada válvula en una decisión (escala 0-1)
LLUVIA_MIN, LLUVIA_MAX = 0.5, 2.0   # rango del factor de lluvia de las tormentas de entrenamiento

# Capa de seguridad ("escudo"): si un depósito pasa de este nivel, su válvula se abre
# gradualmente decida lo que decida la IA. Así la IA nunca puede llevar un depósito a
# desbordarse por una mala decisión. Es como se usa la IA en sistemas críticos.
NIVEL_SEGURIDAD = 1.9            # m (capacidad 2 m)


def aplicar_escudo(posicion_nueva, posicion_actual, niveles):
    """Si un depósito está casi lleno, obliga a abrir su válvula al menos PASO_MAXIMO."""
    posicion_nueva = np.array(posicion_nueva, dtype=float)
    for i, nivel in enumerate(niveles):
        if nivel > NIVEL_SEGURIDAD:
            posicion_nueva[i] = max(posicion_nueva[i], min(1.0, posicion_actual[i] + PASO_MAXIMO))
    return posicion_nueva

CARPETA_TEMPORAL = Path(__file__).parent / "resultados" / "tormentas_entrenamiento"

# Escala logarítmica de la válvula. Medimos que las válvulas de theta solo cambian el
# resultado cuando están casi cerradas (por debajo del 15 %); entre el 15 y el 100 % todo
# es casi igual. Por eso el agente no elige la apertura directamente, sino un valor de 0 a 1
# que se traduce así:  0 -> 1 %,  0.5 -> 10 %,  1 -> 100 %.
APERTURA_MINIMA_IA = 0.01


def accion_a_apertura(accion):
    """Valor que elige el agente (0-1) -> apertura real de la válvula (0.01-1)."""
    return APERTURA_MINIMA_IA ** (1.0 - np.clip(accion, 0.0, 1.0))


def apertura_a_accion(apertura):
    """Apertura real de la válvula (0.01-1) -> valor en la escala del agente (0-1)."""
    apertura = np.clip(apertura, APERTURA_MINIMA_IA, 1.0)
    return 1.0 - np.log(apertura) / np.log(APERTURA_MINIMA_IA)


def tormenta(factor=1.0, duracion_h=8, inicio_h=1):
    """Lluvia hora a hora (mm/h) para un día: la forma de la tormenta original,
    estirada a 'duracion_h' horas, multiplicada por 'factor' y empezando en 'inicio_h'.
    Con los valores por defecto se obtiene exactamente la tormenta original de theta."""
    base = np.array(TORMENTA_BASE)
    x_base = np.linspace(0, 1, len(base))
    x_nueva = np.linspace(0, 1, duracion_h)
    forma = np.interp(x_nueva, x_base, base)
    lluvia = np.zeros(24)
    lluvia[inicio_h:inicio_h + duracion_h] = forma * factor
    return lluvia


def escribir_red(lluvia, ruta):
    """Copia la red theta cambiando su serie de lluvia por la que se le pasa."""
    texto = Path(load_network("theta")).read_text()
    antes, despues = texto.split("[TIMESERIES]")
    resto = despues[despues.index("\n["):] if "\n[" in despues else ""
    serie = ";;Name  Date  Time  Value\n" + "".join(
        f"T  {h:02d}:00  {valor:.3f}\n" for h, valor in enumerate(lluvia)
    )
    ruta.write_text(antes + "[TIMESERIES]\n" + serie + resto)


class EntornoDrenaje(gym.Env):
    """Red theta con tormentas variables, en el formato estándar de Gymnasium."""

    def __init__(self, tormenta_fija=None, semilla=None):
        super().__init__()
        self.tormenta_fija = tormenta_fija   # si se pasa, siempre se usa esta lluvia
        self.rng = np.random.default_rng(semilla)
        self.sim = None

        # Lo que ve el agente (todo escalado a valores cercanos a 0-1):
        # nivel P1, nivel P2, caudal salida, apertura V1, apertura V2,
        # lluvia ahora, dentro de 1 h y dentro de 2 h
        self.observation_space = spaces.Box(low=0.0, high=10.0, shape=(8,), dtype=np.float32)
        # Lo que decide: cuánto abrir (+) o cerrar (-) cada válvula respecto a su posición
        # actual. -1 = cerrar el máximo permitido en 5 minutos, +1 = abrir el máximo.
        self.action_space = spaces.Box(low=-1.0, high=1.0, shape=(2,), dtype=np.float32)

    # --- Funciones internas ---------------------------------------------------------
    def _elegir_tormenta(self):
        if self.tormenta_fija is not None:
            return self.tormenta_fija
        return tormenta(
            factor=self.rng.uniform(LLUVIA_MIN, LLUVIA_MAX),
            duracion_h=int(self.rng.integers(4, 13)),
            inicio_h=int(self.rng.integers(1, 6)),
        )

    def _cerrar(self):
        if self.sim is not None:
            self.sim._model.swmm_end()
            self.sim._model.swmm_close()
            self.sim = None
        _sim_state_instance.sim_is_instantiated = False

    def _hora_actual(self):
        return (self.sim.current_time - self.sim.start_time).total_seconds() / 3600

    def _observacion(self):
        hora = int(self._hora_actual())
        lluvia = [self.lluvia[h] if h < len(self.lluvia) else 0.0 for h in (hora, hora + 1, hora + 2)]
        return np.array([
            self.nodos["P1"].depth / PROFUNDIDAD_MAXIMA,
            self.nodos["P2"].depth / PROFUNDIDAD_MAXIMA,
            min(self.tuberias[TUBERIA_SALIDA].flow / UMBRAL_SALIDA, 10.0),
            *apertura_a_accion(self.apertura),
            *(valor / 5.0 for valor in lluvia),
        ], dtype=np.float32)

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
        self.horas_episodio = ultima_hora_lluvia + HORAS_DESPUES_DE_LLOVER
        self.registro = {"exceso_m3": 0.0, "desborde_m3": 0.0}
        return self._observacion(), {}

    def step(self, accion):
        posicion = apertura_a_accion(self.apertura)                      # escala 0-1
        movimiento = np.clip(np.asarray(accion, dtype=float), -1.0, 1.0) * PASO_MAXIMO
        nueva_posicion = np.clip(posicion + movimiento, 0.0, 1.0)
        niveles = [self.nodos[d].depth for d in DEPOSITOS]
        nueva_posicion = aplicar_escudo(nueva_posicion, posicion, niveles)
        cambio = np.abs(nueva_posicion - posicion).sum()
        self.apertura = accion_a_apertura(nueva_posicion)
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
        observacion = self._observacion() if not terminado else np.zeros(8, dtype=np.float32)
        info = dict(self.registro)
        if terminado:
            self._cerrar()
        return observacion, float(recompensa), terminado, False, info

    def close(self):
        self._cerrar()
