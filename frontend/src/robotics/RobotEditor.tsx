import { useEffect, useRef, useState } from 'react';
import * as Blockly from 'blockly/core';
import { compileRobotProgram, registerRobotBlocks, robotToolbox, starterWorkspace } from './blocks';
import { ROBOTS } from './definitions';
import { useRoboticsStore } from './useRoboticsStore';
import type { RobotKind } from './types';

function withoutBlocklyEvents(action:()=>void){Blockly.Events.disable();try{action();}finally{Blockly.Events.enable();}}

const statusLabels={IDLE:'Ready',RUNNING:'Running',PAUSED:'Paused',COMPLETED:'Completed',STOPPED:'Stopped',ERROR:'Needs attention'};
export function RobotEditor({kind,expanded,onMinimize,onChoose}:{kind:RobotKind;expanded:boolean;onMinimize:()=>void;onChoose:()=>void}) {
  const container=useRef<HTMLDivElement>(null);
  const workspace=useRef<Blockly.WorkspaceSvg|null>(null);
  const currentKind=useRef(kind);
  const loading=useRef(false);
  const status=useRoboticsStore(s=>s.status);
  const activeBlock=useRoboticsStore(s=>s.activeBlockId);
  const route=useRoboticsStore(s=>s.route);
  const logs=useRoboticsStore(s=>s.logs);
  const message=useRoboticsStore(s=>s.message);
  const world=useRoboticsStore(s=>s.world);
  const [error,setError]=useState<string|null>(null);
  const [selectedDrain,setSelectedDrain]=useState('');
  const [instructionsOpen,setInstructionsOpen]=useState(false);
  const locked=status==='RUNNING';
  const robot=ROBOTS[kind];

  useEffect(()=>{
    if(!container.current)return;
    registerRobotBlocks();
    const theme=Blockly.Theme.defineTheme('urbanflow',{name:'urbanflow',base:Blockly.Themes.Classic,componentStyles:{workspaceBackgroundColour:'#eff5f3',toolboxBackgroundColour:'#193643',toolboxForegroundColour:'#e6f1f0',flyoutBackgroundColour:'#dae8e6',flyoutForegroundColour:'#183c44',flyoutOpacity:1,scrollbarColour:'#6a9698',insertionMarkerColour:'#7ce6ce',insertionMarkerOpacity:.6},fontStyle:{family:'system-ui, sans-serif',weight:'500',size:11}});
    const ws=Blockly.inject(container.current,{toolbox:robotToolbox(currentKind.current),theme,renderer:'zelos',media:`${import.meta.env.BASE_URL}blockly-media/`,sounds:false,trashcan:true,grid:{spacing:24,length:2,colour:'#c1d4d1',snap:false},zoom:{controls:true,wheel:true,startScale:.85,maxScale:1.4,minScale:.45,scaleSpeed:1.1},move:{scrollbars:true,drag:true,wheel:true}});
    workspace.current=ws;
    loading.current=true;
    const saved=useRoboticsStore.getState().programs[currentKind.current] ?? starterWorkspace(currentKind.current);
    withoutBlocklyEvents(()=>{try{Blockly.serialization.workspaces.load(saved as object,ws);}catch{Blockly.serialization.workspaces.load(starterWorkspace(currentKind.current) as object,ws);setError('The saved workspace could not be loaded. A starter has been restored.');}});
    loading.current=false;
    useRoboticsStore.getState().saveProgram(currentKind.current,Blockly.serialization.workspaces.save(ws));
    const listener=(event:Blockly.Events.Abstract)=>{
      if(loading.current||event.isUiEvent)return;
      useRoboticsStore.getState().saveProgram(currentKind.current,Blockly.serialization.workspaces.save(ws));
      if(useRoboticsStore.getState().status==='PAUSED'){
        useRoboticsStore.getState().stop();
        setError('Program edited while paused. Run again to execute the updated instructions from the robot’s current position.');
      }
    };
    ws.addChangeListener(listener);
    const resize=new ResizeObserver(()=>{if(container.current?.offsetWidth)Blockly.svgResize(ws);});
    resize.observe(container.current);
    return ()=>{
      resize.disconnect();ws.removeChangeListener(listener);
      useRoboticsStore.getState().saveProgram(currentKind.current,Blockly.serialization.workspaces.save(ws));
      ws.dispose();workspace.current=null;
    };
  },[]);

  useEffect(()=>{
    const ws=workspace.current;
    if(!ws||currentKind.current===kind)return;
    useRoboticsStore.getState().saveProgram(currentKind.current,Blockly.serialization.workspaces.save(ws));
    currentKind.current=kind;loading.current=true;
    withoutBlocklyEvents(()=>{
    ws.updateToolbox(robotToolbox(kind));
    try{Blockly.serialization.workspaces.load((useRoboticsStore.getState().programs[kind] ?? starterWorkspace(kind)) as object,ws);setError(null);}
    catch{Blockly.serialization.workspaces.load(starterWorkspace(kind) as object,ws);setError('The saved workspace could not be loaded. A starter has been restored.');}
    ws.clearUndo();});loading.current=false;
    useRoboticsStore.getState().saveProgram(kind,Blockly.serialization.workspaces.save(ws));
    setSelectedDrain('');
  },[kind]);

  useEffect(()=>{
    if(!expanded){Blockly.hideChaff();return;}
    if(workspace.current){const frame=requestAnimationFrame(()=>{if(workspace.current)Blockly.svgResize(workspace.current);});return()=>cancelAnimationFrame(frame);}
  },[expanded]);
  useEffect(()=>{workspace.current?.highlightBlock(activeBlock);},[activeBlock]);
  useEffect(()=>{
    // Lock DOM input without changing persisted Blockly flags or firing edit events.
    if(container.current)container.current.inert=locked;
    if(locked)Blockly.hideChaff();
  },[locked,kind]);

  function run(){
    const ws=workspace.current;if(!ws)return;
    try{const program=compileRobotProgram(ws,kind);setError(null);useRoboticsStore.getState().run(program);}catch(e){setError(e instanceof Error?e.message:'The program could not be read.');}
  }
  function loadStarter(){
    const ws=workspace.current;if(!ws)return;
    useRoboticsStore.getState().stop();loading.current=true;
    withoutBlocklyEvents(()=>Blockly.serialization.workspaces.load(starterWorkspace(kind) as object,ws));loading.current=false;
    useRoboticsStore.getState().saveProgram(kind,Blockly.serialization.workspaces.save(ws));setError(null);
  }
  function plan(){useRoboticsStore.getState().setPlanning(true);onMinimize();}
  const displayedLogs=logs.slice(-6).reverse();
  return <section className={`robotics-editor ${expanded?'':'robotics-hidden'}`} aria-label="Robot programming editor" aria-hidden={!expanded}>
    <header className="robot-editor-header"><div className="robot-editor-identity"><span className="robot-mini-icon" style={{color:robot.color}}>{robot.icon}</span><div><span className="eyebrow">ROBOTICS WORKSHOP / PROGRAM</span><h2>{robot.name}</h2></div></div><div className="robot-editor-header-actions"><span className={`robot-status status-${status.toLowerCase()}`}><i/>{statusLabels[status]}</span><button onClick={onChoose} disabled={locked}>Change robot</button><button onClick={onMinimize} aria-label="Minimize programming editor">↙ <span>See city</span></button></div></header>
    <div className="robot-editor-controls"><div className="robot-run-controls"><button className="robot-primary" onClick={status==='PAUSED'?()=>useRoboticsStore.getState().resume():run} disabled={locked}>{status==='PAUSED'?'▶ Resume':'▶ Run program'}</button><button onClick={()=>useRoboticsStore.getState().pause()} disabled={!locked}>Ⅱ Pause</button><button onClick={()=>useRoboticsStore.getState().stop()} disabled={!locked&&status!=='PAUSED'}>■ Stop</button><button onClick={()=>{useRoboticsStore.getState().reset();setError(null);}} disabled={locked} title="Return the robot to its start and reset mission results. Your blocks and route remain.">↺ Reset mission</button></div><button className="robot-help-button" onClick={()=>setInstructionsOpen(v=>!v)} aria-expanded={instructionsOpen}>? Quick guide</button></div>
    {instructionsOpen&&<div className="robot-quick-guide"><strong>1. Plan</strong> a route in the city. <strong>2. Drag</strong> blocks from the categories and connect them inside the start block. <strong>3. Run</strong> and choose “See city” to watch. Nested blocks repeat or make decisions. The highlighted block is executing. Pause to inspect; editing while paused stops the current program so your next run uses the changes. Right-click blocks for duplicate/delete; undo with Ctrl/Cmd+Z.</div>}
    <div className="robot-editor-body"><div className="robot-block-column"><div className="robot-block-title"><span>YOUR PROGRAM <small>Drag, connect, experiment.</small></span><button onClick={loadStarter} disabled={locked}>Load starter</button></div><div className={`robot-blockly-shell ${locked?'robot-blockly-locked':''}`}><div className="robot-blockly" ref={container}/>{locked&&<div className="robot-running-shield" aria-label="Program editing locked while running"><span>Program running · pause to edit</span></div>}</div><div className="robot-block-footnote">Blocks are saved locally for each robot. Sensor values are simulated from the model.</div></div>
      <aside className="robot-mission-panel"><div className="robot-mission-heading"><span className="eyebrow">MISSION PLAN</span><h3>Connect code to the city.</h3></div><button className="robot-plan-button" onClick={plan} disabled={locked||status==='PAUSED'}>＋ Plan route on map <span>↗</span></button><p className="robot-small-copy">{kind==='drone'?'Aerial waypoints use a safe cruise height. Take off before flying.':'Map clicks snap to accessible roads. Disconnected streets cannot be reached.'}</p>
        <div className="robot-route-title"><h4>Waypoints <span>{route.length}/30</span></h4><button onClick={()=>useRoboticsStore.getState().clearRoute()} disabled={locked||status==='PAUSED'||route.length===0}>Clear</button></div>
        <ol className="robot-waypoints">{route.map((point,index)=><li key={point.id}><span className="waypoint-number">{index+1}</span><span className="waypoint-name">{point.label}<small>{point.position[0].toFixed(0)}, {point.position[2].toFixed(0)} m</small></span><div className="waypoint-actions"><button title={`Move waypoint ${index+1} up`} aria-label={`Move waypoint ${index+1} up`} disabled={index===0||locked||status==='PAUSED'} onClick={()=>useRoboticsStore.getState().reorderWaypoint(point.id,-1)}>↑</button><button title={`Move waypoint ${index+1} down`} aria-label={`Move waypoint ${index+1} down`} disabled={index===route.length-1||locked||status==='PAUSED'} onClick={()=>useRoboticsStore.getState().reorderWaypoint(point.id,1)}>↓</button><button title={`Delete waypoint ${index+1}`} aria-label={`Delete waypoint ${index+1}`} disabled={locked||status==='PAUSED'} onClick={()=>useRoboticsStore.getState().removeWaypoint(point.id)}>×</button></div></li>)}</ol>
        {!route.length&&<p className="robot-empty-route">No waypoints yet. Choose a destination on the map.</p>}
        {(kind==='inspection'||kind==='maintenance')&&<div className="robot-drain-planner"><label htmlFor="robot-drain-select">Visit an existing drainage entrance</label><select id="robot-drain-select" value={selectedDrain} onChange={e=>setSelectedDrain(e.target.value)} disabled={locked||status==='PAUSED'}><option value="">Choose an entrance…</option>{world?.drainagePoints.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select><button disabled={!selectedDrain||locked||status==='PAUSED'} onClick={()=>{const point=world?.drainagePoints.find(p=>p.id===selectedDrain);if(point)useRoboticsStore.getState().addWaypoint(point.position[0],point.position[2]);}}>Add entrance waypoint</button><p className="robot-small-copy">Follow its route before inspecting. The robot must be within 8 m of the entrance.</p></div>}
        {kind==='maintenance'&&<p className="robot-scenario-note">Workshop obstructions are separate from the drainage simulation. Maintenance changes this practice scenario only.</p>}
        <div className="robot-feedback"><h4>Mission feedback</h4><p className={status==='ERROR'?'robot-error':''} role="status">{message||'Your robot is ready. Try the starter program.'}</p>{error&&<p className="robot-error" role="alert">{error}</p>}<ul>{displayedLogs.map(log=><li key={log.id} className={`log-${log.level}`}><span>{log.level==='success'?'✓':log.level==='error'?'!':'·'}</span>{log.text}</li>)}</ul></div>
      </aside></div>
  </section>;
}
