# Backend: simulación en directo, detección de averías y robots

Conecta la IA de `drainage-control/` con el mapa de Paiporta y la envía en directo al navegador.

## Cómo se usa

Desde la raíz del repositorio, con el entorno activado:

```bash
source .venv/bin/activate
pip install -r backend/requirements.txt   # solo la primera vez
python backend/servidor.py
```

Luego abre **http://localhost:8000**: la página de prueba, un mapa 2D de Paiporta en directo.

1. Elige la tormenta (intensidad, horas, segunda tormenta) y la estrategia, y pulsa **Iniciar**.
2. Durante la simulación, pulsa **Provocar avería** y mira cómo el sistema la detecta, decide qué robot enviar, lo confirma y lo repara.

## Cómo funciona

```
          órdenes de válvulas (IA, reglas o nada)
                         │
          ┌──────────────┴──────────────┐
          ▼                             ▼
   PLANTA (SWMM)                 GEMELO DIGITAL (SWMM)
   la "red real":                la misma red, siempre sana:
   aquí se provocan averías      lo que DEBERÍA pasar
          │ sensores con ruido          │
          └──────────────┬──────────────┘
                         ▼
                 DETECTOR (detector.py)
          compara y dice qué se ha roto y dónde
                         ▼
             DESPACHO DE ROBOTS (robots.py)
     terrestre / dron / tuberías, con rutas por calles reales
                         ▼
             SERVIDOR (servidor.py) ──WebSocket──► navegador / ciudad 3D
```

| Archivo | Qué hace |
|---|---|
| `planta.py` | Ejecuta SWMM en un proceso aparte (SWMM solo admite una simulación por proceso). Se usa dos veces: planta y gemelo. Permite provocar averías, repararlas y guardar el estado para resincronizar. |
| `detector.py` | Compara sensores con el gemelo. Un pozo más lleno de lo normal indica una tubería obstruida después de él; una válvula que deja pasar un caudal distinto al ordenado indica una válvula atascada. Cada síntoma tiene que repetirse 10 minutos para evitar falsas alarmas. |
| `ciudad.py` | Lee las calles de OpenStreetMap (el mismo `paiporta.geojson` y la misma proyección que la ciudad 3D), coloca la red en el mapa, calcula el agua en la calle y las calles cortadas, y busca rutas con A* (NetworkX). |
| `robots.py` | La flota y el despacho. Cada decisión guarda su razonamiento en texto. |
| `sesion.py` | Junta todo en un bucle de pasos de 5 minutos. |
| `servidor.py` | FastAPI: `GET /api/escenario` y `WS /ws/simulacion`. |
| `CONTRATO_DATOS.md` | El formato exacto de los mensajes, para conectar la app 3D. |
| `prueba/index.html` | Página de prueba en 2D. |

### Ciclo de una avería

1. **Se provoca la avería** en la planta (botón o programada). El sistema no lo sabe.
2. **El detector la descubre** al cabo de unos 10–30 minutos simulados, y lo explica con números: "por la válvula 2 pasan 0,01 m³/s y deberían pasar 0,20".
3. **Inspección:** va el robot terrestre si hay camino seco y llega en menos de 15 minutos. Si no, va el dron.
4. **Confirmada la avería, va el robot de tuberías:**
   - Se le lleva por calles secas hasta el pozo de acceso más rápido. Si el pozo más cercano está bajo el agua, elige otro.
   - Entra en la tubería y avanza hasta la avería.
   - Repara en 15 minutos (válvula) o 25 minutos (tubería).
5. **La avería desaparece de la planta** y el gemelo se resincroniza con el estado real (un "hotstart" de SWMM). El detector vuelve a vigilar desde cero.

### Limitaciones (para ser honestos)

- **La red no es real.** La red theta no es la red real de Paiporta: está colocada a mano en el mapa (`POSICION_DESEADA` en `ciudad.py`).
- **El agua en la calle es una aproximación.** Se modela como un círculo de 15 cm de altura que crece con el volumen desbordado; no es una simulación 2D de superficie.
- **El detector necesita un gemelo bien calibrado.** Aquí el gemelo es perfecto porque es el mismo modelo que la planta. En la realidad, el modelo nunca coincide del todo con la red.
- **Hay averías que no se ven.** Una válvula atascada en la misma posición que se le ordena no se detecta hasta que se le pide moverse, igual que en la realidad.
