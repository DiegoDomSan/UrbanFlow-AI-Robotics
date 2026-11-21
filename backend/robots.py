"""Flota de robots y despacho: qué robot va a cada alerta, por dónde y qué hace al llegar.

Ciclo de una avería (válvula atascada o tubería obstruida):
    1. INSPECCIÓN: va un robot a confirmar la avería en el sitio.
         - Terrestre, si hay un camino por calles secas y no tarda demasiado más que el dron.
         - Dron, si las calles están cortadas por el agua o el terrestre tardaría mucho.
    2. REPARACIÓN: confirmada la avería, va el robot de tuberías. Se lleva por calles
       hasta el pozo de acceso más cómodo, entra en la red y avanza por dentro hasta la
       avería. Al terminar, la avería desaparece de la simulación.
    3. VUELTA: los robots vuelven a la base.
Ciclo de una inundación (agua en la calle): sale el dron a vigilar la zona desde el aire.

Cada decisión guarda su "razonamiento" en texto, para enseñarlo en la pantalla: el
despacho no es una caja negra.
"""
import math

from ciudad import POZOS_DE_ACCESO, distancia

TIEMPO_INSPECCION_S = 300      # 5 min mirando la zona
TIEMPO_REPARACION_S = {"valvula_atascada": 900, "tuberia_obstruida": 1500}   # 15 y 25 min
MAXIMO_TERRESTRE_S = 15 * 60      # el terrestre va si llega en menos de 15 min

TIPOS_ROBOT = {
    "terrestre": {
        "nombre": "Robot terrestre", "velocidad_m_s": 1.5, "medio": "calles",
        "capacidades": ["inspeccion", "camara", "sensor_gas"],
        "limite": "No pasa por calles con más de 10 cm de agua",
    },
    "dron": {
        "nombre": "Dron", "velocidad_m_s": 10.0, "medio": "aire",
        "capacidades": ["inspeccion", "camara", "vigilancia_inundacion"],
        "autonomia_s": 25 * 60,
        "limite": "Autonomía de 25 minutos; no puede reparar ni entrar en tuberías",
    },
    "tuberia": {
        "nombre": "Robot de tuberías", "velocidad_m_s": 0.4, "medio": "tuberias",
        "velocidad_traslado_m_s": 1.0,
        "capacidades": ["reparar_valvula", "desatascar_tuberia", "camara"],
        "limite": "Entra por un pozo de acceso; necesita llegar a él por calles secas",
    },
}


class Robot:
    def __init__(self, id_robot, tipo, base):
        self.id, self.tipo = id_robot, tipo
        self.base = tuple(base)
        self.posicion = list(base)
        self.estado = "en_base"        # en_base | yendo | trabajando | terminado | volviendo | esperando
        self.mision = None             # id de la alerta
        self.tarea = None              # inspeccion | reparacion | vigilancia
        self.ruta = []                 # lista de puntos [x, z]
        self.recorrido = 0.0           # metros recorridos de la ruta
        self.largo_ruta = 0.0
        self.velocidades = []          # velocidad de cada tramo (el robot de tuberías cambia)
        self.trabajo_restante = 0.0
        self.bajo_tierra = False
        self.tramo_subterraneo_desde = None

    def asignar(self, mision, tarea, ruta, velocidades, trabajo_s, tramo_subterraneo_desde=None):
        self.mision, self.tarea = mision, tarea
        self.ruta, self.velocidades = ruta, velocidades
        self.largo_ruta = sum(distancia(a, b) for a, b in zip(ruta, ruta[1:]))
        self.recorrido = 0.0
        self.trabajo_restante = trabajo_s
        self.tramo_subterraneo_desde = tramo_subterraneo_desde
        self.estado = "yendo"

    def volver(self, ruta, velocidades):
        self.asignar(None, None, ruta, velocidades, 0)
        self.estado = "volviendo"
        self.bajo_tierra = False

    def _acumulados(self):
        """Distancia desde el inicio de la ruta hasta cada punto."""
        acumulados = [0.0]
        for a, b in zip(self.ruta, self.ruta[1:]):
            acumulados.append(acumulados[-1] + distancia(a, b))
        return acumulados

    def avanzar(self, segundos):
        """Mueve el robot durante 'segundos'. Devuelve un evento si pasa algo:
        'llego' (al destino), 'termino' (el trabajo) o 'en_base'."""
        evento = None
        acumulados = self._acumulados()
        while segundos > 1e-9:
            if self.estado == "trabajando":
                usado = min(segundos, self.trabajo_restante)
                self.trabajo_restante -= usado
                segundos -= usado
                if self.trabajo_restante <= 1e-9:
                    self.trabajo_restante = 0
                    self.estado = "terminado"     # espera a que le digan adónde ir
                    return "termino"
                continue
            if self.estado not in ("yendo", "volviendo"):
                break
            if self.recorrido >= self.largo_ruta - 1e-9:      # ha llegado al final de la ruta
                self.recorrido = self.largo_ruta
                self._actualizar_posicion()
                if self.estado == "volviendo":
                    self.estado, self.posicion, self.ruta = "en_base", list(self.base), []
                    self.largo_ruta = self.recorrido = 0.0
                    return "en_base"
                self.estado = "trabajando"
                evento = "llego"
                continue
            # En qué tramo está y a qué velocidad va en ese tramo
            tramo = next(i for i in range(len(acumulados) - 1) if self.recorrido < acumulados[i + 1] - 1e-9)
            velocidad = self.velocidades[min(tramo, len(self.velocidades) - 1)]
            tiempo_fin_tramo = (acumulados[tramo + 1] - self.recorrido) / velocidad
            usado = min(segundos, tiempo_fin_tramo)
            self.recorrido = min(self.largo_ruta, self.recorrido + usado * velocidad)
            segundos -= usado
            self._actualizar_posicion()
        return evento

    def _actualizar_posicion(self):
        if len(self.ruta) < 2:
            return
        acumulados = self._acumulados()
        for i in range(len(self.ruta) - 1):
            if self.recorrido <= acumulados[i + 1] or i == len(self.ruta) - 2:
                a, b = self.ruta[i], self.ruta[i + 1]
                largo = acumulados[i + 1] - acumulados[i]
                t = 0.0 if largo == 0 else min(1.0, (self.recorrido - acumulados[i]) / largo)
                self.posicion = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
                if self.tramo_subterraneo_desde is not None:
                    self.bajo_tierra = i >= self.tramo_subterraneo_desde
                return

    def estado_para_enviar(self):
        return {
            "id": self.id, "tipo": self.tipo, "nombre": TIPOS_ROBOT[self.tipo]["nombre"],
            "posicion": [round(c, 1) for c in self.posicion], "estado": self.estado,
            "bajo_tierra": self.bajo_tierra, "mision": self.mision, "tarea": self.tarea,
            "ruta": [[round(c, 1) for c in p] for p in self.ruta],
            "progreso": round(self.recorrido / self.largo_ruta, 3) if self.largo_ruta else 0,
            "trabajo_restante_s": round(self.trabajo_restante),
        }


