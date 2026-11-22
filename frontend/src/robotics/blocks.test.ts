import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as Blockly from 'blockly/core';
import { createTerrainModel } from '../city/terrain/terrainHeight';
import { createSyntheticNetwork } from '../city/drainage/createSyntheticNetwork';
import type { GeoFeatureCollection } from '../city/geo/geojsonTypes';
import { compileRobotProgram, registerRobotBlocks, starterWorkspace } from './blocks';
import { ROBOTS } from './definitions';
import { buildRoboticsWorld, distance3 } from './navigation';
import { RobotRuntime } from './runtime';
import { useRoboticsStore } from './useRoboticsStore';
import type { RobotKind, RoboticsWorld } from './types';

const workspaces:Blockly.Workspace[]=[];
function workspace(json:unknown):Blockly.Workspace {
 const result=new Blockly.Workspace();workspaces.push(result);
 Blockly.Events.disable();
 try{Blockly.serialization.workspaces.load(json as Parameters<typeof Blockly.serialization.workspaces.load>[0],result);}finally{Blockly.Events.enable();}
 return result;
}
function program(block:unknown){return {blocks:{languageVersion:0,blocks:[{type:'uf_start',inputs:{DO:{block}}}]}};}
let world:RoboticsWorld;
beforeAll(()=>{
 registerRobotBlocks();
 const data=JSON.parse(readFileSync(new URL('../../public/data/paiporta.geojson',import.meta.url),'utf8')) as GeoFeatureCollection;
 const terrain=createTerrainModel(data.features),network=createSyntheticNetwork(data.features,terrain);
 world=buildRoboticsWorld(data.features,terrain,network);useRoboticsStore.getState().configure(world);
});
afterEach(()=>{for(const item of workspaces)item.dispose();workspaces.length=0;});

describe('actual Blockly workspaces and the safe interpreter',()=>{
 it.each<RobotKind>(['inspection','maintenance','drone','emergency'])('executes the %s starter on actual Paiporta roads with a seeded destination',kind=>{
  useRoboticsStore.getState().selectRobot(kind);const route=useRoboticsStore.getState().route;
  expect(route.length).toBeGreaterThan(0);
  const compiled=compileRobotProgram(workspace(starterWorkspace(kind)),kind);
  const robot=new RobotRuntime({world,route,speed:ROBOTS[kind].speed},kind);
  robot.run(compiled);let maxDistance=0;
  for(let step=0;step<12000&&robot.state.status==='RUNNING';step++){
   robot.tick(.1);maxDistance=Math.max(maxDistance,distance3(robot.state.position,robot.state.start));
  }
  expect(robot.state.status,robot.state.message).toBe('COMPLETED');expect(maxDistance).toBeGreaterThan(1);
  expect(robot.state.inspectionOk).toBe(true);
  if(kind==='drone'){expect(robot.state.airborne).toBe(false);expect(robot.state.position).toEqual(robot.state.start);}
  if(kind==='maintenance')expect(Object.values(robot.state.blockedPoints)).toContain(false);
  if(kind==='emergency')expect(robot.state.logs.some(log=>log.text.includes('supplies delivered'))).toBe(true);
 });
 it('preserves edited values, connections and stable block IDs through serialization',()=>{
  const original=workspace(starterWorkspace('inspection'));
  const wait=original.getAllBlocks(false).find(block=>block.type==='uf_wait')!;wait.setFieldValue('3','SECONDS');
  const home=original.newBlock('uf_home');wait.nextConnection!.connect(home.previousConnection!);
  const saved=Blockly.serialization.workspaces.save(original),restored=workspace(saved);
  expect(compileRobotProgram(restored,'inspection')).toEqual(compileRobotProgram(original,'inspection'));
  expect(restored.getBlockById(wait.id)?.getFieldValue('SECONDS')).toBe(3);
  expect(restored.getBlockById(wait.id)?.getNextBlock()?.type).toBe('uf_home');
 });
 it('requires one connected start and rejects loose or empty programs',()=>{
  expect(()=>compileRobotProgram(workspace({blocks:{blocks:[]}}),'inspection')).toThrow('exactly one');
  expect(()=>compileRobotProgram(workspace({blocks:{blocks:[{type:'uf_start'}]}}),'inspection')).toThrow('at least one');
  const loose=workspace(starterWorkspace('inspection'));loose.newBlock('uf_wait');
  expect(()=>compileRobotProgram(loose,'inspection')).toThrow('loose blocks');
 });
 it('rejects action blocks and simulated sensors outside the chosen robot capabilities',()=>{
  expect(()=>compileRobotProgram(workspace(program({type:'uf_takeoff'})),'inspection')).toThrow('does not support');
  const sensor=workspace(program({type:'uf_if',inputs:{IF:{block:{type:'uf_obstacle'}},THEN:{block:{type:'uf_wait'}}}}));
  expect(()=>compileRobotProgram(sensor,'drone')).toThrow('does not support');
 });
 it('compiles nested control flow and comparisons into data without generated JavaScript',()=>{
  const nested=workspace(program({type:'uf_repeat',fields:{COUNT:2},inputs:{DO:{block:{type:'uf_if_else',inputs:{IF:{block:{type:'logic_compare',fields:{OP:'NEQ'},inputs:{A:{block:{type:'uf_distance'}},B:{block:{type:'math_number',fields:{NUM:5}}}}}},THEN:{block:{type:'uf_wait',fields:{SECONDS:1}}},ELSE:{block:{type:'uf_stop'}}}}}}}));
  const compiled=compileRobotProgram(nested,'inspection');
  expect(compiled).toMatchObject([{kind:'repeat',count:2,body:[{kind:'if',condition:{kind:'not',value:{kind:'compare',op:'eq',left:{kind:'distance'},right:{kind:'number',value:5}}},then:[{kind:'wait',seconds:1}],else:[{kind:'stop'}]}]}]);
 });
 it('reports incomplete condition connections before running',()=>{
  expect(()=>compileRobotProgram(workspace(program({type:'uf_if',inputs:{THEN:{block:{type:'uf_wait'}}}})),'inspection')).toThrow('empty condition');
 });
 it('preserves flight hover as its own guarded action',()=>{
  const compiled=compileRobotProgram(workspace(program({type:'uf_hover',fields:{SECONDS:3}})),'drone');
  expect(compiled[0]).toMatchObject({kind:'hover',seconds:3});
  const robot=new RobotRuntime({world,route:[],speed:ROBOTS.drone.speed},'drone');robot.run(compiled);robot.tick(.1);
  expect(robot.state.status).toBe('ERROR');expect(robot.state.message).toContain('Take off');
 });
 it('retains the full thirty-waypoint range used by the route planner',()=>{
  const blockWorkspace=workspace(program({type:'uf_waypoint',fields:{INDEX:30}}));
  expect(compileRobotProgram(blockWorkspace,'inspection')[0]).toMatchObject({kind:'waypoint',index:30});
 });
});
