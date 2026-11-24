import { lazy, Suspense, useEffect, useState } from 'react';
import { ROBOTS } from './definitions';
const RobotEditor = lazy(() => import('./RobotEditor').then(({RobotEditor}) => ({default:RobotEditor}))); 
import { RobotPicker } from './RobotPicker';
import { useRoboticsStore } from './useRoboticsStore';
import type { RobotKind } from './types';
import './robotics.css';

const statusLabels={IDLE:'Ready to program',RUNNING:'Running your blocks',PAUSED:'Program paused',COMPLETED:'Mission complete',STOPPED:'Program stopped',ERROR:'Check mission feedback'};
/** Kept mounted by App; layout changes never replace the Blockly workspace. */
export function RobotWorkshop({open,onClose}:{open:boolean;onClose:()=>void}) {
  const selected=useRoboticsStore(s=>s.selected);
  const status=useRoboticsStore(s=>s.status);
  const planning=useRoboticsStore(s=>s.planning);
  const message=useRoboticsStore(s=>s.message);
  const world=useRoboticsStore(s=>s.world);
  const [expanded,setExpanded]=useState(true);
  const [choosing,setChoosing]=useState(false);
  useEffect(()=>{if(open){setExpanded(true);setChoosing(!useRoboticsStore.getState().selected);}},[open]);
  const pick=(kind:RobotKind)=>{useRoboticsStore.getState().selectRobot(kind);setChoosing(false);setExpanded(true);};
  const visible=open&&Boolean(selected)&&!choosing;
  const robot=selected?ROBOTS[selected]:null;
  return <>
    {open&&(!selected||choosing)&&(world?<RobotPicker hasRobot={Boolean(selected)} onSelect={pick} onClose={()=>{if(selected)setChoosing(false);else onClose();}}/>:<div className="robot-loading" role="status">Preparing accessible streets for the workshop…</div>)}
    {selected&&<Suspense fallback={<div className="robot-loading" role="status">Loading programming blocks…</div>}><RobotEditor kind={selected} expanded={visible&&expanded&&!planning} onMinimize={()=>setExpanded(false)} onChoose={()=>setChoosing(true)}/></Suspense>}
    {visible&&(!expanded||planning)&&robot&&<section className="robot-dock" aria-label="Robot mission monitor" style={{'--robot-accent':robot.color} as React.CSSProperties}><div className="robot-dock-top"><span className="robot-mini-icon">{robot.icon}</span><div><strong>{robot.shortName}</strong><span className={`robot-status status-${status.toLowerCase()}`}><i/>{statusLabels[status]}</span></div><button className="robot-icon-button" onClick={()=>{useRoboticsStore.getState().setPlanning(false);setExpanded(true);}} aria-label="Expand programming editor" title="Open your blocks">↗</button><button className="robot-icon-button" onClick={()=>{useRoboticsStore.getState().setPlanning(false);onClose();}} aria-label="Hide robot monitor" title="Hide panel; mission continues">×</button></div><p role="status">{planning?'Click a road to add a waypoint. Drag to orbit.':message||'Your program is saved. Expand to keep creating.'}</p><div className="robot-dock-actions">{planning?<button className="robot-primary" onClick={()=>{useRoboticsStore.getState().setPlanning(false);setExpanded(true);}}>✓ Done planning</button>:<button className="robot-primary" onClick={()=>setExpanded(true)}>Open blocks</button>}{status==='RUNNING'&&<button onClick={()=>useRoboticsStore.getState().pause()}>Ⅱ Pause</button>}{status==='PAUSED'&&<button onClick={()=>useRoboticsStore.getState().resume()}>▶ Resume</button>}{(status==='RUNNING'||status==='PAUSED')&&<button onClick={()=>useRoboticsStore.getState().stop()}>■ Stop</button>}</div></section>}
  </>;
}
