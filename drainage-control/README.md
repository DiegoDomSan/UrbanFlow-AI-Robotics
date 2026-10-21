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

```bash
python drainage-control/simular_sin_control.py
```

Salida esperada:

```
Pasos simulados: 12576
Rendimiento sin control (menor es mejor): 1630.34
```

## Stack

Python · EPA SWMM · pyswmm · pystorms
