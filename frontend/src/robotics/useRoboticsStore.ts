import { create } from 'zustand';
import { ROBOTS } from './definitions';
import { distance3, planRoute, snapWaypoint } from './navigation';
import { initialSnapshot, RobotRuntime } from './runtime';
import type { Position, Program, RobotKind, RobotSnapshot, RoboticsWorld, Waypoint } from './types';

export const PROGRAM_STORAGE_KEY='urbanflow.robotics.programs.v1';
export type StoredPrograms=Partial<Record<RobotKind,unknown>>;
const kinds:RobotKind[]=['inspection','maintenance','drone','emergency'];
export function decodePrograms(value:string|null):StoredPrograms {
 if(!value||value.length>2_000_000)return {};
 try{const parsed=JSON.parse(value);if(parsed?.version!==1||typeof parsed.programs!=='object'||!parsed.programs)return {};const result:StoredPrograms={};for(const kind of kinds)if(parsed.programs[kind]&&typeof parsed.programs[kind]==='object')result[kind]=parsed.programs[kind];return result;}catch{return {};}
}
function loadPrograms():StoredPrograms {try{return typeof localStorage==='undefined'?{}:decodePrograms(localStorage.getItem(PROGRAM_STORAGE_KEY));}catch{return {};}}
export function encodePrograms(programs:StoredPrograms):string {const value=JSON.stringify({version:1,programs});if(value.length>2_000_000)throw new Error('Stored programs exceed the 2 MB local limit.');return value;}
function persistPrograms(programs:StoredPrograms){const encoded=encodePrograms(programs);if(typeof localStorage!=='undefined')localStorage.setItem(PROGRAM_STORAGE_KEY,encoded);}
let runtime:RobotRuntime|null=null;
let waypointId=0;
let renderElapsed=0;
const savedRoutes:Partial<Record<RobotKind,Waypoint[]>>={};
interface RoboticsState extends RobotSnapshot {
 selected:RobotKind|null;world:RoboticsWorld|null;route:Waypoint[];path:Position[];planning:boolean;programs:StoredPrograms;
 configure:(world:RoboticsWorld)=>void;selectRobot:(kind:RobotKind)=>void;saveProgram:(kind:RobotKind,json:unknown)=>void;
 setPlanning:(value:boolean)=>void;addWaypoint:(x:number,z:number)=>void;removeWaypoint:(id:string)=>void;reorderWaypoint:(id:string,delta:-1|1)=>void;clearRoute:()=>void;
 run:(program:Program)=>void;pause:()=>void;resume:()=>void;stop:()=>void;reset:()=>void;tick:(delta:number)=>void;clearLogs:()=>void;
}
function preview(world:RoboticsWorld,kind:RobotKind,position:Position,route:Waypoint[]):Position[]{const path:Position[]=[[...position]];for(const point of route)path.push(...planRoute(world,kind,path.at(-1)!,point.position).slice(1));return path;}
function defaultRoute(world:RoboticsWorld,kind:RobotKind):Waypoint[] {
 const sorted=[...world.drainagePoints].sort((a,b)=>distance3(a.position,world.start)-distance3(b.position,world.start));
 if(kind==='maintenance'&&sorted.length)return [{id:`waypoint-${++waypointId}`,label:sorted[0].label,position:[...sorted[0].position]}];
 const nodes=[...world.nodes].filter(n=>Math.hypot(n.x-world.start[0],n.z-world.start[2])>=20).sort((a,b)=>Math.hypot(a.x-world.start[0],a.z-world.start[2])-Math.hypot(b.x-world.start[0],b.z-world.start[2]));
 for(const node of nodes){try{const target=snapWaypoint(world,kind,node.x,node.z);planRoute(world,kind,world.start,target);return [{id:`waypoint-${++waypointId}`,label:'Practice destination',position:target}];}catch{/* Another connected street may be available. */}}
 return [];
}
const initial:RobotSnapshot={kind:'inspection',status:'IDLE',position:[0,0,0],start:[0,0,0],heading:0,activeBlockId:null,inspectionResult:null,inspectionOk:false,arrived:false,airborne:false,blockedPoints:{},targetDrainId:null,logs:[],message:'Choose a robot to begin.'};
export const useRoboticsStore=create<RoboticsState>((set,get)=>{
 const report=(text:string)=>set(s=>({message:text,logs:[...s.logs,{id:(s.logs.at(-1)?.id??0)+1,text,level:'error' as const}].slice(-100)}));
 const synchronize=()=>{if(runtime)set({...runtime.state,position:[...runtime.state.position],logs:[...runtime.state.logs],blockedPoints:{...runtime.state.blockedPoints}});};
 const editRoute=(route:Waypoint[])=>{const s=get();if(!s.world||!s.selected)return;if(s.status==='RUNNING'||s.status==='PAUSED'){report('Stop the program before editing its route.');return;}
  try{const path=preview(s.world,s.selected,s.position,route);savedRoutes[s.selected]=route;set({route,path,message:route.length?`${route.length} waypoint(s) ready. Run a Follow planned route block.`:'Route cleared. Click an accessible street to add a waypoint.'});}catch(error){report(error instanceof Error?error.message:'Route is not accessible.');}
 };
 return {...initial,selected:null,world:null,route:[],path:[],planning:false,programs:loadPrograms(),
  configure:(world)=>{if(get().world===world)return;runtime=null;for(const kind of kinds)delete savedRoutes[kind];const selected=get().selected;set({world,route:[],path:[],planning:false});if(selected)get().selectRobot(selected);},
  selectRobot:(kind)=>{const s=get();if(!s.world)return;runtime=null;const snapshot=initialSnapshot(s.world,kind),route=savedRoutes[kind]??defaultRoute(s.world,kind);set({...snapshot,selected:kind,route,path:preview(s.world,kind,snapshot.position,route),planning:false});},
  saveProgram:(kind,json)=>{try{const copy=JSON.parse(JSON.stringify(json)),programs={...get().programs,[kind]:copy};encodePrograms(programs);set({programs});try{persistPrograms(programs);}catch{set({message:'Program kept for this session. Browser storage is unavailable or full.'});}}catch{report('This program could not be saved. Keep programs below 2 MB.');}},
  setPlanning:(planning)=>{const s=get();if(planning&&(s.status==='RUNNING'||s.status==='PAUSED')){report('Stop the program before planning a new route.');return;}set({planning:planning&&Boolean(s.selected)});},
  addWaypoint:(x,z)=>{const s=get();if(!s.world||!s.selected)return;if(s.route.length>=30){report('A route can contain at most 30 waypoints.');return;}try{const position=snapWaypoint(s.world,s.selected,x,z);editRoute([...s.route,{id:`waypoint-${++waypointId}`,label:`Waypoint ${s.route.length+1}`,position}]);}catch(error){report(error instanceof Error?error.message:'Invalid waypoint.');}},
  removeWaypoint:(id)=>editRoute(get().route.filter(p=>p.id!==id)),
  reorderWaypoint:(id,delta)=>{const route=[...get().route],index=route.findIndex(p=>p.id===id),next=index+delta;if(index<0||next<0||next>=route.length)return;[route[index],route[next]]=[route[next],route[index]];editRoute(route);},
  clearRoute:()=>editRoute([]),
  run:(program)=>{const s=get();if(!s.world||!s.selected)return;if(s.status==='RUNNING')return;runtime=new RobotRuntime({world:s.world,route:s.route.map(p=>({...p,position:[...p.position]})),speed:ROBOTS[s.selected].speed},s.selected,s);runtime.run(program);set({planning:false});synchronize();},
  pause:()=>{runtime?.pause();synchronize();},resume:()=>{runtime?.resume();synchronize();},
  stop:()=>{if(runtime){runtime.stop();synchronize();}else set({status:'STOPPED',activeBlockId:null,message:'Stopped. The robot remains at its current position.'});},
  reset:()=>{const s=get();if(!s.world||!s.selected)return;runtime=null;const snapshot=initialSnapshot(s.world,s.selected);set({...snapshot,path:preview(s.world,s.selected,snapshot.position,s.route),planning:false,message:'Mission reset to home. Blocks and route are preserved; workshop obstructions are restored.'});},
  tick:(delta)=>{if(!runtime||runtime.state.status!=='RUNNING')return;const before=runtime.state.status,block=runtime.state.activeBlockId;runtime.tick(delta);renderElapsed+=delta;
   // Position updates are shared with R3F at 30 Hz; no timer or second requestAnimationFrame loop.
   if(renderElapsed>=1/30||runtime.state.status!==before||runtime.state.activeBlockId!==block){renderElapsed=0;synchronize();}
  },
  clearLogs:()=>{if(runtime)runtime.state.logs=[];set({logs:[]});},
 };
});
