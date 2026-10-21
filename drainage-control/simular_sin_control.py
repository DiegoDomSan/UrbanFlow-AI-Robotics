"""Sprint 1 - Primera simulación: una tormenta sobre la red de referencia 'theta', sin control.

Ejecutar con:  python simular_sin_control.py
"""
import pystorms

# 1. Cargar el escenario de referencia (red pequeña con 2 depósitos y 2 válvulas)
env = pystorms.scenarios.theta()

print("Elementos que se pueden controlar:", env.config["action_space"])
print("Lo que observa el controlador:", env.config["states"])

# 2. Simular la tormenta paso a paso, con las válvulas siempre abiertas (= sin control)
done = False
pasos = 0
while not done:
    acciones = [1.0] * len(env.config["action_space"])  # 1.0 = totalmente abierta
    done = env.step(acciones)
    pasos += 1

# 3. Resultado
print("Pasos simulados:", pasos)
print("Rendimiento sin control (menor es mejor):", round(env.performance(), 2))
