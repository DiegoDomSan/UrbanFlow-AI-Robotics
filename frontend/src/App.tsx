import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { CityScene } from './components/CityScene';
import { useCityStore } from './stores/useCityStore';
import { useCityData } from './city/hooks/useCityData';
import { createTerrainModel } from './city/terrain/terrainHeight';
import { calculateWaterStats } from './city/terrain/waterGeometry';
import { createSyntheticNetwork } from './city/drainage/createSyntheticNetwork';
import { validateDrainageNetwork } from './city/drainage/drainageValidation';
import './style.css';
import { RobotMapControls } from './robotics/RobotScene';
import { buildRoboticsWorld } from './robotics/navigation';
import { useRoboticsStore } from './robotics/useRoboticsStore';
import { StormStatus } from './storm/StormStatus';
import { StormRuntime } from './storm/StormRuntime';
const RobotWorkshop = lazy(() => import('./robotics/RobotWorkshop').then(({ RobotWorkshop }) => ({ default: RobotWorkshop })));
const StormPanel = lazy(() => import('./storm/StormPanel').then(({ StormPanel }) => ({ default: StormPanel })));

const number = (value: number, digits = 0) => value.toLocaleString('en-GB', {maximumFractionDigits:digits});
export default function App() {
  const state = useCityStore();
  const [roboticsOpen, setRoboticsOpen] = useState(false);
  const [labTab, setLabTab] = useState<'storm'|null>(null);
  const [roboticsActivated, setRoboticsActivated] = useState(false);
  const [stormActivated, setStormActivated] = useState(false);
  const { data, loading, error } = useCityData();
  const model = useMemo(() => {
    if (!data) return null;
    const terrain = createTerrainModel(data.features);
    const network = createSyntheticNetwork(data.features, terrain);
    const validation = validateDrainageNetwork(network, terrain);
    return {terrain, network, validation};
  }, [data]);
  const roboticsWorld = useMemo(() => roboticsActivated && data && model ? buildRoboticsWorld(data.features, model.terrain, model.network) : null, [roboticsActivated, data, model]);
  useEffect(() => { if (roboticsWorld) useRoboticsStore.getState().configure(roboticsWorld); }, [roboticsWorld]);
  const water = useMemo(() => model ? calculateWaterStats(model.terrain, state.waterDepth) : null, [model, state.waterDepth]);
  const selected = model?.network.pipes.find(pipe => pipe.id === state.selectedId);
  const underground = state.mode === 'underground';
  return <div className={`app ${state.environment} ${underground?'inspection':'surface'}`}>
    <header className="app-header">
      <a className="brand" href="#" aria-label="UrbanFlow AI home"><span className="brand-mark">U<span>F</span></span><strong>URBANFLOW <em>AI</em><small>ROBOTICS / URBAN LAB</small></strong></a>
      <div className="project-title"><span className="status-dot" />Paiporta <span className="muted">/</span> <span>Urban water systems</span></div>
      <div className="header-actions"><div className="environment-switch" role="group" aria-label="Environment lighting">{(['day','night'] as const).map(mode=><button key={mode} className={state.environment===mode?'active':''} aria-pressed={state.environment===mode} onClick={()=>state.setEnvironment(mode)}>{mode==='day'?'☀ Day Mode':'☾ Night Mode'}</button>)}</div><span className="demo-badge">EDUCATIONAL MODEL</span></div>
    </header>
    <div className="workspace">
      <aside className="controls-panel" aria-label="Visualization controls">
        <div className="panel-heading"><span className="eyebrow">EXPLORE THE CITY</span><h1>Paiporta<span>Valencia, Spain</span></h1></div>
        <section className="control-section"><h2><span>01</span> Visualization</h2>
          <button className={`mode-button ${!underground ? 'active' : ''}`} aria-pressed={!underground} onClick={() => state.setMode('surface')}><span className="mode-icon">▱</span><span>Surface View<small>City, terrain and water</small></span><span className="mode-arrow">↗</span></button>
          <button className={`mode-button ${underground ? 'active' : ''}`} aria-pressed={underground} onClick={() => state.setMode('underground')}><span className="mode-icon">▤</span><span>Underground View<small>Explore stormwater infrastructure</small></span><span className="mode-arrow">↗</span></button>
        </section>
        <section className="control-section"><h2><span>02</span> Surface Water</h2>
          <div className="segmented" aria-label="Water scenarios">
            {([['dry','Dry'],['normal','Normal'],['storm','Storm']] as const).map(([preset,label]) => <button key={preset} className={state.waterPreset===preset?'active':''} aria-pressed={state.waterPreset===preset} onClick={() => state.setWaterPreset(preset)}>{label}</button>)}
          </div>
          <label className="slider-label" htmlFor="water-depth">Water Level <output>{state.waterDepth.toFixed(2)} <small>m</small></output></label>
          <input id="water-depth" aria-label="Water Level" type="range" min="0" max="3.2" step="0.05" value={state.waterDepth} onChange={e=>state.setWaterDepth(Number(e.target.value))}/>
          <div className="range-labels"><span>0 m · dry</span><span>3.2 m · bank</span></div>
          <div className="volume-card"><span>ESTIMATED VOLUME</span><strong data-testid="water-volume">{water?number(water.volume):'—'} <small>m³</small></strong><p>Geometric estimate for demonstration</p></div>
          <p className="hint">Uniform level in a synthetic channel. This is not a flood forecast.</p>
        </section>
        <section className="control-section"><h2><span>03</span> Drainage Network</h2>
          <label className="toggle"><span>Show Drainage Network</span><input type="checkbox" checked={state.drainageVisible} onChange={e=>state.setDrainageVisible(e.target.checked)} disabled={!underground}/></label>
          <label className="toggle"><span>Highlight Main Collectors</span><input type="checkbox" checked={state.highlightCollectors} onChange={e=>state.setHighlightCollectors(e.target.checked)}/></label>
          <label className="toggle"><span>Show Pipe Water</span><input type="checkbox" checked={state.showPipeWater} onChange={e=>state.setShowPipeWater(e.target.checked)} disabled={!underground}/></label>
          <label className="slider-label" htmlFor="terrain-opacity">Terrain Opacity <output>{Math.round(state.terrainOpacity*100)}<small>%</small></output></label>
          <input id="terrain-opacity" aria-label="Terrain Opacity" type="range" min="5" max="55" step="1" value={state.terrainOpacity*100} disabled={!underground} onChange={e=>state.setTerrainOpacity(Number(e.target.value)/100)}/>
          <label className="slider-label" htmlFor="pipe-fill">Pipe Fill Percentage <output>{state.pipeFill.toFixed(0)}<small>%</small></output></label>
          <input id="pipe-fill" aria-label="Pipe Fill Percentage" type="range" min="0" max="100" step="1" value={state.pipeFill} onChange={e=>state.setPipeFill(Number(e.target.value))}/>
          <div className="range-labels"><span>Empty</span><span>Full</span></div>
          {!underground && <p className="hint">Open Underground View to inspect the pipes.</p>}
        </section>
        <section className="workshop-launchers" aria-label="Learning workshops"><span className="eyebrow">04 / LEARNING WORKSHOPS</span>
          <button className={roboticsOpen?'active':''} disabled={!model} onClick={()=>{setRoboticsActivated(true);setRoboticsOpen(true);setLabTab(null);}}><span className="workshop-glyph">⌘</span><span>Robotics<small>Choose · program · explore</small></span><b>↗</b></button>
          <button className={labTab==='storm'?'active':''} disabled={!model} onClick={()=>{setStormActivated(true);setLabTab('storm');setRoboticsOpen(false);}}><span className="workshop-glyph">☂</span><span>Storm Simulation<small>Rainfall, storage and drainage</small></span><b>↗</b></button>
          <button disabled title="AI workshop integration is maintained by Sebas"><span className="workshop-glyph">◈</span><span>Artificial Intelligence<small>Integration by Sebas · coming soon</small></span><b>↗</b></button>
          <p className="hint">Robotics and storm workshops run independently. AI integration is maintained by Sebas.</p>
        </section>
      </aside>
      <main className="viewport" aria-label="Interactive Paiporta diorama">
        {data && model ? <CityScene data={data} terrain={model.terrain} network={model.network} /> : <div className="scene-message" role={error?'alert':'status'}><div className="loader-logo">UF</div><h2>{error?'City data could not load':'Preparing Paiporta'}</h2><p>{error || (loading?'Reading local map data and building the model…':'Preparing geometry…')}</p></div>}
        <RobotMapControls />
        <StormRuntime />
        {roboticsActivated && <Suspense fallback={null}><RobotWorkshop open={roboticsOpen} onClose={()=>setRoboticsOpen(false)} /></Suspense>}
        {stormActivated && <Suspense fallback={null}><StormPanel open={labTab==='storm'} onClose={()=>setLabTab(null)} /></Suspense>}
        <StormStatus onOpen={()=>{setStormActivated(true);setLabTab('storm');setRoboticsOpen(false);}} />
        <div className="scene-heading"><span className="eyebrow">PAIPORTA / 39.428° N · 0.4184° W</span><h2>{underground?'The city beneath the city.':'Every street tells a story.'}</h2><p>{underground?'Synthetic drainage · interactive inspection':'Barranco del Poyo · educational city model'}</p></div>
        <div className="camera-tools" role="group" aria-label="Camera">{underground&&<button onClick={()=>state.setCameraView('underground')} title="Underground Overview">◈ <span>Underground Overview</span></button>}<button onClick={()=>state.setCameraView('isometric')} title="Reset isometric view">↗ <span>Isometric</span></button><button onClick={()=>state.setCameraView('top')} title="Top view">⊞ <span>Top</span></button><button onClick={()=>state.setCameraView('section')} title="Terrain section view">▰ <span>Section</span></button></div>
        <div className="scene-bottom"><span className="view-chip"><i className={underground?'cyan':'cyan'}/>{underground?'UNDERGROUND':'SURFACE'}<b>500 × 500 m</b></span><span className="north-marker">↑ N</span></div>
      </main>
      <aside className="inspector-panel" aria-label="Infrastructure Inspector">
        <div className="panel-heading"><span className="eyebrow">READ THE MODEL</span><h2>Infrastructure Inspector</h2></div>
        <div className="network-label"><span className="small-dot"/>Synthetic Stormwater Drainage Network — Educational Model</div>
        <div className="network-stats"><div><strong>{model?.network.pipes.length ?? '—'}</strong><span>pipes</span></div><div><strong>{model?.network.nodes.length ?? '—'}</strong><span>nodes</span></div><div><strong>{model?.network.outfallIds.length ?? '—'}</strong><span>outfall</span></div></div>
        <label className="select-label" htmlFor="pipe-select">Select a pipe</label>
        <select id="pipe-select" value={state.selectedId ?? ''} disabled={!underground || !state.drainageVisible} onChange={e=>state.select(e.target.value || null)}><option value="">Click the network or choose…</option>{model?.network.pipes.map(pipe=><option key={pipe.id} value={pipe.id}>{pipe.id} · {pipe.kind==='collector'?'collector':'secondary'}</option>)}</select>
        {selected ? <section className="pipe-details" aria-live="polite"><div className="selected-heading"><span>SELECTED PIPE</span><h3>{selected.id}</h3><button onClick={()=>state.select(null)} aria-label="Clear selection">×</button></div><button className="focus-pipe" onClick={()=>{
          const a=model!.network.nodes.find(n=>n.id===selected.from)!;
          const b=model!.network.nodes.find(n=>n.id===selected.to)!;
          state.focusAt([(a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2]);
        }}>⌕ Focus on this pipe</button><dl>
          <div><dt>Type</dt><dd>{selected.kind==='collector'?'Main collector':'Secondary'}</dd></div>
          <div><dt>Diameter</dt><dd>{selected.diameter.toFixed(2)} m</dd></div>
          <div><dt>Length</dt><dd>{selected.length.toFixed(1)} m</dd></div>
          <div><dt>Gradient</dt><dd>{(selected.gradient*100).toFixed(2)} %</dd></div>
          <div><dt>Filling</dt><dd>{state.pipeFill.toFixed(0)} %</dd></div>
          <div><dt>Downstream node</dt><dd>{selected.to}</dd></div>
          <div><dt>Next pipe</dt><dd>{selected.downstreamId ?? 'Outfall'}</dd></div>
        </dl></section> : <div className="inspector-empty"><div className="pipe-symbol">⊙━⊙</div><h3>Explore the connections</h3><p>Select a pipe in Underground View to inspect its geometry and downstream connections.</p></div>}
        <section className="legend"><h3>Diorama layers</h3><p><i style={{background:'#e8dbb8'}}/>Synthetic terrain and strata</p><p><i style={{background:'#258e9a'}}/>Surface Water</p><p><i style={{background:'#16d6ee'}}/>Main collector</p><p><i style={{background:'#637fca'}}/>Secondary pipe</p><p><i style={{background:'#40c6e8'}}/>Water inside pipes</p></section>
        <section className="model-notes"><h3>Data and scope</h3><p>Streets and buildings: OpenStreetMap. Terrain, depths, two pools and drainage: synthetic.</p><p>{model?.network.coverageNote}</p><p>Tram tracks, sidewalks, crossings, lights and landscaping are fictional additions for this educational city model.</p><p>Underground View uses a dedicated inspection pass. Thin overview traces fade as you approach; pipe diameters remain to scale.</p>{model && <p className={model.validation.length?'validation-error':'validation-ok'}>{model.validation.length ? `Validation: ${model.validation.length} issue(s)` : '✓ Connected and validated network'}</p>}<p className="attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> · ODbL</p></section>
      </aside>
    </div>
    <footer><span><i className="status-dot"/>Local learning lab <b>·</b> Simulated data</span><span>Orbit: drag <b>·</b> Zoom: scroll <b>·</b> Pan: right-drag / arrow keys</span><span className="footer-unit">UNITS: METRES</span></footer>
  </div>;
}
