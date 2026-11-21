"""Reto del workshop: lanza en directo la tormenta que elijan los participantes y compara
sin control, reglas e IA.

Ejecutar desde la raíz del repositorio:
    python drainage-control/probar_tormenta.py FACTOR [DURACION_H] [SEPARACION_H]

    FACTOR        intensidad respecto a la tormenta original (1 = original, 2 = el doble)
    DURACION_H    horas de lluvia (por defecto 8, como la original)
    SEPARACION_H  si se pone, llega una segunda tormenta igual tantas horas después

Ejemplos:
    python drainage-control/probar_tormenta.py 1.8           # tormenta un 80 % más fuerte
    python drainage-control/probar_tormenta.py 1 4           # igual de fuerte, pero en 4 horas
    python drainage-control/probar_tormenta.py 1.2 8 3       # dos tormentas separadas 3 horas

Guarda el gráfico en drainage-control/resultados/reto_<...>.png y lo abre.
"""
import os

# Evita el "segmentation fault" en Mac (ver entorno_ia.py)
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OMP_NUM_THREADS", "1")

import subprocess
import sys

from analizar_sin_control import calcular_metricas
from control_por_reglas import CARPETA_RESULTADOS
from entorno_ia import tormenta
from evaluar_ia import cargar_agente, controlador_ia, dibujar, reglas, simular, sin_control


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    factor = float(sys.argv[1])
    duracion = int(sys.argv[2]) if len(sys.argv) > 2 else 8
    separacion = int(sys.argv[3]) if len(sys.argv) > 3 else None

    lluvia = tormenta(factor=factor, duracion_h=duracion)
    nombre = f"x{factor}_{duracion}h"
    if separacion is not None:
        lluvia = lluvia + tormenta(factor=factor, duracion_h=duracion,
                                   inicio_h=1 + duracion + separacion)
        nombre += f"_doble_{separacion}h"

    print(f"Tormenta: intensidad x{factor}, {duracion} h de lluvia"
          + (f", segunda tormenta {separacion} h después" if separacion is not None else ""))
    print("Simulando... (unos segundos por estrategia)\n")

    agente, normalizacion = cargar_agente()
    estrategias = {
        "Sin control": sin_control,
        "Reglas": reglas,
        "IA (PPO)": controlador_ia(agente, normalizacion, lluvia),
    }
    registros = {}
    print(f"{'Estrategia':<13}{'Puntuación':>12}{'Pico salida (m³/s)':>20}"
          f"{'Exceso (m³)':>13}{'Desborde (m³)':>15}{'Nivel máx (m)':>15}")
    print("-" * 88)
    for nombre_estrategia, controlador in estrategias.items():
        env, registro = simular(controlador, lluvia)
        registros[nombre_estrategia] = registro
        m = calcular_metricas(env, registro)
        nivel = max(m["Nivel máximo P1 (m de 2.0)"], m["Nivel máximo P2 (m de 2.0)"])
        print(f"{nombre_estrategia:<13}{m['Puntuación pystorms (menor es mejor)']:>12}"
              f"{m['Caudal máximo de salida (m³/s)']:>20}{m['Volumen por encima del umbral (m³)']:>13}"
              f"{m['Volumen inundado (m³)']:>15}{nivel:>15}")

    ruta = CARPETA_RESULTADOS / f"reto_{nombre}.png"
    dibujar(registros, lluvia, f"reto {nombre}", ruta)
    print(f"\nGráfico: {ruta}")
    if sys.platform == "darwin":
        subprocess.run(["open", str(ruta)], check=False)


if __name__ == "__main__":
    main()
