"""Compara el agente de IA con el control por reglas y con no controlar nada.

Ejecutar desde la raíz del repositorio (después de entrenar_ia.py):
    python drainage-control/evaluar_ia.py

Prueba las tres estrategias con cinco tormentas (la original, x1.5, x2 y dos tormentas
dobles), usando la misma puntuación de pystorms que en los pasos anteriores, y guarda:
    resultados/comparacion_ia_<tormenta>.png
"""
import os

# SWMM y PyTorch traen cada uno su propia copia de la librería OpenMP (libomp). En Mac,
# cuando las dos trabajan a la vez, Python se cierra con "segmentation fault". Estas dos
# líneas lo evitan; tienen que ir antes de importar pyswmm, pystorms o torch.
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OMP_NUM_THREADS", "1")

import importlib
from datetime import timedelta
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pystorms
from pyswmm.simulation import _sim_state_instance
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv, VecNormalize

from analizar_sin_control import PROFUNDIDAD_MAXIMA, calcular_metricas
from control_por_reglas import CARPETA_RESULTADOS, control_por_reglas
from entorno_ia import (SEGUNDOS_POR_DECISION, UMBRAL_SALIDA, EntornoDrenaje,
                        construir_observacion, escribir_red, mover_valvulas, tormenta)

CARPETA_MODELOS = Path(__file__).parent / "modelos"

# Tormentas de prueba: la original, dos más fuertes y dos dobles
TORMENTAS = {
    "x1": tormenta(),
    "x1.5": tormenta(factor=1.5),
    "x2": tormenta(factor=2.0),
    "doble_x1_6h": tormenta() + tormenta(inicio_h=15),              # 2.ª empieza 6 h después
    "doble_x1.5_8h": tormenta(factor=1.5) + tormenta(factor=1.5, inicio_h=17),
}


def crear_escenario(lluvia):
    """Escenario theta de pystorms con la lluvia indicada."""
    modulo = importlib.import_module("pystorms.scenarios.theta")
    ruta = CARPETA_RESULTADOS / "tormenta_evaluacion.inp"
    escribir_red(lluvia, ruta)
    cargar_original = modulo.load_network
    modulo.load_network = lambda nombre: str(ruta)
    try:
        return pystorms.scenarios.theta()
    finally:
        modulo.load_network = cargar_original


def cargar_agente():
    """Carga la red neuronal entrenada y la escala de las observaciones."""
    agente = PPO.load(CARPETA_MODELOS / "agente_ppo")
    normalizacion = VecNormalize.load(CARPETA_MODELOS / "normalizacion.pkl",
                                      DummyVecEnv([lambda: EntornoDrenaje()]))
    normalizacion.training = False
    return agente, normalizacion


def controlador_ia(agente, normalizacion, lluvia):
    """Convierte el agente en un controlador como los otros.

    El agente decide cada 5 minutos; entre decisiones se mantiene la apertura."""
    estado = {"ultima_decision": None, "apertura": np.array([1.0, 1.0])}

    def decidir(sensores, apertura_actual, tiempo):
        if (estado["ultima_decision"] is not None and
                (tiempo - estado["ultima_decision"]).total_seconds() < SEGUNDOS_POR_DECISION):
            return list(estado["apertura"])
        niveles = [sensores["nivel_P1"], sensores["nivel_P2"]]
        observacion = construir_observacion(*niveles, sensores["caudal_salida"],
                                            estado["apertura"], lluvia,
                                            sensores["horas_transcurridas"])
        accion, _ = agente.predict(normalizacion.normalize_obs(observacion[None, :]),
                                   deterministic=True)
        estado["apertura"], _ = mover_valvulas(estado["apertura"], accion[0], niveles)
        estado["ultima_decision"] = tiempo
        return list(estado["apertura"])

    return decidir


def sin_control(sensores, apertura, tiempo):
    return [1.0, 1.0]


def reglas(sensores, apertura, tiempo):
    return control_por_reglas(sensores, apertura)


def simular(controlador, lluvia):
    """Simula la tormenta con el controlador dado y la puntuación oficial de pystorms."""
    env = crear_escenario(lluvia)
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
            "horas_transcurridas": (sim.current_time - sim.start_time).total_seconds() / 3600,
        }
        apertura = controlador(sensores, apertura, sim.current_time)
        done = env.step(apertura)
        if done:
            break
        registro.append({
            "tiempo": sim.current_time,
            "nivel_P1_m": leer["depthN"]("P1"),
            "nivel_P2_m": leer["depthN"]("P2"),
            "volumen_m3": leer["volumeN"]("P1") + leer["volumeN"]("P2"),
            "inundacion_P1_m3s": leer["flooding"]("P1"),
            "inundacion_P2_m3s": leer["flooding"]("P2"),
            "caudal_salida_m3s": leer["flow"]("8"),
            "apertura_valvula_1": apertura[0],
            "apertura_valvula_2": apertura[1],
        })
    _sim_state_instance.sim_is_instantiated = False
    return env, registro


def agua_al_empezar_segunda(registro, lluvia):
    """m³ guardados en los depósitos al empezar la hora de lluvia más fuerte de la
    2.ª tormenta, que es cuando hace falta tener espacio (None si no hay 2.ª tormenta)."""
    horas = np.nonzero(lluvia)[0]
    huecos = np.nonzero(np.diff(horas) > 1)[0]
    if len(huecos) == 0:
        return None
    horas_segunda = horas[huecos[0] + 1:]
    hora_pico = int(horas_segunda[np.argmax(lluvia[horas_segunda])])
    inicio = registro[0]["tiempo"] + timedelta(hours=hora_pico)
    return min(registro, key=lambda r: abs((r["tiempo"] - inicio).total_seconds()))["volumen_m3"]


