"""Servidor que conecta la simulación con el navegador (la ciudad 3D de Diego o la página de prueba).

Arrancar (desde la raíz del repositorio, con el entorno .venv activado):
    python backend/servidor.py
Luego abrir http://localhost:8000 (página de prueba).

Qué ofrece:
    GET  /api/escenario     todo lo fijo: calles, red de drenaje, base de robots, opciones
    WS   /ws/simulacion     la simulación en directo: el navegador manda órdenes y recibe
                            un "fotograma" cada 5 minutos simulados
El formato exacto de los mensajes está en backend/CONTRATO_DATOS.md.

FastAPI es una librería para hacer servidores web en Python: cada función con
@app.get(...) responde a una dirección. Un WebSocket es una conexión que se queda abierta
y por la que los dos lados se mandan mensajes cuando quieren (ideal para tiempo real).
"""
import os

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OMP_NUM_THREADS", "1")

import asyncio
import sys
from pathlib import Path

CARPETA = Path(__file__).resolve().parent
sys.path.insert(0, str(CARPETA))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402

from ciudad import Ciudad  # noqa: E402
from detector import NOMBRES  # noqa: E402
from robots import TIPOS_ROBOT  # noqa: E402
from sesion import ESTRATEGIAS, TIPOS_AVERIA, Sesion, cargar_ia  # noqa: E402

app = FastAPI(title="UrbanFlow AI · simulación en directo")
# Permite que la app de Diego (Vite, http://localhost:5173) se conecte a este servidor
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

CIUDAD = Ciudad()


@app.get("/")
def pagina_de_prueba():
    return FileResponse(CARPETA / "prueba" / "index.html")


@app.get("/api/escenario")
def escenario():
    return {
        **CIUDAD.descripcion(),
        "nombres": NOMBRES,
        "estrategias": ESTRATEGIAS,
        "tipos_averia": TIPOS_AVERIA,
        "tipos_robot": TIPOS_ROBOT,
        "tormenta_por_defecto": {"factor": 1.0, "duracion_h": 8, "separacion_h": None},
    }


@app.websocket("/ws/simulacion")
async def simulacion(ws: WebSocket):
    """Una conexión = una sesión. Órdenes que entiende (JSON con el campo 'accion'):
    iniciar, pausar, reanudar, velocidad, provocar_averia, detener."""
    await ws.accept()
    sesion = None
    estado = {"pausado": False, "pasos_por_segundo": 4.0}
    tarea = None

    async def bucle():
        while not sesion.terminado:
            if estado["pausado"]:
                await asyncio.sleep(0.1)
                continue
            # La simulación bloquea (espera a SWMM): se ejecuta en otro hilo para no
            # congelar el servidor mientras tanto
            fotograma = await asyncio.to_thread(sesion.paso)
            if fotograma is None:
                break
            await ws.send_json(fotograma)
            await asyncio.sleep(1.0 / estado["pasos_por_segundo"])
        await ws.send_json({"tipo": "fin", "metricas": {"exceso_total_m3": round(sesion.exceso_total),
                                                        "desborde_total_m3": round(sesion.desborde_total)}})

    try:
        while True:
            orden = await ws.receive_json()
            accion = orden.get("accion")
            try:
                if accion == "iniciar":
                    if tarea:
                        tarea.cancel()
                    if sesion:
                        sesion.cerrar()
                    tormenta = orden.get("tormenta", {})
                    if orden.get("estrategia", "ia") == "ia":
                        await asyncio.to_thread(cargar_ia)
                    sesion = await asyncio.to_thread(
                        Sesion, factor=float(tormenta.get("factor", 1.0)),
                        duracion_h=int(tormenta.get("duracion_h", 8)),
                        separacion_h=tormenta.get("separacion_h"),
                        estrategia=orden.get("estrategia", "ia"),
                        averias=orden.get("averias", []),
                        despacho_automatico=orden.get("despacho_automatico", True),
                        ciudad=CIUDAD)
                    estado["pausado"] = False
                    estado["pasos_por_segundo"] = float(orden.get("pasos_por_segundo", estado["pasos_por_segundo"]))
                    await ws.send_json({"tipo": "inicio", "horas_total": sesion.horas_total,
                                        "tormenta": sesion.tormenta, "estrategia": sesion.estrategia,
                                        "lluvia_mm_h": [round(float(v), 2) for v in sesion.lluvia]})
                    tarea = asyncio.create_task(bucle())
                elif accion == "pausar":
                    estado["pausado"] = True
                elif accion == "reanudar":
                    estado["pausado"] = False
                elif accion == "velocidad":
                    estado["pasos_por_segundo"] = max(0.2, min(30.0, float(orden["pasos_por_segundo"])))
                elif accion == "provocar_averia" and sesion:
                    opciones = {k: v for k, v in orden.items() if k not in ("accion", "tipo", "elemento")}
                    averia = await asyncio.to_thread(sesion.provocar_averia, orden["tipo"], orden["elemento"], **opciones)
                    await ws.send_json({"tipo": "averia_provocada", "averia": averia})
                elif accion == "detener":
                    if tarea:
                        tarea.cancel()
                    break
                else:
                    await ws.send_json({"tipo": "error", "mensaje": f"Orden desconocida o sin sesión: {accion}"})
            except (ValueError, KeyError) as error:
                await ws.send_json({"tipo": "error", "mensaje": str(error)})
    except WebSocketDisconnect:
        pass
    finally:
        if tarea:
            tarea.cancel()
        if sesion:
            await asyncio.to_thread(sesion.cerrar)


if __name__ == "__main__":
    import uvicorn
    print("Página de prueba: http://localhost:8000   ·   Datos del escenario: http://localhost:8000/api/escenario")
    uvicorn.run(app, host="0.0.0.0", port=8000)
