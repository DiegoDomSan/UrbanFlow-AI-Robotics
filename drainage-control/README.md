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
| Entorno (`entorno_ia.py`) | Red theta con SWMM en formato Gymnasium; una tormenta aleatoria por episodio (×0.5 a ×2, 4–12 h) y, en la mitad de los episodios, una segunda tormenta entre 3 y 16 h después |
| Observación (9 valores) | Nivel P1 y P2, caudal de salida, posición de las 2 válvulas, lluvia ahora y dentro de 1 h y 2 h, y lluvia total prevista entre 3 y 12 h después |
| Acción | Cada 5 minutos, cuánto abrir o cerrar cada válvula (máximo 10 % del recorrido), en escala logarítmica de 1 % a 100 % |
| Recompensa | −(exceso m³ / 100 + desborde m³ + 0.1 × movimiento de válvulas), y al final −(agua que queda en los depósitos m³ / 100) |
| Capa de seguridad | Si un depósito supera 1.9 m, su válvula se abre gradualmente aunque la IA decida otra cosa |
| Algoritmo | PPO (Stable-Baselines3), red de 2 capas de 64 neuronas, 4 simulaciones en paralelo, 800 000 pasos |

Resultados (`python drainage-control/evaluar_ia.py`). Puntuación de pystorms: menor es mejor.

| Tormenta | Estrategia | Puntuación | Pico de salida (m³/s) | Desborde (m³) | Movimientos de válvula |
| --- | --- | --- | --- | --- | --- |
| ×1 | Sin control | 1630 | 0.69 | 0 | 0 |
| ×1 | Reglas | **0** | **0.50** | 0 | 14.5 |
| ×1 | IA | 272 | 0.61 | 0 | **3.8** |
| ×1.5 | Sin control | 12 251 | 1.20 | 0 | 0 |
| ×1.5 | Reglas | **8973** | 1.76 | 0 | 31.7 |
| ×1.5 | IA | 9736 | **1.20** | 0 | **5.0** |
| ×2 | Sin control | 28 699 | 1.78 | 0 | 0 |
| ×2 | Reglas | **25 380** | 2.70 | 0 | 50.8 |
| ×2 | IA | 25 860 | **1.78** | 0 | **4.8** |
| Doble ×1, 6 h de separación | Sin control | 6104 | 0.84 | 0 | 0 |
| Doble ×1, 6 h de separación | Reglas | **1596** | 0.82 | 0 | 30.8 |
| Doble ×1, 6 h de separación | IA | 2714 | **0.79** | 0 | **7.1** |
| Doble ×1.5, 8 h de separación | Sin control | 31 105 | 1.42 | 0 | 0 |
| Doble ×1.5, 8 h de separación | Reglas | **24 546** | 2.10 | 0 | 73.4 |
| Doble ×1.5, 8 h de separación | IA | 26 389 | **1.42** | 0 | **8.8** |

La IA nunca desborda, mejora a no controlar en todas las tormentas, nunca sube el pico de salida por encima de no controlar y mueve las válvulas entre 4 y 10 veces menos que las reglas. Las reglas siguen teniendo mejor puntuación en esta red tan sencilla, pero suben el pico de salida en tormentas fuertes (2.70 m³/s con ×2).

**IA v2 frente a v1:** la v1 se entrenaba con una sola tormenta por episodio, veía solo 2 h de previsión y no tenía castigo por el agua final. La v2 mejora la puntuación en las cinco tormentas: −44 % con ×1, −18 % con la doble ×1, y entre −2 % y −4 % en las demás. Con ×2 baja además el pico de 1.96 a 1.78 m³/s.

Comportamiento aprendido:

- Controla sobre todo la válvula de P2, el depósito que recibe más agua.
- Antes de una segunda tormenta vacía los depósitos en las horas previas: llega al pico de la segunda con unos 600 m³ guardados de 4000 posibles.

Limitaciones:

- Tras la última tormenta tarda muchas horas en vaciar los depósitos.
- La válvula 1 da pequeños saltos (entre 1 % y 3 %) en algunos momentos.
- Solo se ha probado con tormentas de la misma forma que la original.
- Elegimos el diseño final viendo estas mismas tormentas de prueba; lo correcto sería validar con tormentas distintas.

## Stack

Python · EPA SWMM · pyswmm · pystorms · matplotlib · Gymnasium · Stable-Baselines3 · PyTorch
