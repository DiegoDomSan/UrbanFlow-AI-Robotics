"""Sprint 2 - Control por reglas: abrir y cerrar las válvulas según lo que miden los sensores,
y compararlo con la simulación sin control.

Ejecutar desde la raíz del repositorio:
    python drainage-control/control_por_reglas.py        # tormenta original
    python drainage-control/control_por_reglas.py 1.5    # lluvia multiplicada por 1.5

Genera, en drainage-control/resultados/:
    reglas_x<factor>.csv                       -> registro paso a paso con el control por reglas
    comparacion_sin_control_vs_reglas_x<factor>.png
"""
import importlib
import re
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pystorms
from pyswmm.simulation import _sim_state_instance

from analizar_sin_control import PROFUNDIDAD_MAXIMA, calcular_metricas, guardar_csv

CARPETA_RESULTADOS = Path(__file__).parent / "resultados"

# --- Parámetros de las reglas -------------------------------------------------------
# El caudal permitido a la salida sube poco a poco a medida que se llena el depósito:
#   depósito por debajo de 1.0 m  -> se apunta a 0.40 m³/s (margen bajo el límite de 0.5)
#   depósito a 1.8 m              -> se permite llegar a 0.50 m³/s
# Así el depósito empieza a soltar agua antes y de forma suave, en vez de esperar a estar
# casi lleno y tener que soltarla de golpe.
CAUDAL_OBJETIVO_MIN = 0.40
CAUDAL_OBJETIVO_MAX = 0.50
NIVEL_INICIO_PROGRESIVO = 1.0   # m
NIVEL_FIN_PROGRESIVO = 1.8      # m
PASO_VALVULA = 0.005     # cuánto se abre o cierra la válvula en cada paso (0.5 %)
APERTURA_MINIMA = 0.05   # nunca se cierra del todo: siempre deja salir un poco de agua
NIVEL_SEGURIDAD = 1.9    # m: último recurso antes de desbordar (capacidad 2 m)
PASO_SEGURIDAD = 0.02    # en modo seguridad se abre más rápido, pero sin dar un golpe de agua


# --- Controladores ------------------------------------------------------------------
def sin_control(sensores, apertura_actual):
    """Válvulas siempre abiertas: la línea base."""
    return [1.0, 1.0]


def caudal_objetivo(nivel):
    """Caudal de salida permitido según lo lleno que esté el depósito (regla progresiva)."""
    fraccion = (nivel - NIVEL_INICIO_PROGRESIVO) / (NIVEL_FIN_PROGRESIVO - NIVEL_INICIO_PROGRESIVO)
    fraccion = min(1.0, max(0.0, fraccion))
    return CAUDAL_OBJETIVO_MIN + (CAUDAL_OBJETIVO_MAX - CAUDAL_OBJETIVO_MIN) * fraccion


def control_por_reglas(sensores, apertura_actual):
    """Tres reglas, por orden de prioridad:

    1. Seguridad: si un depósito está a punto de desbordarse, se va abriendo rápido su
       válvula. Se abre poco a poco y no de golpe: abrirla al 100 % de una vez soltaría
       una ola de agua (lo comprobamos: el pico se multiplica por 5).
    2. Si sale más agua de la permitida, se cierran un poco las válvulas para que el agua
       se quede esperando en los depósitos. Lo permitido sube cuanto más lleno está el
       depósito (regla progresiva).
    3. Si sale poca agua, se abren un poco para ir vaciando los depósitos.
    """
    caudal = sensores["caudal_salida"]
    niveles = [sensores["nivel_P1"], sensores["nivel_P2"]]

    nueva_apertura = []
    for apertura, nivel in zip(apertura_actual, niveles):
        if nivel > NIVEL_SEGURIDAD:                       # regla 1
            apertura = min(1.0, apertura + PASO_SEGURIDAD)
        elif caudal > caudal_objetivo(nivel):             # regla 2
            apertura = max(APERTURA_MINIMA, apertura - PASO_VALVULA)
        else:                                             # regla 3
            apertura = min(1.0, apertura + PASO_VALVULA)
        nueva_apertura.append(apertura)
    return nueva_apertura


# --- Tormentas ----------------------------------------------------------------------
def crear_escenario(factor_lluvia):
    """Crea el escenario theta con la lluvia multiplicada por factor_lluvia.

    Copia la red original de pystorms, multiplica los valores de la serie de lluvia y
    hace que pystorms cargue esa copia.
    """
    if factor_lluvia == 1.0:
        return pystorms.scenarios.theta()

    modulo = importlib.import_module("pystorms.scenarios.theta")
    original = Path(modulo.load_network("theta")).read_text()
    antes, serie = original.split("[TIMESERIES]")
    serie = re.sub(r"(T\s+\d\d:\d\d\s+)([\d.]+)",
                   lambda m: f"{m.group(1)}{float(m.group(2)) * factor_lluvia:.3f}", serie)
    ruta = CARPETA_RESULTADOS / f"theta_lluvia_x{factor_lluvia}.inp"
    ruta.write_text(antes + "[TIMESERIES]" + serie)

    cargar_original = modulo.load_network
    modulo.load_network = lambda nombre: str(ruta)
    try:
        return pystorms.scenarios.theta()
    finally:
        modulo.load_network = cargar_original


