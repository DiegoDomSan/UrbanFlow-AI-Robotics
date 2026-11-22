import { ROBOTS } from './definitions';
import { distance3, forwardPath, groundPosition, initialHeading, nearestDrain, planRoute, routeLength } from './navigation';
import { evaluateCondition, obstacleDistance } from './sensors';
import type { Command, Condition, MissionContext, NumericValue, Position, Program, RobotKind, RobotSnapshot, RoboticsWorld } from './types';

export const EXECUTION_LIMITS={commands:5000,programBlocks:500,loopCount:100,depth:12,seconds:900};
const statusValues=['IDLE','RUNNING','PAUSED','COMPLETED','STOPPED','ERROR'];
function finite(value:unknown,min:number,max:number,label:string){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error(`${label} must be between ${min} and ${max}.`);}
function numeric(value:NumericValue,kind:RobotKind){if(!value||!['number','distance'].includes(value.kind))throw new Error('Invalid numeric input.');if(value.kind==='number')finite(value.value,-10000,10000,'Number');else if(kind==='drone')throw new Error('This drone has no ground proximity sensor.');}
function validateCondition(c:Condition,kind:RobotKind,depth=0):void {
 if(!c||depth>12)throw new Error('A condition is missing or nested too deeply.');
 switch(c.kind){
  case 'boolean':if(typeof c.value!=='boolean')throw new Error('Invalid boolean.');break;
  case 'not':validateCondition(c.value,kind,depth+1);break;
  case 'and':case 'or':validateCondition(c.left,kind,depth+1);validateCondition(c.right,kind,depth+1);break;
  case 'compare':if(!['lt','lte','eq','gte','gt'].includes(c.op))throw new Error('Invalid comparison.');numeric(c.left,kind);numeric(c.right,kind);break;
  case 'status':if(!statusValues.includes(c.value))throw new Error('Invalid status.');break;
  case 'sensor':if(!['obstacle','arrived','inspectionOk','blocked','airborne'].includes(c.sensor))throw new Error('Unknown sensor.');if(c.sensor==='blocked'&&kind!=='maintenance')throw new Error('Only the maintenance robot has an obstruction sensor.');if(c.sensor==='airborne'&&kind!=='drone')throw new Error('Only the drone has an airborne sensor.');if(c.sensor==='obstacle'&&kind==='drone')throw new Error('The drone does not carry a ground proximity sensor.');break;
  default:throw new Error('Unknown condition.');
 }
}
export function validateProgram(program:Program,kind:RobotKind):void {
 let total=0;const walk=(commands:Command[],depth:number)=>{
  if(!Array.isArray(commands)||depth>EXECUTION_LIMITS.depth)throw new Error('Program nesting is limited to 12 levels.');
  for(const c of commands){if(++total>EXECUTION_LIMITS.programBlocks)throw new Error('Use at most 500 blocks.');if(!c||typeof c.blockId!=='string')throw new Error('An instruction is invalid.');
   switch(c.kind){
    case 'wait':finite(c.seconds,0,60,'Wait');break;
    case 'hover':if(kind!=='drone')throw new Error('Only drones can hover.');finite(c.seconds,0,60,'Hover');break;
    case 'repeat':finite(c.count,1,100,'Repeat count');if(!Number.isInteger(c.count))throw new Error('Repeat count must be a whole number.');walk(c.body,depth+1);break;
    case 'if':validateCondition(c.condition,kind);walk(c.then,depth+1);walk(c.else,depth+1);break;
    case 'move':finite(c.metres,.1,100,'Movement');break;
    case 'turn':finite(c.degrees,-360,360,'Turn');break;
    case 'waypoint':finite(c.index,1,30,'Waypoint number');if(!Number.isInteger(c.index))throw new Error('Waypoint number must be a whole number.');break;
    case 'takeoff':if(kind!=='drone')throw new Error('Only drones can take off.');finite(c.altitude,5,150,'Takeoff altitude');break;
    case 'altitude':if(kind!=='drone')throw new Error('Only drones can change altitude.');finite(c.metres,5,150,'Altitude');break;
    case 'land':if(kind!=='drone')throw new Error('Only drones can land.');break;
    case 'inspectDrain':if(kind==='drone'||kind==='emergency')throw new Error('This robot cannot inspect drainage.');if(typeof c.pointId!=='string')throw new Error('Choose a drainage entrance.');break;
    case 'clearDrain':if(kind!=='maintenance')throw new Error('Only the maintenance robot has a cleaning actuator.');if(typeof c.pointId!=='string')throw new Error('Choose a drainage entrance.');break;
    case 'deliver':case 'confirmArrival':case 'inspectRoute':if(kind!=='emergency')throw new Error('This action belongs to the emergency rover.');break;
    case 'route':case 'home':case 'stop':case 'inspect':break;
    default:throw new Error('Unknown or unsupported instruction.');
   }
  }
 };walk(program,0);if(!total)throw new Error('Connect at least one instruction to the start block.');
}
function* commands(program:Program,state:RobotSnapshot,world:RoboticsWorld):Generator<Command> {
 for(const command of program){yield command;
  if(command.kind==='repeat')for(let i=0;i<command.count;i++)yield* commands(command.body,state,world);
  if(command.kind==='if')yield* commands(evaluateCondition(command.condition,world,state)?command.then:command.else,state,world);
 }
}
type Active={kind:'wait';remaining:number;after?:()=>void}|{kind:'path';points:Position[];index:number;after?:()=>void}|{kind:'turn';remaining:number;direction:number};
export function initialSnapshot(world:RoboticsWorld,kind:RobotKind):RobotSnapshot {
 const blockedPoints:Record<string,boolean>={};world.drainagePoints.forEach((p,i)=>{blockedPoints[p.id]=i%3===0;});
 // Make the nearest accessible inlet a reliable first maintenance exercise.
 const nearest=[...world.drainagePoints].sort((a,b)=>distance3(a.position,world.start)-distance3(b.position,world.start))[0];if(nearest)blockedPoints[nearest.id]=true;
 return {kind,status:'IDLE',position:[...world.start],start:[...world.start],heading:initialHeading(world),activeBlockId:null,inspectionResult:null,inspectionOk:false,arrived:false,airborne:false,blockedPoints,targetDrainId:null,logs:[],message:'Ready. Plan a route and connect instruction blocks.'};
}
/** A single deterministic interpreter driven by the scene clock. No generated JavaScript, timers or eval. */
export class RobotRuntime {
 state:RobotSnapshot;
 private iterator:Generator<Command>|null=null;
 private active:Active|null=null;
 private elapsed=0;
 private executed=0;
 private logId=0;
 constructor(readonly context:MissionContext,kind:RobotKind,previous?:RobotSnapshot){this.state=previous?{kind:previous.kind,status:previous.status,position:[...previous.position],start:[...previous.start],heading:previous.heading,activeBlockId:previous.activeBlockId,inspectionResult:previous.inspectionResult,inspectionOk:previous.inspectionOk,arrived:previous.arrived,airborne:previous.airborne,blockedPoints:{...previous.blockedPoints},targetDrainId:previous.targetDrainId,logs:[...previous.logs],message:previous.message}:initialSnapshot(context.world,kind);this.logId=this.state.logs.at(-1)?.id??0;}
 log(text:string,level:'info'|'success'|'error'='info'){this.state.logs.push({id:++this.logId,text,level});this.state.logs=this.state.logs.slice(-100);this.state.message=text;}
 run(program:Program):boolean {
  this.active=null;this.iterator=null;this.elapsed=0;this.executed=0;
  try{validateProgram(program,this.state.kind);const snapshot=JSON.parse(JSON.stringify(program)) as Program;this.state.status='RUNNING';this.state.arrived=false;this.state.activeBlockId=null;this.iterator=commands(snapshot,this.state,this.context.world);this.log('Program started. Movement uses metres and a simulated mission clock.');return true;}catch(error){this.fail(error);return false;}
 }
 pause(){if(this.state.status==='RUNNING'){this.state.status='PAUSED';this.log('Paused. Resume continues the current instruction.');}}
 resume(){if(this.state.status==='PAUSED'){this.state.status='RUNNING';this.log('Resumed.');}}
 stop(){this.iterator=null;this.active=null;this.state.status='STOPPED';this.state.activeBlockId=null;this.log('Stopped. The robot stays at its current position.');}
 private fail(error:unknown){this.iterator=null;this.active=null;this.state.status='ERROR';this.log(error instanceof Error?error.message:'The instruction could not be executed.','error');}
 tick(delta:number) {
  if(this.state.status!=='RUNNING')return;let budget=Math.min(.1,Math.max(0,Number.isFinite(delta)?delta:0));this.elapsed+=budget;
  if(this.elapsed>EXECUTION_LIMITS.seconds){this.fail(new Error('Mission reached the 15 minute execution limit.'));return;}
  try{for(let transitions=0;transitions<32&&this.state.status==='RUNNING';transitions++){
   if(this.active){const active=this.active;
    if(active.kind==='wait'){const used=Math.min(budget,active.remaining);active.remaining-=used;budget-=used;if(active.remaining>1e-9)break;this.active=null;active.after?.();}
    else if(active.kind==='turn'){const step=Math.min(active.remaining,budget*Math.PI/2);this.state.heading+=step*active.direction;active.remaining-=step;budget-=step/(Math.PI/2);if(active.remaining>1e-9)break;this.state.heading=Math.atan2(Math.sin(this.state.heading),Math.cos(this.state.heading));this.active=null;}
    else {const target=active.points[active.index];if(!target){this.active=null;this.state.arrived=true;active.after?.();continue;}
     const dist=distance3(this.state.position,target),travel=Math.min(dist,this.context.speed*budget);if(dist>1e-8){const dx=target[0]-this.state.position[0],dz=target[2]-this.state.position[2];if(Math.hypot(dx,dz)>.01)this.state.heading=Math.atan2(dx,dz);const ratio=travel/dist;this.state.position=[this.state.position[0]+(target[0]-this.state.position[0])*ratio,this.state.position[1]+(target[1]-this.state.position[1])*ratio,this.state.position[2]+(target[2]-this.state.position[2])*ratio];budget-=travel/this.context.speed;}
     if(dist-travel>.0001)break;this.state.position=[...target];active.index++;if(active.index>=active.points.length){this.active=null;this.state.arrived=true;active.after?.();}
    }
    if(budget<=1e-9)break;
   }
   if(!this.active){const next=this.iterator?.next();if(!next||next.done){this.state.status='COMPLETED';this.state.activeBlockId=null;this.log('Program completed.','success');this.iterator=null;break;}
    if(++this.executed>EXECUTION_LIMITS.commands)throw new Error('Execution stopped after 5,000 instructions. Reduce nested repeats.');
    this.state.activeBlockId=next.value.blockId;this.begin(next.value);if(budget<=1e-9)break;
   }
  }}catch(error){this.fail(error);}
 }
 private path(points:Position[],after?:()=>void){this.state.arrived=false;this.active={kind:'path',points,index:points.length>1?1:0,after};}
 private wait(seconds:number,after?:()=>void){this.active={kind:'wait',remaining:Math.max(.06,seconds),after};}
 private requireAirborne(){if(this.state.kind==='drone'&&!this.state.airborne)throw new Error('Add a Take off block before aerial movement.');}
 private begin(command:Command){const s=this.state,w=this.context.world,kind=s.kind;
  switch(command.kind){
   case 'repeat':case 'if':this.wait(.12);return;
   case 'wait':this.log(`Waiting ${command.seconds} s.`);this.wait(command.seconds);return;
   case 'hover':this.requireAirborne();this.log(`Hovering for ${command.seconds} s.`);this.wait(command.seconds);return;
   case 'stop':this.stop();return;
   case 'turn':this.state.arrived=false;this.active={kind:'turn',remaining:Math.abs(command.degrees)*Math.PI/180,direction:Math.sign(command.degrees)};this.log(`Turning ${command.degrees}°.`);return;
   case 'move':this.requireAirborne();this.path(forwardPath(w,kind,s.position,s.heading,command.metres));this.log(`Moving forward ${command.metres} m.`);return;
   case 'waypoint':{this.requireAirborne();const target=this.context.route[command.index-1];if(!target)throw new Error(`Waypoint ${command.index} does not exist. Add it on the map.`);this.path(planRoute(w,kind,s.position,target.position),()=>this.log(`Reached ${target.label}.`,'success'));this.log(`Travelling to ${target.label}.`);return;}
   case 'route':{this.requireAirborne();if(!this.context.route.length)throw new Error('Add at least one waypoint with Plan route.');const points:Position[]=[[...s.position]];for(const target of this.context.route){const leg=planRoute(w,kind,points[points.length-1],target.position);points.push(...leg.slice(1));}this.path(points,()=>this.log('Planned route completed.','success'));this.log(`Following ${this.context.route.length} waypoint(s), ${routeLength(points).toFixed(0)} m.`);return;}
   case 'home':{this.requireAirborne();this.path(planRoute(w,kind,s.position,s.start),()=>this.log('Returned to the home position.','success'));this.log('Returning home.');return;}
   case 'takeoff':{if(s.airborne)throw new Error('The drone is already airborne.');if(Math.hypot(s.position[0]-s.start[0],s.position[2]-s.start[2])>1)throw new Error('Takeoff is allowed only at the designated home pad.');const y=Math.max(w.safeFlightY,s.start[1]+command.altitude);this.path([s.position,[s.position[0],y,s.position[2]]],()=>{s.airborne=true;this.log(`Cruise height reached: ${y.toFixed(0)} m local Y.`, 'success');});this.log(`Taking off. Building clearance enforces a minimum cruise Y of ${w.safeFlightY} m.`);return;}
   case 'altitude':{this.requireAirborne();const y=s.start[1]+command.metres;if(y<w.safeFlightY)throw new Error(`Use at least ${(w.safeFlightY-s.start[1]).toFixed(0)} m altitude to remain above registered buildings.`);this.path([s.position,[s.position[0],y,s.position[2]]]);this.log(`Changing altitude to ${command.metres} m above home.`);return;}
   case 'land':{this.requireAirborne();if(Math.hypot(s.position[0]-s.start[0],s.position[2]-s.start[2])>1)throw new Error('Return home before landing at the designated pad.');this.path([s.position,groundPosition(w,s.start[0],s.start[2])],()=>{s.airborne=false;this.log('Landed safely at home.','success');});this.log('Landing.');return;}
   case 'inspect':{this.wait(1,()=>{const close=w.drainagePoints.filter(p=>Math.hypot(p.position[0]-s.position[0],p.position[2]-s.position[2])<=30).length;s.inspectionOk=true;s.inspectionResult=kind==='drone'?`Visual survey: ${close} mapped drainage access points within 30 m horizontally. No real camera measurement.`:`Building clearance ${obstacleDistance(w,s.position).toFixed(1)} m (25 m sensor range); ${close} drainage access points within 30 m. Model observations only.`;this.log(s.inspectionResult,'success');});this.log('Inspecting the model around the robot.');return;}
   case 'inspectDrain':case 'clearDrain':{const point=nearestDrain(w,s.position,command.pointId);if(distance3(point.position,s.position)>8)throw new Error(`Move within 8 m of ${point.label} before inspecting or maintaining it.`);s.targetDrainId=point.id;this.wait(command.kind==='clearDrain'?2:1,()=>{if(command.kind==='clearDrain'){s.blockedPoints[point.id]=false;s.inspectionOk=true;s.inspectionResult=`${point.label}: workshop obstruction cleared. Hydraulic state is unchanged.`;}else{s.inspectionOk=!s.blockedPoints[point.id];s.inspectionResult=`${point.label}: ${s.blockedPoints[point.id]?'blocked':'clear'} in the workshop scenario. This is not a real drainage sensor.`;}this.log(s.inspectionResult,'success');});this.log(`${command.kind==='clearDrain'?'Maintaining':'Inspecting'} ${point.label}.`);return;}
   case 'inspectRoute':{this.wait(1,()=>{const points:Position[]=[[...s.position]];for(const p of this.context.route)points.push(...planRoute(w,kind,points.at(-1)!,p.position).slice(1));if(!this.context.route.length)throw new Error('Add a route before inspecting it.');s.inspectionOk=true;s.inspectionResult=`Registered road route checked: ${routeLength(points).toFixed(0)} m. Traffic and people are not modelled.`;this.log(s.inspectionResult,'success');});this.log('Checking the planned road connections.');return;}
   case 'confirmArrival':case 'deliver':{const destination=this.context.route.find(p=>distance3(p.position,s.position)<=2);if(!destination)throw new Error('Reach a planned waypoint before confirming arrival or delivering supplies.');this.wait(command.kind==='deliver'?1.5:.3,()=>{s.arrived=true;s.inspectionOk=true;s.inspectionResult=command.kind==='deliver'?`Symbolic supplies delivered at ${destination.label}. Educational scenario only.`:`Arrival confirmed at ${destination.label}.`;this.log(s.inspectionResult,'success');});return;}
  }
 }
}
