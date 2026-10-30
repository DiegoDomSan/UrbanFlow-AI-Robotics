# Drainage control: control inteligente del drenaje urbano

Módulo de UrbanFlow AI Robotics. Una IA controla en tiempo real compuertas, bombas y depósitos de la red de alcantarillado para reducir las inundaciones pluviales urbanas. Caso de estudio: un barrio de Valencia.

## Estado actual

- Escenario de referencia `theta` de [pystorms](https://github.com/kLabUM/pystorms): 2 depósitos, 2 válvulas.
- Línea base sin control: puntuación 1630.34 (menor es mejor).
- Control por reglas progresivo: puntuación 0 en la tormenta original.
- Agente de IA (PPO) con capa de seguridad: nunca desborda y mueve las válvulas mucho menos que las reglas.

## Requisitos

- **Python 3.10 o superior.** El Python 3.9 que trae macOS de serie no sirve; instala uno nuevo desde [python.org](https://www.python.org/downloads/).

## Instalación

Desde la raíz del repositorio:

```bash
git clone https://github.com/DiegoDomSan/UrbanFlow-AI-Robotics.git
cd UrbanFlow-AI-Robotics
python3 -m venv .venv          # en Mac, usa tu versión nueva: p. ej. python3.15 -m venv .venv
source .venv/bin/activate      # en Windows: .venv\Scripts\activate
python -m pip install -r drainage-control/requirements.txt
```

### Solo en Mac con chip Apple (M1, M2, M3...)

Si al ejecutar aparece `zsh: killed`, macOS está bloqueando el motor SWMM por una firma no válida. Fírmalo de nuevo en local (hay que repetirlo cada vez que se recrea el `.venv`):

```bash
find .venv -path "*swmm*" \( -name "*.so" -o -name "*.dylib" \) -exec codesign --force --sign - {} \;
xattr -dr com.apple.quarantine .venv
```

Los scripts de IA (`entorno_ia.py`, `entrenar_ia.py`, `evaluar_ia.py`) ajustan al principio dos variables de entorno (`KMP_DUPLICATE_LIB_OK` y `OMP_NUM_THREADS`). Sin ellas, en Mac Python se cierra con `segmentation fault`, porque SWMM y PyTorch traen cada uno su propia copia de la librería OpenMP (`libomp`).

## Uso

Simulación rápida:

```bash
python drainage-control/simular_sin_control.py
```

Simulación con métricas, datos y gráfico:

```bash
python drainage-control/analizar_sin_control.py
```

Guarda en `drainage-control/resultados/` el registro paso a paso (`sin_control.csv`, no se sube a GitHub) y el gráfico (`sin_control.png`).

## Métricas base (sin control)

| Métrica | Valor |
| --- | --- |
| Puntuación pystorms (menor es mejor) | 1630.34 |
| Volumen inundado | 0.0 m³ |
| Nivel máximo P1 / P2 (capacidad 2 m) | 0.13 m / 0.48 m |
| Caudal máximo de salida (umbral 0.5 m³/s) | 0.685 m³/s |
| Tiempo por encima del umbral | 3.8 h |
| Volumen por encima del umbral | 1402.8 m³ |

En este escenario la penalización no viene de inundaciones, sino de enviar demasiado caudal aguas abajo. Los depósitos usan menos de una cuarta parte de su capacidad: el control debe aprovecharla para retener agua y laminar el pico.

## Control por reglas (Sprint 2)

```bash
python drainage-control/control_por_reglas.py        # tormenta original
python drainage-control/control_por_reglas.py 1.5    # lluvia multiplicada por 1.5
```

Simula la tormenta sin control y con control por reglas, muestra la comparación y guarda `resultados/comparacion_sin_control_vs_reglas_x<factor>.png`.

Reglas, por orden de prioridad:

1. **Seguridad:** si un depósito supera 1.9 m (capacidad 2 m), se abre su válvula rápido pero de forma gradual (2 % por paso).
2. **Progresiva:** si el caudal de salida supera lo permitido, se cierran las válvulas un 0.5 % por paso (mínimo 5 %). Lo permitido es 0.4 m³/s con el depósito por debajo de 1 m y sube hasta 0.5 m³/s cuando llega a 1.8 m.
3. Si no, se abren un 0.5 % por paso.

Comparamos varias reglas de seguridad con tormentas más fuertes. Abrir la válvula de golpe al 100 % cuando el depósito llega a 1.8 m multiplica por 5 el pico de salida (6.2 m³/s con lluvia ×1.5, frente a 1.2 sin control). La regla progresiva dio el mejor resultado.

| Métrica | Sin control | Reglas |
| --- | --- | --- |
| Puntuación pystorms (menor es mejor) | 1630.34 | **0.0** |
| Volumen inundado | 0.0 m³ | 0.0 m³ |
| Nivel máximo P1 / P2 | 0.13 / 0.48 m | 1.27 / 1.52 m |
| Caudal máximo de salida (umbral 0.5) | 0.685 m³/s | 0.497 m³/s |
| Tiempo por encima del umbral | 3.8 h | 0.0 h |
| Volumen por encima del umbral | 1402.8 m³ | 0.0 m³ |

Con lluvia ×1.5, las reglas bajan la puntuación de 12 251 a 8973 y el volumen por encima del límite de 9411 a 6868 m³, pero el pico de salida sube de 1.20 a 1.76 m³/s: el exceso (~9400 m³) no cabe en los depósitos (~4000 m³) y hay que soltarlo al final.

Las reglas retienen el agua en los depósitos durante el pico y la sueltan después. Limitaciones detectadas:

- **Muy sensibles a los parámetros:** con apertura mínima 0 % la puntuación empeora a 142; con 10 %, a 1274.
- **Oscilan:** las válvulas abren y cierran continuamente durante el pico.
- **Ajustadas a una sola tormenta:** falta comprobar que funcionan con otras.

Son la motivación para el agente de IA.

## Agente de IA (aprendizaje por refuerzo)

```bash
python drainage-control/entrenar_ia.py          # entrena (unos 15 min, 800 000 pasos)
python drainage-control/evaluar_ia.py           # compara sin control, reglas e IA
```

`modelos/` incluye el agente ya entrenado, así que `evaluar_ia.py` funciona sin entrenar. Al volver a entrenar en otro ordenador los resultados pueden variar un poco.

| Pieza | Detalle |
| --- | --- |
| Entorno (`entorno_ia.py`) | Red theta con SWMM en formato Gymnasium; una tormenta aleatoria por episodio (×0.5 a ×2, 4–12 h, inicio entre 1:00 y 5:00) |
| Observación | Nivel P1 y P2, caudal de salida, posición de las 2 válvulas, lluvia ahora y dentro de 1 h y 2 h |
| Acción | Cada 5 minutos, cuánto abrir o cerrar cada válvula (máximo 10 % del recorrido), en escala logarítmica de 1 % a 100 % |
| Recompensa | −(exceso m³ / 100 + desborde m³ + 0.1 × movimiento de válvulas) |
| Capa de seguridad | Si un depósito supera 1.9 m, su válvula se abre gradualmente aunque la IA decida otra cosa |
| Algoritmo | PPO (Stable-Baselines3), red de 2 capas de 64 neuronas, 4 simulaciones en paralelo |

Resultados (`python drainage-control/evaluar_ia.py`):

| Lluvia | Estrategia | Puntuación | Pico de salida (m³/s) | Desborde (m³) | Movimientos de válvula |
| --- | --- | --- | --- | --- | --- |
| ×1 | Sin control | 1630 | 0.69 | 0 | 0 |
| ×1 | Reglas | **0** | 0.50 | 0 | 14.5 |
| ×1 | IA | 489 | 0.62 | 0 | **1.5** |
| ×1.5 | Sin control | 12 251 | 1.20 | 0 | 0 |
| ×1.5 | Reglas | **8973** | 1.76 | 0 | 31.7 |
| ×1.5 | IA | 10 143 | **1.19** | 0 | **2.8** |
| ×2 | Sin control | 28 699 | 1.78 | 0 | 0 |
| ×2 | Reglas | **25 380** | 2.70 | 0 | 50.8 |
| ×2 | IA | 26 384 | 1.96 | 0 | **3.7** |

La IA nunca desborda, mejora a no controlar en las tres tormentas y mueve las válvulas entre 10 y 14 veces menos que las reglas, que oscilan sin parar. Las reglas siguen teniendo mejor puntuación en esta red tan sencilla, pero con tormentas fuertes suben el pico de salida (2.70 m³/s con ×2) mucho más que la IA.

Comportamiento aprendido: la IA deja abierta la válvula de P1 y controla solo la de P2, el depósito que recibe más agua.

Limitaciones:

- **No vacía los depósitos después de la tormenta:** el episodio termina 12 h después de llover, así que no aprende a dejar espacio para la siguiente tormenta.
- Solo se ha probado con tormentas de la misma forma que la original.
- Elegimos el modelo final (800 000 pasos, con capa de seguridad) viendo estas mismas tormentas de prueba.

## Stack

Python · EPA SWMM · pyswmm · pystorms · matplotlib · Gymnasium · Stable-Baselines3 · PyTorch