# --- Simulación ---------------------------------------------------------------------
def simular(controlador, factor_lluvia=1.0):
    """Simula la tormenta theta con el controlador dado y registra cada paso."""
    env = crear_escenario(factor_lluvia)
    leer = env.env.methods
    sim = env.env.sim

    apertura = [1.0, 1.0]
    registro = []
    done = False
    while not done:
        sensores = {
            "nivel_P1": leer["depthN"]("P1"),
            "nivel_P2": leer["depthN"]("P2"),
            "caudal_salida": leer["flow"]("8"),
        }
        apertura = controlador(sensores, apertura)
        done = env.step(apertura)
        if done:
            break
        registro.append({
            "tiempo": sim.current_time,
            "nivel_P1_m": leer["depthN"]("P1"),
            "nivel_P2_m": leer["depthN"]("P2"),
            "inundacion_P1_m3s": leer["flooding"]("P1"),
            "inundacion_P2_m3s": leer["flooding"]("P2"),
            "caudal_salida_m3s": leer["flow"]("8"),
            "apertura_valvula_1": apertura[0],
            "apertura_valvula_2": apertura[1],
        })

    # SWMM solo permite una simulación abierta a la vez; pystorms la cierra
    # pero no avisa a pyswmm, así que lo hacemos aquí para poder lanzar la siguiente.
    _sim_state_instance.sim_is_instantiated = False
    return env, registro


# --- Gráfico comparativo ------------------------------------------------------------
def dibujar_comparacion(base, reglas, umbral, factor_lluvia, ruta):
    fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(11, 10), sharex=True)
    t_base = [r["tiempo"] for r in base]
    t_reg = [r["tiempo"] for r in reglas]

    # 1. Caudal de salida: el objetivo es no pasar del umbral
    ax1.plot(t_base, [r["caudal_salida_m3s"] for r in base], color="#8A9AA6",
             label="Sin control")
    ax1.plot(t_reg, [r["caudal_salida_m3s"] for r in reglas], color="#2B7BB9",
             linewidth=1.8, label="Control por reglas")
    ax1.axhline(umbral, color="#B23A3A", linestyle="--", linewidth=1, label=f"Umbral ({umbral} m³/s)")
    ax1.set_ylabel("Caudal de salida (m³/s)")
    ax1.legend(loc="upper right")
    ax1.grid(alpha=0.3)

    # 2. Nivel en los depósitos: ahora se usan para guardar agua
    ax2.plot(t_base, [r["nivel_P2_m"] for r in base], color="#E07A2E", alpha=0.4,
             linestyle=":", label="P2 sin control")
    ax2.plot(t_reg, [r["nivel_P1_m"] for r in reglas], color="#2B7BB9", label="P1 con reglas")
    ax2.plot(t_reg, [r["nivel_P2_m"] for r in reglas], color="#E07A2E", label="P2 con reglas")
    ax2.axhline(PROFUNDIDAD_MAXIMA, color="#B23A3A", linestyle="--", linewidth=1,
                label="Capacidad (2 m)")
    ax2.axhline(NIVEL_SEGURIDAD, color="#B23A3A", linestyle=":", linewidth=1,
                label=f"Nivel de seguridad ({NIVEL_SEGURIDAD} m)")
    ax2.set_ylabel("Nivel de agua (m)")
    ax2.set_ylim(0, PROFUNDIDAD_MAXIMA * 1.1)
    ax2.legend(loc="upper right")
    ax2.grid(alpha=0.3)

    # 3. Lo que decide el controlador: apertura de las válvulas
    ax3.plot(t_reg, [r["apertura_valvula_1"] * 100 for r in reglas], color="#2B7BB9",
             label="Válvula 1 (P1)")
    ax3.plot(t_reg, [r["apertura_valvula_2"] * 100 for r in reglas], color="#E07A2E",
             linestyle="--", label="Válvula 2 (P2)")
    ax3.set_ylabel("Apertura (%)")
    ax3.set_ylim(-5, 105)
    ax3.set_xlabel("Tiempo de simulación")
    ax3.legend(loc="lower right")
    ax3.grid(alpha=0.3)

    fig.suptitle(f"Escenario theta (lluvia x{factor_lluvia}): sin control frente a control por reglas")
    fig.autofmt_xdate()
    fig.tight_layout()
    fig.savefig(ruta, dpi=150)
    plt.close(fig)


if __name__ == "__main__":
    CARPETA_RESULTADOS.mkdir(exist_ok=True)
    factor = float(sys.argv[1]) if len(sys.argv) > 1 else 1.0

    env_base, reg_base = simular(sin_control, factor)
    m_base = calcular_metricas(env_base, reg_base)

    env_reglas, reg_reglas = simular(control_por_reglas, factor)
    m_reglas = calcular_metricas(env_reglas, reg_reglas)

    print(f"Tormenta: lluvia x{factor}\n")
    print(f"{'Métrica':<40}{'Sin control':>14}{'Reglas':>14}")
    print("-" * 68)
    for nombre in m_base:
        print(f"{nombre:<40}{m_base[nombre]:>14}{m_reglas[nombre]:>14}")

    guardar_csv(reg_reglas, CARPETA_RESULTADOS / f"reglas_x{factor}.csv")
    dibujar_comparacion(reg_base, reg_reglas, env_reglas.threshold, factor,
                        CARPETA_RESULTADOS / f"comparacion_sin_control_vs_reglas_x{factor}.png")
    print(f"\nResultados guardados en: {CARPETA_RESULTADOS}")
