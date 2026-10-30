"""Compara el agente de IA con el control por reglas y con no controlar nada.

Ejecutar desde la raíz del repositorio (después de entrenar_ia.py):
    python drainage-control/evaluar_ia.py

Prueba las tres estrategias con la tormenta original y con lluvia x1.5 y x2, usando la
misma puntuación de pystorms que en los pasos anteriores, y guarda:
    resultados/comparacion_ia_x<factor>.png
"""
import os

# SWMM y PyTorch traen cada uno su propia copia de la librería OpenMP (libomp). En Mac,
# cuando las dos trabajan a la vez, Python se cierra con "segmentation fault". Estas dos
# líneas lo evitan; tienen que ir antes de importar pyswmm, pystorms o torch.
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OMP_NUM_THREADS", "1")

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from pyswmm.simulation import _sim_state_instance
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv, VecNormalize

from analizar_sin_control import PROFUNDIDAD_MAXIMA, calcular_metricas
from control_por_reglas import CARPETA_RESULTADOS, control_por_reglas, crear_escenario
from entorno_ia import (PASO_MAXIMO, SEGUNDOS_POR_DECISION, UMBRAL_SALIDA, EntornoDrenaje,
                        accion_a_apertura, aplicar_escudo, apertura_a_accion, tormenta)

CARPETA_MODELOS = Path(__file__).parent / "modelos"
FACTORES_LLUVIA = [1.0, 1.5, 2.0]


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
    estado = {"ultima_decision": None, "apertura": [1.0, 1.0]}

    def decidir(sensores, apertura_actual, tiempo):
        if (estado["ultima_decision"] is not None and
                (tiempo - estado["ultima_decision"]).total_seconds() < SEGUNDOS_POR_DECISION):
            return estado["apertura"]
        hora = int(sensores["horas_transcurridas"])
        previsión = [lluvia[h] if h < len(lluvia) else 0.0 for h in (hora, hora + 1, hora + 2)]
        observacion = np.array([[
            sensores["nivel_P1"] / PROFUNDIDAD_MAXIMA,
            sensores["nivel_P2"] / PROFUNDIDAD_MAXIMA,
            min(sensores["caudal_salida"] / UMBRAL_SALIDA, 10.0),
            *apertura_a_accion(np.array(estado["apertura"])),
            *(valor / 5.0 for valor in previsión),
        ]], dtype=np.float32)
        accion, _ = agente.predict(normalizacion.normalize_obs(observacion), deterministic=True)
        posicion = apertura_a_accion(np.array(estado["apertura"]))
        nueva = np.clip(posicion + np.clip(accion[0], -1.0, 1.0) * PASO_MAXIMO, 0.0, 1.0)
        nueva = aplicar_escudo(nueva, posicion, [sensores["nivel_P1"], sensores["nivel_P2"]])
        estado["apertura"] = [float(a) for a in accion_a_apertura(nueva)]
        estado["ultima_decision"] = tiempo
        return estado["apertura"]

    return decidir


def simular(controlador, factor):
    """Simula la tormenta con el controlador dado y la puntuación oficial de pystorms."""
    env = crear_escenario(factor)
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
            "inundacion_P1_m3s": leer["flooding"]("P1"),
            "inundacion_P2_m3s": leer["flooding"]("P2"),
            "caudal_salida_m3s": leer["flow"]("8"),
            "apertura_valvula_1": apertura[0],
            "apertura_valvula_2": apertura[1],
        })
    _sim_state_instance.sim_is_instantiated = False
    return env, registro


def dibujar(resultados, factor, ruta):
    colores = {"Sin control": "#8A9AA6", "Reglas": "#E07A2E", "IA (PPO)": "#2B7BB9"}
    fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(11, 10), sharex=True)
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
        ax.legend(loc="upper right")
        ax.grid(alpha=0.3)
    # La tormenta y su vaciado ocupan el primer día y medio: recortamos el resto
    inicio = resultados["Sin control"][0]["tiempo"]
    ax3.set_xlim(inicio, inicio + (resultados["Sin control"][-1]["tiempo"] - inicio) * 0.45)
    fig.suptitle(f"Escenario theta, lluvia x{factor}: sin control, reglas e IA")
    fig.autofmt_xdate()
    fig.tight_layout()
    fig.savefig(ruta, dpi=150)
    plt.close(fig)


def sin_control(sensores, apertura, tiempo):
    return [1.0, 1.0]


def reglas(sensores, apertura, tiempo):
    return control_por_reglas(sensores, apertura)


if __name__ == "__main__":
    CARPETA_RESULTADOS.mkdir(exist_ok=True)
    agente, normalizacion = cargar_agente()
    resumen = []

    for factor in FACTORES_LLUVIA:
        lluvia = tormenta(factor=factor)
        estrategias = {
            "Sin control": sin_control,
            "Reglas": reglas,
            "IA (PPO)": controlador_ia(agente, normalizacion, lluvia),
        }
        registros = {}
        for nombre, controlador in estrategias.items():
            env, registro = simular(controlador, factor)
            registros[nombre] = registro
            m = calcular_metricas(env, registro)
            cambios = sum(abs(a["apertura_valvula_1"] - b["apertura_valvula_1"]) +
                          abs(a["apertura_valvula_2"] - b["apertura_valvula_2"])
                          for a, b in zip(registro, registro[1:]))
            resumen.append((factor, nombre, m, cambios))
        dibujar(registros, factor, CARPETA_RESULTADOS / f"comparacion_ia_x{factor}.png")

    print(f"{'Lluvia':<8}{'Estrategia':<13}{'Puntuación':>12}{'Pico (m³/s)':>13}"
          f"{'Exceso (m³)':>13}{'Desborde (m³)':>15}{'Nivel máx (m)':>15}{'Mov. válvulas':>15}")
    print("-" * 104)
    for factor, nombre, m, cambios in resumen:
        nivel = max(m["Nivel máximo P1 (m de 2.0)"], m["Nivel máximo P2 (m de 2.0)"])
        print(f"x{factor:<7}{nombre:<13}{m['Puntuación pystorms (menor es mejor)']:>12}"
              f"{m['Caudal máximo de salida (m³/s)']:>13}{m['Volumen por encima del umbral (m³)']:>13}"
              f"{m['Volumen inundado (m³)']:>15}{nivel:>15}{cambios:>15.1f}")
    print(f"\nGráficos guardados en: {CARPETA_RESULTADOS}")
