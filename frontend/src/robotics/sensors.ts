import { segmentDistance } from '../city/drainage/streetGraph';
import { buildingPathClear, distance3, nearestDrain } from './navigation';
import type { Condition, NumericValue, RobotSnapshot, RoboticsWorld } from './types';

/** Distance to the nearest registered building footprint; decorative street props are not sensed. */
export function obstacleDistance(world:RoboticsWorld,position:[number,number,number]):number {
 const p:[number,number]=[position[0],position[2]];let best=25;
 for(const obstacle of world.obstacles){if(obstacle.minX>p[0]+25||obstacle.maxX<p[0]-25||obstacle.minZ>p[1]+25||obstacle.maxZ<p[1]-25)continue;
  if(!buildingPathClear(p,p,[obstacle],0))return 0;
  for(const ring of obstacle.rings)for(let i=1;i<ring.length;i++)best=Math.min(best,segmentDistance(p,ring[i-1],ring[i]));
 }return best;
}
export function nearbyBlocked(world:RoboticsWorld,state:RobotSnapshot):boolean {
 try{const p=nearestDrain(world,state.position);return distance3(p.position,state.position)<=8&&Boolean(state.blockedPoints[p.id]);}catch{return false;}
}
function numberValue(value:NumericValue,world:RoboticsWorld,state:RobotSnapshot):number {return value.kind==='number'?value.value:obstacleDistance(world,state.position);}
export function evaluateCondition(condition:Condition,world:RoboticsWorld,state:RobotSnapshot):boolean {
 switch(condition.kind){
  case 'boolean':return condition.value;
  case 'not':return !evaluateCondition(condition.value,world,state);
  case 'and':return evaluateCondition(condition.left,world,state)&&evaluateCondition(condition.right,world,state);
  case 'or':return evaluateCondition(condition.left,world,state)||evaluateCondition(condition.right,world,state);
  case 'status':return state.status===condition.value;
  case 'compare':{const a=numberValue(condition.left,world,state),b=numberValue(condition.right,world,state);switch(condition.op){case 'lt':return a<b;case 'lte':return a<=b;case 'eq':return Math.abs(a-b)<.001;case 'gte':return a>=b;case 'gt':return a>b;}break;}
  case 'sensor':switch(condition.sensor){case 'obstacle':return obstacleDistance(world,state.position)<5.5;case 'arrived':return state.arrived;case 'inspectionOk':return state.inspectionOk;case 'blocked':return nearbyBlocked(world,state);case 'airborne':return state.airborne;}
 }
 return false;
}
