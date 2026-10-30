# Drainage control: control inteligente del drenaje urbano

Módulo de UrbanFlow AI Robotics. Una IA controla en tiempo real compuertas, bombas y depósitos de la red de alcantarillado para reducir las inundaciones pluviales urbanas. Caso de estudio: un barrio de Valencia.

## Estado actual (Sprint 1)

- Simulación de una tormenta sobre el escenario de referencia `theta` de [pystorms](https://github.com/kLabUM/pystorms), sin control.
- Línea base: **rendimiento sin control = 1630.34** (menor es mejor).

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
| Nivel máximo P1 / P2 | 0.13 / 0.48 m | 1.27 / 1.53 m |
| Caudal máximo de salida (umbral 0.5) | 0.685 m³/s | 0.498 m³/s |
| Tiempo por encima del umbral | 3.8 h | 0.0 h |
| Volumen por encima del umbral | 1402.8 m³ | 0.0 m³ |

Con lluvia ×1.5, las reglas bajan la puntuación de 12 251 a 8973 y el volumen por encima del límite de 9411 a 6868 m³, pero el pico de salida sube de 1.20 a 1.76 m³/s: el exceso (~9400 m³) no cabe en los depósitos (~4000 m³) y hay que soltarlo al final.

Las reglas retienen el agua en los depósitos durante el pico y la sueltan después. Limitaciones detectadas:

- **Muy sensibles a los parámetros:** con apertura mínima 0 % la puntuación empeora a 142; con 10 %, a 1274.
- **Oscilan:** las válvulas abren y cierran continuamente durante el pico.
- **Ajustadas a una sola tormenta:** falta comprobar que funcionan con otras.

Son la motivación para el agente de IA de los siguientes sprints.

## Stack

Python · EPA SWMM · pyswmm · pystorms · matplotlib
