import { LAB } from './model';
import { useStormStore } from './useStormStore';
import './storm.css';
const number=(v:number,d=0)=>v.toLocaleString('en-GB',{maximumFractionDigits:d});
const time=(seconds:number)=>`${Math.floor(seconds/60).toString().padStart(2,'0')}:${Math.floor(seconds%60).toString().padStart(2,'0')}`;
function Plot({values,title,color='#73dfcd',max,axis='time'}:{values:number[];title:string;color?:string;max?:number;axis?:'time'|'episodes'}){
  const lo=Math.min(0,...values),hi=Math.max(max??1,...values),span=Math.max(1,hi-lo);
  const points=values.map((v,i)=>`${8+344*i/Math.max(1,values.length-1)},${92-76*(v-lo)/span}`).join(' ');
  return <svg className="learning-plot" viewBox="0 0 360 110" role="img" aria-label={title}><title>{title}</title>
    <path d="M8 16 V92 H352" stroke="#48606c" fill="none"/><path d="M8 54 H352" stroke="#314956" strokeDasharray="4 4"/>
    <polyline points={points} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round"/>
    <text x="12" y="13">{number(hi)}</text><text x="12" y="106">{number(lo)}</text><text x="270" y="106">{values.length>1?`${axis} →`:'ready'}</text>
  </svg>;
}
export function StormPanel({open,onClose}:{open:boolean;onClose:()=>void}) {
  const s=useStormStore();
  if(!open)return null;
  const locked=s.status!=='IDLE';
  const percent=Math.round(s.storm.storageM3/LAB.capacityM3*100);
  return <section className="learning-panel" aria-label="Flood simulation workshop" onPointerDown={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()}>
    <header className="learning-heading"><div><span className="eyebrow">WATER SYSTEMS / EXPERIMENT 02</span><h2>Build a storm. Observe the balance.</h2></div><button onClick={onClose} aria-label="Close storm panel" title="Close panel; running experiments continue">×</button></header>
    <div className="learning-body">
      <p className="learning-intro">Explore how rainfall, drainage and a pump change an invented catchment's water storage.</p>
      <div className="learning-scope">EDUCATIONAL MODEL <span>Synthetic inputs · no real flood forecast</span></div>
        <div className="learning-status"><span className={s.status==='RUNNING'?'learning-live':''}>{s.status}</span><strong>{time(s.storm.seconds)} <small>/ 60:00 simulated</small></strong></div>
        <label className="learning-label" htmlFor="lab-rain">Nominal peak rainfall <output>{s.peakRain} mm/h</output></label>
        <input id="lab-rain" type="range" min="0" max="140" step="5" value={s.peakRain} disabled={locked} onChange={e=>s.setPeak(Number(e.target.value))}/>
        <div className="learning-row"><label>Storm seed <input aria-label="Storm seed" type="number" min="0" max="99999" value={s.seed} disabled={locked} onChange={e=>s.setSeed(Number(e.target.value))}/></label><label>Playback speed <select aria-label="Storm playback speed" value={s.speed} onChange={e=>s.setSpeed(Number(e.target.value))}><option value="30">30× · 2 real minutes</option><option value="120">120× · 30 real seconds</option><option value="300">300× · 12 real seconds</option></select></label></div>
        {locked&&<p className="learning-help">Reset to change the storm. Pump settings can change during a run.</p>}
        <p className="learning-help">Manual pump control: your choices determine the outflow. This storm model is independent of the AI module.</p>
        <div className="learning-pump" role="group" aria-label="Manual pump level">{([0,1,2] as const).map((action,i)=><button key={action} className={s.manualPump===action?'active':''} aria-pressed={s.manualPump===action} onClick={()=>s.setPump(action)}>{['Off','Half power','Full power'][i]}</button>)}</div>
        <div className="learning-actions"><button className="primary" onClick={s.play} disabled={s.status==='RUNNING'||s.status==='COMPLETED'}>{s.status==='PAUSED'?'Resume storm':'Start storm'}</button><button onClick={s.pause} disabled={s.status!=='RUNNING'}>Pause</button><button onClick={s.reset}>Reset</button></div>
        <div className="learning-metrics"><div><span>Rain now</span><strong>{number(s.storm.rainfallMMh,1)}<small> mm/h</small></strong></div><div><span>Storage / 1,800 m³</span><strong>{number(s.storm.storageM3)}<small> m³ · {percent}%</small></strong></div><div className={s.storm.overflowM3>0?'warning':''}><span>Cumulative overflow</span><strong>{number(s.storm.overflowM3)}<small> m³</small></strong></div><div><span>Pump energy</span><strong>{number(s.storm.energyKWh,2)}<small> kWh</small></strong></div></div>
        <div className="learning-chart-title"><strong>Water held in the teaching tank</strong><span>0–1,800 m³</span></div><Plot values={s.series.map(v=>v.storageM3)} title="Simulated storage through time, in cubic metres" max={LAB.capacityM3}/>
        <dl className="learning-balance"><div><dt>Total runoff in</dt><dd>{number(s.storm.runoffM3)} m³</dd></div><div><dt>Gravity drainage out</dt><dd>{number(s.storm.drainedM3)} m³</dd></div><div><dt>Pumped out</dt><dd>{number(s.storm.pumpedM3)} m³</dd></div><div><dt>Current pump</dt><dd>{['Off','Half power','Full power'][s.storm.lastAction]}</dd></div></dl>
        <p className="learning-help">The city’s water level and pipe fill show a <strong>storage index</strong>, not a calculated hydraulic connection. Overflow is recorded here; the map does not predict which streets flood.</p>
        <button className="learning-text-button" onClick={s.disconnect} disabled={!s.connected}>Pause and release city water controls</button>
      <p className="learning-message" role="status">{s.message}</p>
      <details className="learning-rules"><summary>How this educational model works</summary><p>Invented catchment: 250,000 m²; runoff coefficient: 0.7; storage: 1,800 m³; initial water: 180 m³. A seeded storm lasts 40 minutes, followed by 20 dry minutes. The nominal peak is multiplied by seeded gust factors from 0.75 to 1.25. The model advances in fixed 10-second steps.</p><p>Runoff = rainfall × catchment area × 0.7. Storage gains runoff and loses gravity drainage, pumped water and overflow. Gravity drainage reaches 0.6 m³/s; the pump reaches 3.2 m³/s at 16 kW. Outflows are limited by available water.</p><p>The water balance does not solve flows through mapped pipes, infiltration or street-level flood propagation. No live measurements or robot state is used.</p></details>
    </div>
  </section>;
}