class Despacho:
    def __init__(self, ciudad):
        self.ciudad = ciudad
        base = ciudad.base_robots
        self.robots = [Robot("terrestre-1", "terrestre", base), Robot("dron-1", "dron", base),
                       Robot("tuberia-1", "tuberia", base)]
        self.decisiones = []   # registro de cada decisión con su razonamiento

    def libre(self, tipo):
        return next((r for r in self.robots if r.tipo == tipo and r.estado == "en_base"), None)

    def _registrar(self, hora, alerta, robot, tarea, razonamiento):
        decision = {"hora": round(hora, 2), "alerta": alerta["id"], "robot": robot.id if robot else None,
                    "tarea": tarea, "razonamiento": razonamiento}
        self.decisiones.append(decision)
        return decision

    # --- Decisiones -------------------------------------------------------------------
    def enviar_inspeccion(self, alerta, hora, cortadas):
        destino = self.ciudad.posicion_elemento(alerta["elemento"])
        terrestre, dron = self.libre("terrestre"), self.libre("dron")
        razones = []
        ruta, metros = self.ciudad.ruta_por_calles(self.ciudad.base_robots, destino, cortadas) if terrestre else (None, None)
        t_terrestre = metros / TIPOS_ROBOT["terrestre"]["velocidad_m_s"] if metros is not None else math.inf
        metros_aire = distancia(self.ciudad.base_robots, destino)
        t_dron = metros_aire / TIPOS_ROBOT["dron"]["velocidad_m_s"]

        if terrestre is None:
            razones.append("El robot terrestre está ocupado.")
        elif ruta is None:
            razones.append(f"No hay camino por calles secas hasta {alerta['nombre']}: "
                           f"{len(cortadas)} tramos de calle tienen más de 10 cm de agua.")
        else:
            razones.append(f"El robot terrestre llegaría por calles en {t_terrestre / 60:.1f} min ({metros:.0f} m).")
        razones.append(f"El dron llegaría volando en {t_dron / 60:.1f} min ({metros_aire:.0f} m en línea recta).")

        if ruta is not None and t_terrestre <= MAXIMO_TERRESTRE_S:
            razones.append("Se envía el terrestre: llega en menos de 15 min, aguanta más tiempo en la zona "
                           "que el dron y puede medir gases a pie de calle.")
            terrestre.asignar(alerta["id"], "inspeccion", ruta, [TIPOS_ROBOT["terrestre"]["velocidad_m_s"]],
                              TIEMPO_INSPECCION_S)
            return self._registrar(hora, alerta, terrestre, "inspeccion", razones)
        if dron is not None:
            razones.append("Se envía el dron" + (": el terrestre no puede llegar." if ruta is None
                                                 else ": el terrestre tardaría demasiado."))
            dron.asignar(alerta["id"], "inspeccion", [list(self.ciudad.base_robots), list(destino)],
                         [TIPOS_ROBOT["dron"]["velocidad_m_s"]], TIEMPO_INSPECCION_S)
            return self._registrar(hora, alerta, dron, "inspeccion", razones)
        razones.append("No hay ningún robot libre: la inspección queda en espera.")
        return self._registrar(hora, alerta, None, "inspeccion", razones)

    def enviar_reparacion(self, alerta, hora, cortadas):
        robot = self.libre("tuberia")
        razones = []
        if robot is None:
            razones.append("El robot de tuberías está ocupado: la reparación queda en espera.")
            return self._registrar(hora, alerta, None, "reparacion", razones)
        datos = TIPOS_ROBOT["tuberia"]
        opciones = []
        for pozo in POZOS_DE_ACCESO:
            ruta_calle, metros_calle = self.ciudad.ruta_por_calles(self.ciudad.base_robots, self.ciudad.red[pozo], cortadas)
            if ruta_calle is None:
                razones.append(f"El pozo {pozo} no es accesible: las calles hasta él están bajo el agua.")
                continue
            ruta_tubo, metros_tubo = self.ciudad.ruta_por_tuberias(pozo, alerta["elemento"])
            tiempo = metros_calle / datos["velocidad_traslado_m_s"] + metros_tubo / datos["velocidad_m_s"]
            opciones.append((tiempo, pozo, ruta_calle, ruta_tubo, metros_calle, metros_tubo))
        if not opciones:
            razones.append("Ningún pozo de acceso es alcanzable ahora: se espera a que baje el agua.")
            return self._registrar(hora, alerta, None, "reparacion", razones)
        tiempo, pozo, ruta_calle, ruta_tubo, metros_calle, metros_tubo = min(opciones)
        razones.append(f"Entra por el pozo {pozo}: {metros_calle:.0f} m por la calle y {metros_tubo:.0f} m "
                       f"dentro de la tubería, unos {tiempo / 60:.0f} min en total.")
        razones.append(f"Reparación estimada: {TIEMPO_REPARACION_S[alerta['tipo']] / 60:.0f} min.")
        ruta = ruta_calle + ruta_tubo[1:]
        velocidades = ([datos["velocidad_traslado_m_s"]] * (len(ruta_calle) - 1) +
                       [datos["velocidad_m_s"]] * (len(ruta_tubo) - 1))
        robot.asignar(alerta["id"], "reparacion", ruta, velocidades, TIEMPO_REPARACION_S[alerta["tipo"]],
                      tramo_subterraneo_desde=len(ruta_calle) - 1)
        return self._registrar(hora, alerta, robot, "reparacion", razones)

    def enviar_vigilancia(self, alerta, hora):
        dron = self.libre("dron")
        if dron is None:
            return self._registrar(hora, alerta, None, "vigilancia", ["El dron está ocupado."])
        destino = self.ciudad.posicion_elemento(alerta["elemento"])
        dron.asignar(alerta["id"], "vigilancia", [list(self.ciudad.base_robots), list(destino)],
                     [TIPOS_ROBOT["dron"]["velocidad_m_s"]], TIEMPO_INSPECCION_S)
        return self._registrar(hora, alerta, dron, "vigilancia",
                               ["Agua en la calle: el dron vuela a medir la zona inundada desde el aire."])

    def volver_a_base(self, robot, cortadas):
        if robot.tipo == "dron":
            robot.volver([list(robot.posicion), list(robot.base)], [TIPOS_ROBOT["dron"]["velocidad_m_s"]])
            return
        ruta, _ = self.ciudad.ruta_por_calles(robot.posicion, robot.base, cortadas)
        if ruta is None:    # sin camino seco: espera donde está hasta el siguiente intento
            ruta = [list(robot.posicion), list(robot.posicion)]
            robot.volver(ruta, [1.0])
            robot.estado = "esperando"
            return
        ruta = [list(robot.posicion)] + ruta + [list(robot.base)]
        robot.volver(ruta, [TIPOS_ROBOT[robot.tipo].get("velocidad_traslado_m_s",
                                                       TIPOS_ROBOT[robot.tipo]["velocidad_m_s"])])

    def avanzar(self, segundos):
        """Mueve todos los robots. Devuelve los eventos: [(robot, 'llego'|'termino'|'en_base')]."""
        eventos = []
        for robot in self.robots:
            evento = robot.avanzar(segundos)
            if evento:
                eventos.append((robot, evento))
        return eventos

    def estado_para_enviar(self):
        return [r.estado_para_enviar() for r in self.robots]
