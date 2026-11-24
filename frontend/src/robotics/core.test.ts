import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTerrainModel } from '../city/terrain/terrainHeight';
import { createSyntheticNetwork } from '../city/drainage/createSyntheticNetwork';
import type { GeoFeatureCollection } from '../city/geo/geojsonTypes';
import type { TerrainModel } from '../city/terrain/terrainHeight';
import { buildingPathClear, buildRoboticsWorld, distance3, forwardPath, planRoute, snapWaypoint } from './navigation';
import { RobotRuntime, validateProgram } from './runtime';
import { evaluateCondition, obstacleDistance } from './sensors';
import { decodePrograms, encodePrograms, useRoboticsStore } from './useRoboticsStore';
import { useCityStore } from '../stores/useCityStore';
import type { Program, RoboticsWorld } from './types';

function worldFixture():RoboticsWorld {
 const terrain={getTerrainHeight:()=>-.05,getRavineDistance:()=>100,riverPath:[]} as unknown as TerrainModel;
 const y=.075;
 return {terrain,start:[0,y,0],safeFlightY:30,
 nodes:[{x:0,z:0,edges:[{to:1,length:20,roadId:'r1'},{to:3,length:20,roadId:'r4'}]},{x:20,z:0,edges:[{to:0,length:20,roadId:'r1'},{to:2,length:20,roadId:'r2'}]},{x:20,z:20,edges:[{to:1,length:20,roadId:'r2'},{to:3,length:20,roadId:'r3'}]},{x:0,z:20,edges:[{to:2,length:20,roadId:'r3'},{to:0,length:20,roadId:'r4'}]},{x:100,z:100,edges:[{to:5,length:20,roadId:'island'}]},{x:120,z:100,edges:[{to:4,length:20,roadId:'island'}]}],
 obstacles:[{rings:[[[8,8],[12,8],[12,12],[8,12],[8,8]]],minX:8,maxX:12,minZ:8,maxZ:12}],drainagePoints:[{id:'drain-1',label:'Practice inlet',position:[20,y,0]}]};
}
function advance(runtime:RobotRuntime,seconds=20){for(let i=0;i<seconds*20&&runtime.state.status==='RUNNING';i++)runtime.tick(.05);}
function mission(kind:'inspection'|'maintenance'|'drone'|'emergency'='inspection'){const world=worldFixture();return new RobotRuntime({world,route:[{id:'w1',label:'Destination',position:[20,.075,20]}],speed:10},kind);}

