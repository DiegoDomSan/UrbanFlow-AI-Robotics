import type { StreetNode, buildingObstacles } from '../city/drainage/streetGraph';
import type { TerrainModel } from '../city/terrain/terrainHeight';

export type RobotKind = 'inspection' | 'maintenance' | 'drone' | 'emergency';
export type Position = [number, number, number];
export type RuntimeStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'STOPPED' | 'ERROR';
export interface RobotDefinition {kind:RobotKind;name:string;shortName:string;description:string;purpose:string;sensors:string[];actions:string[];objective:string;color:string;icon:string;speed:number}
export interface Waypoint {id:string;label:string;position:Position}
export interface DrainagePoint {id:string;label:string;position:Position}
export interface RoboticsWorld {
  nodes:StreetNode[];
  obstacles:ReturnType<typeof buildingObstacles>;
  terrain:TerrainModel;
  start:Position;
  drainagePoints:DrainagePoint[];
  /** Conservative cruise floor above the highest registered building, metres in local Y. */
  safeFlightY:number;
}
export type NumericValue = {kind:'number';value:number}|{kind:'distance'};
export type Condition =
  | {kind:'boolean';value:boolean}
  | {kind:'not';value:Condition}
  | {kind:'and'|'or';left:Condition;right:Condition}
  | {kind:'compare';left:NumericValue;op:'lt'|'lte'|'eq'|'gte'|'gt';right:NumericValue}
  | {kind:'sensor';sensor:'obstacle'|'arrived'|'inspectionOk'|'blocked'|'airborne'}
  | {kind:'status';value:RuntimeStatus};
export type Command = {blockId:string} & (
  | {kind:'wait'|'hover';seconds:number}
  | {kind:'repeat';count:number;body:Command[]}
  | {kind:'if';condition:Condition;then:Command[];else:Command[]}
  | {kind:'move';metres:number}
  | {kind:'turn';degrees:number}
  | {kind:'waypoint';index:number}
  | {kind:'takeoff';altitude:number}
  | {kind:'altitude';metres:number}
  | {kind:'inspectDrain'|'clearDrain';pointId:string}
  | {kind:'route'|'home'|'stop'|'land'|'inspect'|'deliver'|'confirmArrival'|'inspectRoute'}
);
export type Program = Command[];
export interface MissionLog {id:number;text:string;level:'info'|'success'|'error'}
export interface RobotSnapshot {
  kind:RobotKind;status:RuntimeStatus;position:Position;heading:number;start:Position;
  activeBlockId:string|null;inspectionResult:string|null;inspectionOk:boolean;arrived:boolean;airborne:boolean;
  blockedPoints:Record<string,boolean>;targetDrainId:string|null;logs:MissionLog[];message:string;
}
export interface MissionContext {world:RoboticsWorld;route:Waypoint[];speed:number}
