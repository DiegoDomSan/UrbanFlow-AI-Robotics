import { useStormStore } from './useStormStore';
const time=(seconds:number)=>`${Math.floor(seconds/60).toString().padStart(2,'0')}:${Math.floor(seconds%60).toString().padStart(2,'0')}`;
/** Keeps the storm visible on the map while its panel is closed. */
export function StormStatus({onOpen}:{onOpen:()=>void}) {
  const s=useStormStore();
  if(s.status==='IDLE')return null;
  return <div className="learning-map-status" onPointerDown={e=>e.stopPropagation()} aria-label="Storm experiment status">
    <button className="learning-status-open" onClick={onOpen}><span className={s.status==='RUNNING'?'learning-live-dot':''}/><strong>Storm · {s.status.toLowerCase()}</strong><small>{time(s.storm.seconds)} · {s.connected?'city storage index linked':'city controls released'}</small></button>
    <div className="learning-map-actions">{s.status==='RUNNING'&&<button onClick={s.pause}>Pause</button>}{s.connected&&<button onClick={s.disconnect}>Release water controls</button>}</div>
  </div>;
}
