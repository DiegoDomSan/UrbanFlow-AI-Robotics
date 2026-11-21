# Contrato de datos: simulación (Python) ↔ ciudad 3D (frontend)

Este documento es para conectar la app 3D (`frontend/`) con el servidor de simulación (`backend/`).
Si se cambia algo aquí, hay que avisar al otro lado.

- Servidor: `http://localhost:8000`
- La app de Vite (`http://localhost:5173`) puede llamarlo directamente, porque CORS está abierto.
- **Coordenadas:** metros, `x` = este, `z` = sur, `(0, 0)` = centro de Paiporta. Son exactamente las mismas que `toWorld()` de `frontend/src/city/geo/projection.ts`, así que las posiciones van directas a la escena (y = altura, la elige el frontend).

## 1. `GET /api/escenario`: lo fijo, se pide una vez

```jsonc
{
  "elementos": [   // depósitos, pozos y salida de la red
    { "id": "P1", "tipo": "deposito", "posicion": [-188.2, 75.9], "pozo_de_acceso": false },
    { "id": "P1J", "tipo": "pozo", "posicion": [-112.6, 43.0], "pozo_de_acceso": true },
    { "id": "O", "tipo": "salida", "posicion": [86.0, -55.0], "pozo_de_acceso": false }
  ],
  "conexiones": [  // válvulas y tuberías (subterráneas)
    { "id": "2", "desde": "P2", "hasta": "P2J", "tipo": "valvula", "puntos": [[x,z],[x,z]] },
    { "id": "9", "desde": "P2J", "hasta": "PJ3", "tipo": "tuberia", "puntos": [[x,z],[x,z]] }
  ],
  "base_robots": [-187.8, -224.9],
  "calles": [ [[x,z],[x,z]], ... ],          // tramos del grafo de calles que usan los robots
  "barranco": [ [x,z], ... ],                // Barranc de Xiva dentro de la ciudad
  "nombres": { "2": "Válvula 2 (depósito P2)", ... },
  "estrategias": { "ia": "IA (PPO)", "reglas": "Reglas", "sin_control": "Sin control" },
  "tipos_averia": { "valvula_atascada": { "elementos": ["1","2"] }, "tuberia_obstruida": { "elementos": ["7","9","8"] } },
  "tipos_robot": { "terrestre": {...}, "dron": {...}, "tuberia": {...} }   // velocidad, capacidades, límites
}
```

## 2. `WS /ws/simulacion`: la simulación en directo

### Lo que manda el frontend

| `accion` | Campos | Qué hace |
|---|---|---|
| `iniciar` | `tormenta: {factor, duracion_h, separacion_h\|null}`, `estrategia: "ia"\|"reglas"\|"sin_control"`, `averias?: [{tipo, elemento, hora, apertura?, caudal_max?}]`, `pasos_por_segundo?` | Empieza una simulación nueva. Las `averias` se provocan solas a la `hora` indicada. |
| `pausar` / `reanudar` | – | |
| `velocidad` | `pasos_por_segundo` (0.2–30) | Cada paso son 5 minutos simulados. |
| `provocar_averia` | `tipo`, `elemento`, `apertura?` (válvula, 0.01–1), `caudal_max?` (tubería, m³/s) | Avería en ese momento (botón del workshop). |
| `detener` | – | Cierra la sesión. |

### Lo que recibe el frontend

`{"tipo": "inicio", ...}` una vez, con `horas_total`, `tormenta`, `estrategia` y `lluvia_mm_h` (una lista con la lluvia de cada hora).

Después, cada 5 minutos simulados, llega un `{"tipo": "paso", ...}`:

