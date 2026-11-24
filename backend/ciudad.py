"""El mapa de Paiporta para la simulación: calles, dónde está la red de drenaje y qué
calles quedan cortadas por el agua.

Usa el MISMO archivo de OpenStreetMap y la MISMA proyección que la ciudad 3D de Diego
(frontend/src/city/geo/projection.ts), así que todas las posiciones (x, z) en metros que
salen de aquí coinciden con su escena:  x = este,  z = sur,  (0, 0) = centro de la ciudad.

La red theta de pystorms no es una red real de Paiporta: es una red de prueba de
2 depósitos. Aquí la "colocamos" en el mapa: cada elemento va a la calle más cercana a
una posición elegida, y la salida va al Barranc de Xiva (el barranco del Poyo).
"""
import json
import math
from pathlib import Path

import networkx as nx

RAIZ = Path(__file__).resolve().parent.parent
ARCHIVOS_MAPA = [
    RAIZ / "frontend" / "public" / "data" / "paiporta.geojson",   # el de Diego, si existe
    Path(__file__).resolve().parent / "datos" / "paiporta.geojson",  # copia de respaldo
]

# Igual que CITY_CONFIG en frontend/src/city/geo/constants.ts
CENTRO_LAT, CENTRO_LON = 39.428, -0.4184
RADIO_TIERRA = 6378137
MEDIO_LADO = 250   # la ciudad 3D es un cuadrado de 500 x 500 m

# Dónde colocamos cada elemento de la red theta (posición aproximada en metros; luego se
# ajusta a la calle más cercana). Son posiciones inventadas pero plausibles.
POSICION_DESEADA = {
    "P1": (-170, 60),     # depósito de tormentas 1 (oeste)
    "P1J": (-110, 20),    # pozo después de la válvula 1
    "P2": (40, 140),      # depósito de tormentas 2 (sur)
    "P2J": (40, 90),      # pozo después de la válvula 2
    "PJ3": (20, -20),     # pozo donde se juntan los dos ramales
    "O": (110, -90),      # salida al barranco
}
BASE_ROBOTS_DESEADA = (-200, -180)   # centro de robots (noroeste)

# Conexiones de la red (de theta.inp): id -> (desde, hasta, tipo)
CONEXIONES = {
    "1": ("P1", "P1J", "valvula"),
    "2": ("P2", "P2J", "valvula"),
    "7": ("P1J", "PJ3", "tuberia"),
    "9": ("P2J", "PJ3", "tuberia"),
    "8": ("PJ3", "O", "tuberia"),
}
POZOS_DE_ACCESO = ["P1J", "P2J", "PJ3"]   # por donde puede entrar el robot de tuberías

# Agua en la calle
PROFUNDIDAD_CHARCO = 0.15         # m: suponemos que el agua se extiende con 15 cm de altura
RADIO_MAXIMO_CHARCO = 160         # m
DRENAJE_CALLE = 0.3              # m³/s que vuelve a la red o se infiltra en cada zona
PROFUNDIDAD_MAXIMA_TERRESTRE = 0.10  # m: más de esto y el robot terrestre no pasa


def a_metros(lon, lat):
    """Longitud/latitud -> (x, z) en metros, igual que toWorld() de Diego."""
    lat0 = math.radians(CENTRO_LAT)
    x = math.radians(lon - CENTRO_LON) * RADIO_TIERRA * math.cos(lat0)
    z = -math.radians(lat - CENTRO_LAT) * RADIO_TIERRA
    return x, z


def dentro(x, z, margen=0):
    return abs(x) <= MEDIO_LADO + margen and abs(z) <= MEDIO_LADO + margen


def distancia(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def distancia_a_segmento(p, a, b):
    ax, az = a
    bx, bz = b
    dx, dz = bx - ax, bz - az
    largo2 = dx * dx + dz * dz
    t = 0.0 if largo2 == 0 else max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - az) * dz) / largo2))
    return distancia(p, (ax + t * dx, az + t * dz))