def dibujar(resultados, lluvia, nombre_tormenta, ruta):
    colores = {"Sin control": "#8A9AA6", "Reglas": "#E07A2E", "IA (PPO)": "#2B7BB9"}
    fig, (ax0, ax1, ax2, ax3) = plt.subplots(
        4, 1, figsize=(11, 12), sharex=True, gridspec_kw={"height_ratios": [1, 2, 2, 2]})
    inicio = resultados["Sin control"][0]["tiempo"]
    horas = [inicio + timedelta(hours=h) for h in range(len(lluvia))]
    ax0.bar(horas, lluvia, width=1 / 24, align="edge", color="#5B8DB8")
    ax0.set_ylabel("Lluvia\n(mm/h)")
    for nombre, registro in resultados.items():
        t = [r["tiempo"] for r in registro]
        ax1.plot(t, [r["caudal_salida_m3s"] for r in registro], color=colores[nombre], label=nombre)
        ax2.plot(t, [max(r["nivel_P1_m"], r["nivel_P2_m"]) for r in registro],
                 color=colores[nombre], label=nombre)
        if nombre != "Sin control":
            ax3.plot(t, [r["apertura_valvula_1"] * 100 for r in registro],
                     color=colores[nombre], label=f"{nombre}: válvula 1")
            ax3.plot(t, [r["apertura_valvula_2"] * 100 for r in registro],
                     color=colores[nombre], linestyle=":", label=f"{nombre}: válvula 2")
    ax1.axhline(UMBRAL_SALIDA, color="#B23A3A", linestyle="--", linewidth=1, label="Umbral (0.5 m³/s)")
    ax1.set_ylabel("Caudal de salida (m³/s)")
    ax2.axhline(PROFUNDIDAD_MAXIMA, color="#B23A3A", linestyle="--", linewidth=1, label="Capacidad (2 m)")
    ax2.set_ylabel("Nivel del depósito\nmás lleno (m)")
    ax2.set_ylim(0, PROFUNDIDAD_MAXIMA * 1.1)
    # Escala logarítmica: las válvulas solo hacen efecto por debajo del 15 %
    ax3.set_yscale("log")
    ax3.set_ylim(0.8, 120)
    ax3.set_yticks([1, 3, 10, 30, 100], ["1 %", "3 %", "10 %", "30 %", "100 %"])
    ax3.axhspan(0.8, 15, color="#2B7BB9", alpha=0.06)
    ax3.set_ylabel("Apertura de válvula\n(escala logarítmica)")
    ax3.set_xlabel("Tiempo de simulación")
    for ax in (ax1, ax2, ax3):
        ax.legend(loc="upper right", fontsize=8)
        ax.grid(alpha=0.3)
    ultima_lluvia = int(np.nonzero(lluvia)[0].max()) + 1
    ax3.set_xlim(inicio, inicio + timedelta(hours=ultima_lluvia + 24))
    fig.suptitle(f"Escenario theta, tormenta {nombre_tormenta}: sin control, reglas e IA")
    fig.autofmt_xdate()
    fig.tight_layout()
    fig.savefig(ruta, dpi=150)
    plt.close(fig)


if __name__ == "__main__":
    CARPETA_RESULTADOS.mkdir(exist_ok=True)
    agente, normalizacion = cargar_agente()
    resumen = []

    for nombre_tormenta, lluvia in TORMENTAS.items():
        estrategias = {
            "Sin control": sin_control,
            "Reglas": reglas,
            "IA (PPO)": controlador_ia(agente, normalizacion, lluvia),
        }
        registros = {}
        for nombre, controlador in estrategias.items():
            env, registro = simular(controlador, lluvia)
            registros[nombre] = registro
            m = calcular_metricas(env, registro)
            cambios = sum(abs(a["apertura_valvula_1"] - b["apertura_valvula_1"]) +
                          abs(a["apertura_valvula_2"] - b["apertura_valvula_2"])
                          for a, b in zip(registro, registro[1:]))
            resumen.append((nombre_tormenta, nombre, m, cambios,
                            agua_al_empezar_segunda(registro, lluvia)))
        dibujar(registros, lluvia, nombre_tormenta,
                CARPETA_RESULTADOS / f"comparacion_ia_{nombre_tormenta}.png")

    print(f"{'Tormenta':<15}{'Estrategia':<13}{'Puntuación':>13}{'Pico (m³/s)':>13}"
          f"{'Exceso (m³)':>13}{'Desborde (m³)':>15}{'Mov. válv.':>12}{'Agua en pico 2.ª (m³)':>25}")
    print("-" * 119)
    for nombre_tormenta, nombre, m, cambios, agua in resumen:
        agua_txt = "-" if agua is None else f"{agua:.0f}"
        print(f"{nombre_tormenta:<15}{nombre:<13}{m['Puntuación pystorms (menor es mejor)']:>13}"
              f"{m['Caudal máximo de salida (m³/s)']:>13}{m['Volumen por encima del umbral (m³)']:>13}"
              f"{m['Volumen inundado (m³)']:>15}{cambios:>12.1f}{agua_txt:>25}")
    print(f"\nGráficos guardados en: {CARPETA_RESULTADOS}")