```jsonc
{
  "tipo": "paso",
  "hora": 5.25,                          // horas desde el inicio de la simulación
  "progreso": 0.27,                      // 0–1
  "lluvia_mm_h": 2.4,
  "estrategia": "ia",
  "red": {
    "niveles_m": { "P1": 0.42, "P2": 1.6, "P1J": 0.2, "P2J": 0.3, "PJ3": 0.25 },   // sensores (con ruido)
    "caudales_m3s": { "1": 0.12, "2": 0.05, "8": 0.4 },                           // válvulas y salida
    "volumen_depositos_m3": { "P1": 420, "P2": 1600 },
    "apertura_ordenada": [0.02, 1.0],    // lo que pide el controlador a las válvulas 1 y 2 (0–1)
    "apertura_real": [0.02, 0.01],       // lo que hacen de verdad (si difiere: válvula atascada)
    "gemelo": { "niveles_m": {...}, "caudales_m3s": {...} }   // lo que DEBERÍA pasar (red sana)
  },
  "salida": { "caudal_m3s": 0.4, "umbral_m3s": 0.5, "por_encima": false },
  "inundacion": {
    "zonas": [ { "nodo": "O", "centro": [x,z], "radio_m": 85, "profundidad_m": 0.15, "volumen_m3": 3400 } ],
    "calles_cortadas": [ [[x,z],[x,z]], ... ]   // tramos con > 10 cm de agua: el robot terrestre no pasa
  },
  "alertas": [ {
    "id": "A1", "tipo": "valvula_atascada" | "tuberia_obstruida" | "inundacion",
    "elemento": "2", "nombre": "Válvula 2 (depósito P2)", "titulo": "...", "explicacion": "...",
    "evidencia": { "sensor": "caudal_valvula_2", "medido": 0.01, "esperado": 0.2, "unidad": "m³/s" },
    "severidad": "alta" | "media",
    "estado": "detectada" | "en_espera" | "inspeccionando" | "confirmada" | "reparando" | "vigilando" | "resuelta",
    "hora_deteccion": 2.6,
    "historial": [ { "hora": 2.6, "estado": "detectada", "texto": "..." }, ... ]
  } ],
  "robots": [ {
    "id": "tuberia-1", "tipo": "terrestre" | "dron" | "tuberia", "nombre": "Robot de tuberías",
    "posicion": [x,z],
    "estado": "en_base" | "yendo" | "trabajando" | "terminado" | "volviendo" | "esperando",
    "bajo_tierra": true,                 // el robot de tuberías va dentro de la red
    "mision": "A1", "tarea": "inspeccion" | "reparacion" | "vigilancia" | null,
    "ruta": [ [x,z], ... ],              // ruta completa (para dibujarla)
    "progreso": 0.6,                     // 0–1 a lo largo de la ruta
    "trabajo_restante_s": 600
  } ],
  "decisiones": [ { "hora": 2.6, "alerta": "A1", "robot": "terrestre-1", "tarea": "inspeccion",
                    "razonamiento": ["El robot terrestre llegaría en 6.3 min…", "Se envía el terrestre: …"] } ],
  "eventos": [ "ALERTA A1: …", "terrestre-1 sale hacia …" ],   // texto para un panel de registro
  "metricas": { "exceso_total_m3": 2615, "desborde_total_m3": 0 },
  "terminado": false
}
```

Al acabar llega `{"tipo": "fin", "metricas": {...}}`. Si una orden es incorrecta, llega `{"tipo": "error", "mensaje": "..."}`.

## 3. Ideas para dibujarlo en 3D

- **Depósitos:** un cilindro o caja cuyo nivel de agua es `niveles_m.P1 / 2` (capacidad 2 m).
- **Tuberías y válvulas:** van bajo tierra; se ven en la vista "Underground View". Una válvula atascada (con alerta activa) se pinta en rojo.
- **Agua en la calle:** un disco de agua por cada zona, con `radio_m` y `profundidad_m`. Las `calles_cortadas` se marcan en rojo.
- **Robots:** su modelo en `posicion`, moviéndose de un fotograma al siguiente (interpolar suaviza el movimiento). El dron va a unos 20 m de altura. Si `bajo_tierra` es `true`, el robot de tuberías se ve solo en la vista subterránea.
- **Panel lateral:** las `alertas` con su `historial`, y las `decisiones` con su `razonamiento`, para que se vea por qué la IA hace cada cosa.

Ejemplo mínimo de conexión (React):

```ts
const ws = new WebSocket("ws://localhost:8000/ws/simulacion");
ws.onopen = () => ws.send(JSON.stringify({ accion: "iniciar", estrategia: "ia",
  tormenta: { factor: 1.2, duracion_h: 8, separacion_h: 3 } }));
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.tipo === "paso") useCityStore.getState().setSimulacion(m); };
```

`setSimulacion` sería una acción nueva del store de zustand. La página `backend/prueba/index.html` es un ejemplo completo en 2D.
