"""Entrena el agente de IA (PPO) para controlar las válvulas de la red theta.

Ejecutar desde la raíz del repositorio:
    python drainage-control/entrenar_ia.py              # entrenamiento normal
    python drainage-control/entrenar_ia.py 50000        # prueba rápida con menos pasos

Guarda en drainage-control/modelos/:
    agente_ppo.zip        -> la "red neuronal" entrenada
    normalizacion.pkl     -> cómo escalar lo que ve el agente (necesario para usarlo)

Cómo aprende: juega miles de tormentas distintas. En cada una prueba aperturas de
válvula, ve la recompensa que obtiene y ajusta su estrategia para conseguir más.
"""
import os

# SWMM y PyTorch traen cada uno su propia copia de la librería OpenMP (libomp). En Mac,
# cuando las dos trabajan a la vez, Python se cierra con "segmentation fault". Estas dos
# líneas lo evitan; tienen que ir antes de importar pyswmm, pystorms o torch.
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OMP_NUM_THREADS", "1")

import sys
import time
from pathlib import Path

from stable_baselines3 import PPO
from stable_baselines3.common.env_util import make_vec_env
from stable_baselines3.common.vec_env import SubprocVecEnv, VecNormalize

from entorno_ia import EntornoDrenaje

CARPETA_MODELOS = Path(__file__).parent / "modelos"
PASOS_ENTRENAMIENTO = 800_000   # decisiones en total (unas 3000 tormentas)
SIMULACIONES_EN_PARALELO = 4    # SWMM solo permite una simulación por proceso de Python
SEMILLA = 42                    # para que el entrenamiento sea reproducible


def main():
    pasos = int(sys.argv[1]) if len(sys.argv) > 1 else PASOS_ENTRENAMIENTO
    CARPETA_MODELOS.mkdir(exist_ok=True)

    # Varias simulaciones en paralelo, cada una en su propio proceso
    entornos = make_vec_env(EntornoDrenaje, n_envs=SIMULACIONES_EN_PARALELO,
                            seed=SEMILLA, vec_env_cls=SubprocVecEnv)
    # Escala lo que ve el agente y las recompensas: ayuda mucho a que aprenda
    entornos = VecNormalize(entornos, norm_obs=True, norm_reward=True, gamma=0.995)

    agente = PPO(
        "MlpPolicy",
        entornos,
        gamma=0.995,          # valora lo que pasará horas después (decisiones cada 5 min)
        n_steps=1024,
        batch_size=256,
        learning_rate=3e-4,
        ent_coef=0.0,
        seed=SEMILLA,
        verbose=1,
    )

    inicio = time.time()
    print(f"Entrenando {pasos} pasos con {SIMULACIONES_EN_PARALELO} simulaciones en paralelo...")
    agente.learn(total_timesteps=pasos)
    minutos = (time.time() - inicio) / 60

    agente.save(CARPETA_MODELOS / "agente_ppo")
    entornos.save(CARPETA_MODELOS / "normalizacion.pkl")
    entornos.close()
    print(f"\nEntrenamiento terminado en {minutos:.1f} minutos.")
    print(f"Modelo guardado en: {CARPETA_MODELOS}")


if __name__ == "__main__":  # necesario para las simulaciones en paralelo en Mac
    main()
