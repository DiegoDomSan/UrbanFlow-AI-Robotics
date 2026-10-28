import { CityScene } from "./components/CityScene";
import { useCityStore } from "./stores/useCityStore";
import type { ViewMode } from "./types/city";
import "./style.css";
const modes: { id: ViewMode; label: string }[] = [
  { id: "surface", label: "Surface View" },
  { id: "underground", label: "Underground View" },
  { id: "flood", label: "Flood Simulation" },
  { id: "sensors", label: "AI & Sensors" },
];
export default function App() {
  const mode = useCityStore((s) => s.mode),
    setMode = useCityStore((s) => s.setMode),
    selectedId = useCityStore((s) => s.selectedId);
  return (
    <div className="app">
      <header>
        <strong>
          URBANFLOW <span>AI</span>
        </strong>
        <span>Digital Twin · Phase 1</span>
        <small>DEMO / MOCK DATA</small>
      </header>
      <div className="workspace">
        <aside>
          <h3>Visualization</h3>
          {modes.map((m) => (
            <button
              key={m.id}
              className={mode === m.id ? "active" : ""}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
          <p>Modes 3 and 4 are placeholders until later phases.</p>
        </aside>
        <main>
          <CityScene />
        </main>
        <aside>
          <h3>Inspector</h3>
          <p>Urban Digital Twin</p>
          <p>Navigate using the mouse controls.</p>
          <p>City area: 500 × 500 m</p>
          <p>Location: Paiporta, Valencia, Spain</p>
          <p>Geographic source: OpenStreetMap</p>
          <p>Coordinates: X east, Y up, Z south</p>
        </aside>
      </div>
      <footer>
        Simulation engine: not connected · Orbit: drag · Zoom: scroll · Pan:
        right-drag
      </footer>
    </div>
  );
}