describe('safe robotics interpreter',()=>{
 it('moves continuously on the road, pauses midway and resumes the same instruction',()=>{
  const robot=mission();robot.run([{blockId:'route',kind:'route'},{blockId:'inspect',kind:'inspect'}]);advance(robot,1);
  expect(robot.state.status).toBe('RUNNING');expect(distance3(robot.state.position,robot.state.start)).toBeGreaterThan(0);expect(distance3(robot.state.position,[20,.075,20])).toBeGreaterThan(0);
  robot.pause();const paused=[...robot.state.position];robot.tick(1);expect(robot.state.position).toEqual(paused);expect(robot.state.activeBlockId).toBe('route');
  robot.resume();advance(robot);expect(robot.state.status).toBe('COMPLETED');expect(robot.state.position).toEqual([20,.075,20]);expect(robot.state.inspectionOk).toBe(true);
 });
 it('stops and restarts without a second execution loop',()=>{
  const robot=mission();const program:Program=[{kind:'route',blockId:'route'}];robot.run(program);advance(robot,.5);robot.stop();const stopped=[...robot.state.position];robot.tick(.1);expect(robot.state.position).toEqual(stopped);expect(robot.state.status).toBe('STOPPED');robot.run(program);advance(robot);expect(robot.state.status).toBe('COMPLETED');expect(robot.state.position).toEqual([20,.075,20]);
 });
 it('evaluates sensors after actions and changes only workshop obstructions',()=>{
  const world=worldFixture(),before=JSON.stringify(world.nodes),fill=useCityStore.getState().pipeFill;const robot=new RobotRuntime({world,route:[{id:'w',label:'Inlet',position:world.drainagePoints[0].position}],speed:10},'maintenance');
  robot.run([{kind:'route',blockId:'route'},{kind:'inspectDrain',pointId:'nearest',blockId:'inspect'},{kind:'if',blockId:'check',condition:{kind:'sensor',sensor:'blocked'},then:[{kind:'clearDrain',pointId:'nearest',blockId:'clean'}],else:[{kind:'stop',blockId:'bad'}]},{kind:'if',blockId:'verify',condition:{kind:'sensor',sensor:'blocked'},then:[{kind:'stop',blockId:'bad2'}],else:[{kind:'inspectDrain',pointId:'nearest',blockId:'verify-inspection'}]}]);advance(robot);
  expect(robot.state.status).toBe('COMPLETED');expect(robot.state.blockedPoints['drain-1']).toBe(false);expect(robot.state.inspectionResult).toContain('clear in the workshop');expect(JSON.stringify(world.nodes)).toBe(before);expect(useCityStore.getState().pipeFill).toBe(fill);
 });
 it('keeps the executed program immutable while editor data changes',()=>{
  const robot=mission(),program:Program=[{kind:'wait',seconds:1,blockId:'wait'},{kind:'inspect',blockId:'inspect'}];robot.run(program);program[1]={kind:'stop',blockId:'mutated'};advance(robot);expect(robot.state.status).toBe('COMPLETED');expect(robot.state.inspectionOk).toBe(true);
 });
 it('validates capabilities, parameters and bounded nested loops',()=>{
  expect(()=>validateProgram([{kind:'takeoff',altitude:30,blockId:'bad'}],'inspection')).toThrow('Only drones');
  expect(()=>validateProgram([{kind:'repeat',count:Infinity,body:[],blockId:'bad'}],'inspection')).toThrow();
  expect(()=>validateProgram([{kind:'wait',seconds:NaN,blockId:'bad'}],'inspection')).toThrow();
  const robot=mission();robot.run([{kind:'repeat',count:100,blockId:'outer',body:[{kind:'repeat',count:100,blockId:'inner',body:[{kind:'wait',seconds:0,blockId:'wait'}]}]}]);advance(robot,500);expect(robot.state.status).toBe('ERROR');expect(robot.state.message).toContain('5,000');
 });
 it('rejects invalid destinations and unauthorised direct routes safely',()=>{
  const robot=mission();robot.run([{kind:'waypoint',index:2,blockId:'bad'}]);robot.tick(.05);expect(robot.state.status).toBe('ERROR');expect(robot.state.activeBlockId).toBe('bad');expect(robot.state.position).toEqual(robot.state.start);
  const other=mission();other.state.heading=Math.PI/4;other.run([{kind:'move',metres:20,blockId:'bad'}]);other.tick(.05);expect(other.state.status).toBe('ERROR');expect(other.state.position).toEqual(other.state.start);
 });
 it('flies above registered roofs, returns home and lands continuously',()=>{
  const robot=mission('drone');robot.run([{kind:'takeoff',altitude:10,blockId:'up'},{kind:'route',blockId:'route'},{kind:'inspect',blockId:'look'},{kind:'home',blockId:'home'},{kind:'land',blockId:'down'}]);advance(robot,1);expect(robot.state.position[1]).toBeGreaterThan(.075);expect(robot.state.position[1]).toBeLessThan(30);advance(robot,30);expect(robot.state.status).toBe('COMPLETED');expect(robot.state.airborne).toBe(false);expect(robot.state.position).toEqual(robot.state.start);
 });
 it('requires an airborne drone for hover and preserves its position while hovering',()=>{
  expect(()=>validateProgram([{kind:'hover',seconds:1,blockId:'hover'}],'inspection')).toThrow('Only drones');
  const grounded=mission('drone');grounded.run([{kind:'hover',seconds:1,blockId:'hover'}]);grounded.tick(.05);expect(grounded.state.status).toBe('ERROR');expect(grounded.state.message).toContain('Take off');
  const robot=mission('drone');robot.run([{kind:'takeoff',altitude:30,blockId:'up'},{kind:'hover',seconds:2,blockId:'hover'}]);advance(robot,3.5);expect(robot.state.status).toBe('RUNNING');expect(robot.state.activeBlockId).toBe('hover');const held=[...robot.state.position];advance(robot,3);expect(robot.state.status).toBe('COMPLETED');expect(robot.state.position).toEqual(held);
 });
 it('allows emergency delivery only at a planned destination',()=>{
  const robot=mission('emergency');robot.run([{kind:'deliver',blockId:'deliver'}]);robot.tick(.05);expect(robot.state.status).toBe('ERROR');robot.run([{kind:'route',blockId:'route'},{kind:'confirmArrival',blockId:'arrived'},{kind:'deliver',blockId:'deliver'}]);advance(robot);expect(robot.state.status).toBe('COMPLETED');expect(robot.state.inspectionResult).toContain('supplies delivered');
 });
});