class Ciudad:
    def __init__(self):
        ruta = next((r for r in ARCHIVOS_MAPA if r.exists()), None)
        if ruta is None:
            raise FileNotFoundError("No encuentro paiporta.geojson (ni el del frontend ni la copia en backend/datos)")
        datos = json.loads(ruta.read_text())
        self.calles = nx.Graph()      # nodos = (x, z) redondeados; aristas con su longitud
        self.barranco = []            # puntos del Barranc de Xiva dentro de la ciudad
        for elemento in datos["features"]:
            geometria, propiedades = elemento["geometry"], elemento["properties"]
            if geometria["type"] != "LineString":
                continue
            puntos = [a_metros(*c[:2]) for c in geometria["coordinates"]]
            if "highway" in propiedades:
                nombre = propiedades.get("name") or propiedades["highway"]
                for a, b in zip(puntos, puntos[1:]):
                    if dentro(*a, 20) or dentro(*b, 20):
                        na, nb = self._clave(a), self._clave(b)
                        if na != nb:
                            self.calles.add_edge(na, nb, largo=distancia(na, nb), nombre=nombre)
            elif propiedades.get("waterway") == "stream":
                self.barranco += [p for p in self._densificar(puntos, 10) if dentro(*p)]

        # Solo la parte de calles que está toda conectada (el resto son trozos sueltos)
        mayor = max(nx.connected_components(self.calles), key=len)
        self.calles = self.calles.subgraph(mayor).copy()
        self.nodos_calle = list(self.calles.nodes)

        # Colocar la red de drenaje en el mapa
        self.red = {}
        for elemento, deseada in POSICION_DESEADA.items():
            if elemento == "O" and self.barranco:
                self.red[elemento] = min(self.barranco, key=lambda p: distancia(p, deseada))
            else:
                self.red[elemento] = self.nodo_calle_mas_cercano(deseada)
        self.base_robots = self.nodo_calle_mas_cercano(BASE_ROBOTS_DESEADA)

        # Red de tuberías como grafo (para el robot de tuberías)
        self.tuberias = nx.Graph()
        for id_conexion, (a, b, tipo) in CONEXIONES.items():
            self.tuberias.add_edge(a, b, id=id_conexion, tipo=tipo, largo=distancia(self.red[a], self.red[b]))

        self.charcos = {}   # nodo de la red -> m³ de agua en la calle

    @staticmethod
    def _clave(p):
        return (round(p[0], 1), round(p[1], 1))

    @staticmethod
    def _densificar(puntos, paso):
        resultado = []
        for a, b in zip(puntos, puntos[1:]):
            n = max(1, int(distancia(a, b) / paso))
            resultado += [(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(n)]
        return resultado + puntos[-1:]

    def nodo_calle_mas_cercano(self, p):
        return min(self.nodos_calle, key=lambda n: distancia(n, p))

    def posicion_elemento(self, elemento):
        """Posición de un nodo o del punto medio de una válvula/tubería."""
        if elemento in self.red:
            return self.red[elemento]
        a, b, _ = CONEXIONES[elemento]
        pa, pb = self.red[a], self.red[b]
        return ((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2)

    # --- Agua en la calle ------------------------------------------------------------
    def actualizar_charcos(self, inundacion_m3, exceso_salida_m3, segundos):
        """Suma el agua que sale a la calle en este paso y resta la que se va drenando.
        El agua que sale por encima del límite (0.5 m³/s) desborda el barranco junto a la salida."""
        entradas = dict(inundacion_m3)
        entradas["O"] = entradas.get("O", 0.0) + exceso_salida_m3
        for nodo, volumen in entradas.items():
            anterior = self.charcos.get(nodo, 0.0)
            self.charcos[nodo] = max(0.0, anterior + volumen - DRENAJE_CALLE * segundos)

    def zonas_inundadas(self):
        zonas = []
        for nodo, volumen in self.charcos.items():
            if volumen < 1:
                continue
            radio = min(RADIO_MAXIMO_CHARCO, math.sqrt(volumen / (math.pi * PROFUNDIDAD_CHARCO)))
            # Si el charco llega al tope de radio, el agua sube de altura en vez de extenderse
            profundidad = volumen / (math.pi * radio * radio)
            zonas.append({"nodo": nodo, "centro": [round(c, 1) for c in self.red[nodo]],
                          "radio_m": round(radio, 1), "profundidad_m": round(profundidad, 2),
                          "volumen_m3": round(volumen)})
        return zonas

    def calles_cortadas(self, zonas=None):
        """Tramos de calle bajo el agua con más profundidad de la que aguanta el robot terrestre."""
        zonas = [z for z in (zonas if zonas is not None else self.zonas_inundadas())
                 if z["profundidad_m"] > PROFUNDIDAD_MAXIMA_TERRESTRE]
        cortadas = set()
        for a, b in self.calles.edges:
            if any(distancia_a_segmento(tuple(z["centro"]), a, b) < z["radio_m"] for z in zonas):
                cortadas.add((a, b))
        return cortadas

    def ruta_por_calles(self, origen, destino, cortadas=()):
        """Camino más corto por calles secas (A*). Devuelve (puntos, metros) o (None, None)."""
        grafo = self.calles.copy()
        grafo.remove_edges_from(cortadas)
        a, b = self.nodo_calle_mas_cercano(origen), self.nodo_calle_mas_cercano(destino)
        try:
            camino = nx.astar_path(grafo, a, b, heuristic=distancia, weight="largo")
        except nx.NetworkXNoPath:
            return None, None
        metros = sum(grafo[u][v]["largo"] for u, v in zip(camino, camino[1:]))
        return [list(p) for p in camino], metros

    def ruta_por_tuberias(self, pozo, elemento):
        """Camino del robot de tuberías desde un pozo de acceso hasta un elemento de la red."""
        if elemento in CONEXIONES:
            destinos = CONEXIONES[elemento][:2]
        else:
            destinos = (elemento,)
        mejor = None
        for destino in destinos:
            camino = nx.shortest_path(self.tuberias, pozo, destino, weight="largo")
            metros = sum(self.tuberias[u][v]["largo"] for u, v in zip(camino, camino[1:]))
            if mejor is None or metros < mejor[1]:
                mejor = (camino, metros)
        camino, metros = mejor
        puntos = [list(self.red[n]) for n in camino]
        if elemento in CONEXIONES:   # termina en el punto medio de la tubería/válvula
            puntos.append(list(self.posicion_elemento(elemento)))
            metros += distancia(self.red[camino[-1]], self.posicion_elemento(elemento))
        return puntos, metros

    def descripcion(self):
        """Todo lo fijo del escenario, para dibujarlo una vez."""
        return {
            "sistema_coordenadas": "metros; x = este, z = sur, (0,0) = centro (igual que toWorld() del frontend)",
            "elementos": [
                {"id": n, "tipo": "deposito" if n in ("P1", "P2") else "salida" if n == "O" else "pozo",
                 "posicion": [round(c, 1) for c in p], "pozo_de_acceso": n in POZOS_DE_ACCESO}
                for n, p in self.red.items()
            ],
            "conexiones": [
                {"id": i, "desde": a, "hasta": b, "tipo": t,
                 "puntos": [[round(c, 1) for c in self.red[a]], [round(c, 1) for c in self.red[b]]]}
                for i, (a, b, t) in CONEXIONES.items()
            ],
            "base_robots": [round(c, 1) for c in self.base_robots],
            "calles": [[list(a), list(b)] for a, b in self.calles.edges],
            "barranco": [[round(x, 1), round(z, 1)] for x, z in self.barranco],
        }
