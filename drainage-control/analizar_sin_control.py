"""Sprint 1 - Tareas 5 y 6: registrar lo que pasa en la red durante la tormenta,
calcular las métricas base y dibujar el gráfico.

Ejecutar desde la raíz del repositorio:
    python drainage-control/analizar_sin_control.py

Genera, en drainage-control/resultados/:
    sin_control.csv   -> niveles, inundación y caudal de salida en cada paso
    sin_control.png   -> gráfico de la tormenta
"""
import csv
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # guarda el gráfico en un archivo, sin abrir ventanas
import matplotlib.pyplot as plt
import pystorms

CARPETA_RESULTADOS = Path(__file__).parent / "resultados"
PROFUNDIDAD_MAXIMA = 2.0  # m, capacidad de los depósitos P1 y P2 (archivo theta.inp)


def sin_control(estado):
    """Controlador base: las dos válvulas siempre abiertas (1.0 = 100 %)."""
    return [1.0, 1.0]


def simular(controlador):
    """Simula la tormenta del escenario theta con el controlador dado.

    Devuelve el entorno (para leer su puntuación) y una lista con una fila por paso.
    """
    env = pystorms.scenarios.theta()
    leer = env.env.methods
    sim = env.env.sim

    registro = []
    done = False
    while not done:
        acciones = controlador(env.state())
        done = env.step(acciones)
        if done:  # el último paso cierra la simulación y ya no se puede leer
            break
        registro.append({
            "tiempo": sim.current_time,
            "nivel_P1_m": leer["depthN"]("P1"),
            "nivel_P2_m": leer["depthN"]("P2"),
            "inundacion_P1_m3s": leer["flooding"]("P1"),
            "inundacion_P2_m3s": leer["flooding"]("P2"),
            "caudal_salida_m3s": leer["flow"]("8"),
            "apertura_valvula_1": acciones[0],
            "apertura_valvula_2": acciones[1],
        })
    return env, registro


def calcular_metricas(env, registro):
    """Resume la tormenta en unas pocas cifras comparables entre controladores."""
    umbral = env.threshold  # caudal máximo deseado a la salida (m³/s)
    volumen_inundado = 0.0
    volumen_sobre_umbral = 0.0
    segundos_sobre_umbral = 0.0

    for anterior, actual in zip(registro, registro[1:]):
        dt = (actual["tiempo"] - anterior["tiempo"]).total_seconds()
        volumen_inundado += (actual["inundacion_P1_m3s"] + actual["inundacion_P2_m3s"]) * dt
        exceso = actual["caudal_salida_m3s"] - umbral
        if exceso > 0:
            volumen_sobre_umbral += exceso * dt
            segundos_sobre_umbral += dt

    return {
        "Puntuación pystorms (menor es mejor)": round(env.performance(), 2),
        "Volumen inundado (m³)": round(volumen_inundado, 1),
        "Nivel máximo P1 (m de 2.0)": round(max(r["nivel_P1_m"] for r in registro), 2),
        "Nivel máximo P2 (m de 2.0)": round(max(r["nivel_P2_m"] for r in registro), 2),
        "Caudal máximo de salida (m³/s)": round(max(r["caudal_salida_m3s"] for r in registro), 3),
        "Umbral de caudal de salida (m³/s)": umbral,
        "Tiempo por encima del umbral (h)": round(segundos_sobre_umbral / 3600, 1),
        "Volumen por encima del umbral (m³)": round(volumen_sobre_umbral, 1),
    }


def guardar_csv(registro, ruta):
    with open(ruta, "w", newline="", encoding="utf-8") as f:
        escritor = csv.DictWriter(f, fieldnames=registro[0].keys())
        escritor.writeheader()
        escritor.writerows(registro)


def dibujar(registro, umbral, titulo, ruta):
    tiempo = [r["tiempo"] for r in registro]
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(11, 7), sharex=True)

    # Arriba: nivel de agua en los depósitos frente a su capacidad
    ax1.plot(tiempo, [r["nivel_P1_m"] for r in registro], label="Depósito P1", color="#2B7BB9")
    ax1.plot(tiempo, [r["nivel_P2_m"] for r in registro], label="Depósito P2", color="#E07A2E")
    ax1.axhline(PROFUNDIDAD_MAXIMA, color="#B23A3A", linestyle="--", linewidth=1,
                label="Capacidad (2 m): por encima se inunda")
    ax1.set_ylabel("Nivel de agua (m)")
    ax1.set_ylim(0, PROFUNDIDAD_MAXIMA * 1.1)
    ax1.legend(loc="upper right")
    ax1.grid(alpha=0.3)

    # Abajo: caudal que sale de la red frente al máximo deseado
    caudal = [r["caudal_salida_m3s"] for r in registro]
    ax2.plot(tiempo, caudal, color="#14212B", linewidth=1, label="Caudal de salida")
    ax2.axhline(umbral, color="#B23A3A", linestyle="--", linewidth=1,
                label=f"Umbral ({umbral} m³/s)")
    ax2.fill_between(tiempo, umbral, caudal, where=[c > umbral for c in caudal],
                     color="#B23A3A", alpha=0.25, label="Exceso sobre el umbral")
    ax2.set_ylabel("Caudal (m³/s)")
    ax2.set_xlabel("Tiempo de simulación")
    ax2.legend(loc="upper right")
    ax2.grid(alpha=0.3)

    fig.suptitle(titulo)
    fig.autofmt_xdate()
    fig.tight_layout()
    fig.savefig(ruta, dpi=150)
    plt.close(fig)


if __name__ == "__main__":
    CARPETA_RESULTADOS.mkdir(exist_ok=True)

    env, registro = simular(sin_control)
    metricas = calcular_metricas(env, registro)

    print("=== Métricas base: tormenta theta SIN CONTROL ===")
    for nombre, valor in metricas.items():
        print(f"{nombre}: {valor}")

    guardar_csv(registro, CARPETA_RESULTADOS / "sin_control.csv")
    dibujar(registro, env.threshold, "Escenario theta, sin control: válvulas siempre abiertas",
            CARPETA_RESULTADOS / "sin_control.png")
    print(f"\nResultados guardados en: {CARPETA_RESULTADOS}")