describe('registered road navigation and educational sensors',()=>{
 it('routes around buildings and rejects disconnected roads',()=>{
  const world=worldFixture(),path=planRoute(world,'inspection',world.start,[20,.075,20]);expect(path.length).toBeGreaterThan(2);for(let i=1;i<path.length;i++)expect(buildingPathClear([path[i-1][0],path[i-1][2]],[path[i][0],path[i][2]],world.obstacles)).toBe(true);
  expect(()=>planRoute(world,'inspection',world.start,[100,.075,100])).toThrow('disconnected');expect(()=>snapWaypoint(world,'inspection',230,230)).toThrow('closer');
 });
 it('keeps forward movement in a street corridor and uses actual obstacle distances',()=>{
  const world=worldFixture();expect(forwardPath(world,'inspection',world.start,Math.PI/2,10).at(-1)).toEqual([10,.075,expect.closeTo(0)]);expect(()=>forwardPath(world,'inspection',world.start,Math.PI/4,20)).toThrow('accessible road');expect(obstacleDistance(world,[8,.075,5])).toBeCloseTo(3);const robot=mission();robot.state.position=[8,.075,5];expect(evaluateCondition({kind:'sensor',sensor:'obstacle'},world,robot.state)).toBe(true);
 });
 it('uses the actual Paiporta GeoJSON and retains collision-free connected legs',()=>{
  const data=JSON.parse(readFileSync(new URL('../../public/data/paiporta.geojson',import.meta.url),'utf8')) as GeoFeatureCollection;
  const terrain=createTerrainModel(data.features),network=createSyntheticNetwork(data.features,terrain),world=buildRoboticsWorld(data.features,terrain,network);
  expect(world.nodes.length).toBeGreaterThan(20);expect(world.drainagePoints.length).toBeGreaterThan(5);expect(world.safeFlightY).toBeGreaterThan(20);
  for(const point of world.drainagePoints.filter((_,i)=>i%15===0)){const path=planRoute(world,'maintenance',world.start,point.position);for(let i=1;i<path.length;i++)expect(buildingPathClear([path[i-1][0],path[i-1][2]],[path[i][0],path[i][2]],world.obstacles,.7)).toBe(true);}
 });
});

describe('mission store and program persistence',()=>{
 beforeEach(()=>{useRoboticsStore.getState().configure(worldFixture());useRoboticsStore.getState().selectRobot('inspection');});
 it('round-trips separate Blockly programs and ignores corrupted storage',()=>{
  const programs={inspection:{blocks:{blocks:[{type:'start',id:'one',next:{block:{type:'wait'}}}]}},drone:{blocks:{blocks:[{type:'takeoff'}]}}};expect(decodePrograms(encodePrograms(programs))).toEqual(programs);expect(decodePrograms('{invalid')).toEqual({});expect(decodePrograms('{"version":7,"programs":{}}')).toEqual({});
 });
 it('preserves edited programs after running and pausing instead of restoring stale store snapshots',()=>{
  const store=useRoboticsStore.getState(),runtime=new RobotRuntime({world:store.world!,route:store.route,speed:10},'inspection',store);
  expect(runtime.state).not.toHaveProperty('programs');expect(runtime.state).not.toHaveProperty('saveProgram');expect(runtime.state).not.toHaveProperty('planning');
  store.saveProgram('inspection',{version:'before'});store.run([{kind:'wait',seconds:20,blockId:'wait'}]);store.tick(.1);store.pause();useRoboticsStore.getState().saveProgram('inspection',{version:'after'});store.resume();store.tick(.1);expect(useRoboticsStore.getState().programs.inspection).toEqual({version:'after'});expect(useRoboticsStore.getState().planning).toBe(false);
 });
 it('switches robots with separate programs and resets without deleting blocks or routes',()=>{
  const store=useRoboticsStore.getState();store.saveProgram('inspection',{blocks:['rover']});store.selectRobot('drone');store.saveProgram('drone',{blocks:['drone']});store.selectRobot('inspection');expect(useRoboticsStore.getState().programs.inspection).toEqual({blocks:['rover']});const route=useRoboticsStore.getState().route;store.run([{kind:'route',blockId:'route'}]);for(let i=0;i<20;i++)store.tick(.05);store.reset();expect(useRoboticsStore.getState().position).toEqual(useRoboticsStore.getState().world?.start);expect(useRoboticsStore.getState().route).toEqual(route);expect(useRoboticsStore.getState().programs.drone).toEqual({blocks:['drone']});
 });
});
