import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import * as English from 'blockly/msg/en';
import type { Command, Condition, NumericValue, Program, RobotKind, RuntimeStatus } from './types';
import { useRoboticsStore } from './useRoboticsStore';
import { validateProgram, EXECUTION_LIMITS } from './runtime';

let registered = false;
const colours = { control: '#b48628', movement: '#3177b3', sensing: '#208778', action: '#8757aa' };
const actionBlock = (type:string, message:string, colour:string, args:unknown[] = []) => ({
  type, message0:message, args0:args, previousStatement:null, nextStatement:null, colour,
});
const numberField = (name:string, value:number, min:number, max:number) => ({type:'field_number', name, value, min, max, precision:1});

export function registerRobotBlocks() {
  if (registered) return;
  registered = true;
  // The ESM locale has named string exports; its declaration also advertises a default.
  const locale:Record<string,string>={};
  for(const [key,value] of Object.entries(English))if(typeof value==='string')locale[key]=value;
  Blockly.setLocale(locale);
  Blockly.common.defineBlocksWithJsonArray([
    {type:'uf_start', message0:'when program starts %1 %2', args0:[{type:'input_dummy'},{type:'input_statement',name:'DO'}], colour:colours.control, tooltip:'Connect instructions inside this start block. There must be exactly one start block.'},
    actionBlock('uf_wait','wait %1 seconds',colours.control,[numberField('SECONDS',2,0,60)]),
    {type:'uf_repeat',message0:'repeat %1 times %2 %3',args0:[numberField('COUNT',3,1,100),{type:'input_dummy'},{type:'input_statement',name:'DO'}],previousStatement:null,nextStatement:null,colour:colours.control,tooltip:'Repeat this group a bounded number of times (1–100).'},
    {type:'uf_if',message0:'if %1 then %2',args0:[{type:'input_value',name:'IF',check:'Boolean'},{type:'input_statement',name:'THEN'}],previousStatement:null,nextStatement:null,colour:colours.control},
    {type:'uf_if_else',message0:'if %1 then %2 else %3',args0:[{type:'input_value',name:'IF',check:'Boolean'},{type:'input_statement',name:'THEN'},{type:'input_statement',name:'ELSE'}],previousStatement:null,nextStatement:null,colour:colours.control},
    actionBlock('uf_stop','stop robot and program',colours.control),
    actionBlock('uf_move','move forward %1 metres',colours.movement,[numberField('METRES',5,1,50)]),
    actionBlock('uf_left','turn left %1 degrees',colours.movement,[numberField('DEGREES',90,1,180)]),
    actionBlock('uf_right','turn right %1 degrees',colours.movement,[numberField('DEGREES',90,1,180)]),
    actionBlock('uf_waypoint','move to waypoint %1',colours.movement,[numberField('INDEX',1,1,30)]),
    actionBlock('uf_route','follow planned route',colours.movement),
    actionBlock('uf_home','return to starting point',colours.movement),
    actionBlock('uf_inspect','inspect this area',colours.action),
    actionBlock('uf_takeoff','take off to %1 metres',colours.action,[numberField('ALTITUDE',40,5,150)]),
    actionBlock('uf_altitude','change altitude to %1 metres',colours.action,[numberField('ALTITUDE',40,5,150)]),
    actionBlock('uf_hover','hover for %1 seconds',colours.action,[numberField('SECONDS',3,0,60)]),
    actionBlock('uf_land','land at starting point',colours.action),
    actionBlock('uf_inspect_route','inspect route safety',colours.action),
    actionBlock('uf_deliver','deliver supplies at destination',colours.action),
    actionBlock('uf_confirm','confirm arrival',colours.action),
    {type:'uf_obstacle',message0:'obstacle nearby?',output:'Boolean',colour:colours.sensing,tooltip:'Checks registered building footprints using the simulated proximity sensor.'},
    {type:'uf_distance',message0:'obstacle distance (m)',output:'Number',colour:colours.sensing,tooltip:'Distance to a registered building footprint. This is a simulated sensor, not a physical measurement.'},
    {type:'uf_arrived',message0:'destination reached?',output:'Boolean',colour:colours.sensing},
    {type:'uf_inspection_ok',message0:'inspection successful?',output:'Boolean',colour:colours.sensing},
    {type:'uf_blocked',message0:'nearest drainage point blocked?',output:'Boolean',colour:colours.sensing,tooltip:'Reads the separate educational maintenance scenario. It does not measure or change hydraulic pipe filling.'},
    {type:'uf_airborne',message0:'drone airborne?',output:'Boolean',colour:colours.sensing},
    {type:'uf_status',message0:'robot status is %1',args0:[{type:'field_dropdown',name:'STATUS',options:[['running','RUNNING'],['paused','PAUSED'],['idle','IDLE'],['completed','COMPLETED'],['stopped','STOPPED'],['error','ERROR']]}],output:'Boolean',colour:colours.sensing},
  ]);
  for (const [type,label] of [['uf_inspect_drain','inspect drainage point'],['uf_clear_drain','attempt maintenance at']] as const) {
    Blockly.Blocks[type] = {init(this:Blockly.Block) {
      this.appendDummyInput().appendField(label).appendField(new Blockly.FieldDropdown(() => {
        const points=useRoboticsStore.getState().world?.drainagePoints ?? [];
        return [['nearest accessible point','nearest'],...points.map(p=>[p.label,p.id])] as [string,string][];
      }), 'POINT');
      this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(colours.action);
      this.setTooltip('Visit an existing surface access. Maintenance is a separate educational scenario; no travel through pipes is simulated.');
    }};
  }
}

const block = (type:string) => ({kind:'block',type});
const category = (name:string,colour:string,types:string[]) => ({kind:'category',name,colour,contents:types.map(block)});
export function robotToolbox(kind:RobotKind): Blockly.utils.toolbox.ToolboxDefinition {
  const aerial=kind==='drone';
  const movement=aerial?['uf_waypoint','uf_route','uf_home']:['uf_move','uf_left','uf_right','uf_waypoint','uf_route','uf_home'];
  const actions:Record<RobotKind,string[]>={
    inspection:['uf_inspect','uf_inspect_drain'],
    maintenance:['uf_inspect_drain','uf_clear_drain'],
    drone:['uf_takeoff','uf_altitude','uf_hover','uf_inspect','uf_land'],
    emergency:['uf_inspect_route','uf_deliver','uf_confirm'],
  };
  const sensors=aerial?['uf_arrived','uf_inspection_ok','uf_status']:['uf_obstacle','uf_distance','uf_arrived','uf_inspection_ok','uf_status'];
  if(kind==='maintenance')sensors.push('uf_blocked');
  if(aerial)sensors.push('uf_airborne');
  return {kind:'categoryToolbox',contents:[
    category('Start / control',colours.control,['uf_start','uf_wait','uf_repeat','uf_if','uf_if_else','uf_stop']),
    category('Movement',colours.movement,movement),
    category('Sensors',colours.sensing,sensors),
    category(aerial?'Flight / actions':'Robot actions',colours.action,actions[kind]),
    category('Logic','#667497',['logic_compare','logic_operation','logic_negate','logic_boolean','math_number']),
  ]};
}

type SavedBlock = {type:string;fields?:Record<string,string|number>;inputs?:Record<string,{block:SavedBlock}>;next?:{block:SavedBlock}};
function chain(blocks:SavedBlock[]):SavedBlock|undefined {
  let next:SavedBlock|undefined;
  for(let i=blocks.length-1;i>=0;i--)next={...blocks[i],...(next?{next:{block:next}}:{})};
  return next;
}
export function starterWorkspace(kind:RobotKind):unknown {
  const samples:Record<RobotKind,SavedBlock[]>={
    inspection:[{type:'uf_route'},{type:'uf_inspect'},{type:'uf_wait',fields:{SECONDS:2}}],
    maintenance:[{type:'uf_route'},{type:'uf_inspect_drain',fields:{POINT:'nearest'}},{type:'uf_if_else',inputs:{IF:{block:{type:'uf_blocked'}},THEN:{block:{type:'uf_clear_drain',fields:{POINT:'nearest'}}},ELSE:{block:{type:'uf_wait',fields:{SECONDS:1}}}}}],
    drone:[{type:'uf_takeoff',fields:{ALTITUDE:40}},{type:'uf_route'},{type:'uf_inspect'},{type:'uf_hover',fields:{SECONDS:2}},{type:'uf_home'},{type:'uf_land'}],
    emergency:[{type:'uf_inspect_route'},{type:'uf_route'},{type:'uf_confirm'},{type:'uf_deliver'},{type:'uf_home'}],
  };
  return {blocks:{languageVersion:0,blocks:[{type:'uf_start',x:45,y:35,inputs:{DO:{block:chain(samples[kind])!}}}]}};
}

function numberValue(block:Blockly.Block|null):NumericValue {
  if(!block)throw new Error('Connect a number or distance sensor to the empty comparison input.');
  if(block.type==='uf_distance')return {kind:'distance'};
  if(block.type==='math_number'){
    const value=Number(block.getFieldValue('NUM'));
    if(!Number.isFinite(value))throw new Error('Use a finite number in the comparison.');
    return {kind:'number',value};
  }
  throw new Error('This comparison needs a number or an obstacle-distance sensor.');
}
function condition(block:Blockly.Block|null,depth=0):Condition {
  if(depth>EXECUTION_LIMITS.depth)throw new Error('Keep conditions at most 12 levels deep.');
  if(!block)throw new Error('Connect a sensor or a true/false block to the empty condition.');
  const sensors:Record<string,'obstacle'|'arrived'|'inspectionOk'|'blocked'|'airborne'>={uf_obstacle:'obstacle',uf_arrived:'arrived',uf_inspection_ok:'inspectionOk',uf_blocked:'blocked',uf_airborne:'airborne'};
  if(sensors[block.type])return {kind:'sensor',sensor:sensors[block.type]};
  switch(block.type){
    case 'uf_status': return {kind:'status',value:block.getFieldValue('STATUS') as RuntimeStatus};
    case 'logic_boolean': return {kind:'boolean',value:block.getFieldValue('BOOL')==='TRUE'};
    case 'logic_negate': return {kind:'not',value:condition(block.getInputTargetBlock('BOOL'),depth+1)};
    case 'logic_operation': return {kind:block.getFieldValue('OP')==='AND'?'and':'or',left:condition(block.getInputTargetBlock('A'),depth+1),right:condition(block.getInputTargetBlock('B'),depth+1)};
    case 'logic_compare': {
      const opMap={LT:'lt',LTE:'lte',EQ:'eq',GTE:'gte',GT:'gt'} as const;
      const op=String(block.getFieldValue('OP'));
      if(op==='NEQ')return {kind:'not',value:{kind:'compare',op:'eq',left:numberValue(block.getInputTargetBlock('A')),right:numberValue(block.getInputTargetBlock('B'))}};
      if(!(op in opMap))throw new Error('Unknown comparison.');
      return {kind:'compare',op:opMap[op as keyof typeof opMap],left:numberValue(block.getInputTargetBlock('A')),right:numberValue(block.getInputTargetBlock('B'))};
    }
    default: throw new Error('Use a sensor or logic block for this condition.');
  }
}

/** Convert only our allow-listed blocks into data; Blockly never generates executable JavaScript. */
export function compileRobotProgram(workspace:Blockly.Workspace,kind:RobotKind):Program {
  const top=workspace.getTopBlocks(false).filter(b=>b.isEnabled());
  const starts=top.filter(b=>b.type==='uf_start');
  if(starts.length!==1)throw new Error('Your program needs exactly one “when program starts” block.');
  if(top.length!==1)throw new Error('Connect loose blocks to the start block, or delete them before running.');
  const allowed=new Set<string>();
  const toolbox=robotToolbox(kind) as {contents:{contents:{type:string}[]}[]};
  for(const c of toolbox.contents)for(const b of c.contents)allowed.add(b.type);
  for(const b of workspace.getAllBlocks(false))if(b.isEnabled()&&!allowed.has(b.type))throw new Error('This robot does not support one of the blocks. Choose a block from its toolbox.');
  let count=0;
  const sequence=(first:Blockly.Block|null,depth=0):Command[]=>{
    if(depth>EXECUTION_LIMITS.depth)throw new Error('Keep your program at most 12 levels deep.');
    const result:Command[]=[];
    for(let b=first;b;b=b.getNextBlock()){
      if(++count>EXECUTION_LIMITS.programBlocks)throw new Error('Use at most 500 instructions.');
      if(!b.isEnabled())continue;
      const blockId=b.id;
      const field=(name:string)=>Number(b!.getFieldValue(name));
      switch(b.type){
        case 'uf_wait':result.push({kind:'wait',blockId,seconds:field('SECONDS')});break;
        case 'uf_hover':result.push({kind:'hover',blockId,seconds:field('SECONDS')});break;
        case 'uf_repeat':result.push({kind:'repeat',blockId,count:field('COUNT'),body:sequence(b.getInputTargetBlock('DO'),depth+1)});break;
        case 'uf_if':case 'uf_if_else':result.push({kind:'if',blockId,condition:condition(b.getInputTargetBlock('IF')),then:sequence(b.getInputTargetBlock('THEN'),depth+1),else:sequence(b.getInputTargetBlock('ELSE'),depth+1)});break;
        case 'uf_stop':result.push({kind:'stop',blockId});break;
        case 'uf_move':result.push({kind:'move',blockId,metres:field('METRES')});break;
        case 'uf_left':result.push({kind:'turn',blockId,degrees:field('DEGREES')});break;
        case 'uf_right':result.push({kind:'turn',blockId,degrees:-field('DEGREES')});break;
        case 'uf_waypoint':result.push({kind:'waypoint',blockId,index:field('INDEX')});break;
        case 'uf_route':result.push({kind:'route',blockId});break;
        case 'uf_home':result.push({kind:'home',blockId});break;
        case 'uf_inspect':result.push({kind:'inspect',blockId});break;
        case 'uf_takeoff':result.push({kind:'takeoff',blockId,altitude:field('ALTITUDE')});break;
        case 'uf_altitude':result.push({kind:'altitude',blockId,metres:field('ALTITUDE')});break;
        case 'uf_land':result.push({kind:'land',blockId});break;
        case 'uf_inspect_drain':result.push({kind:'inspectDrain',blockId,pointId:String(b.getFieldValue('POINT'))});break;
        case 'uf_clear_drain':result.push({kind:'clearDrain',blockId,pointId:String(b.getFieldValue('POINT'))});break;
        case 'uf_inspect_route':result.push({kind:'inspectRoute',blockId});break;
        case 'uf_deliver':result.push({kind:'deliver',blockId});break;
        case 'uf_confirm':result.push({kind:'confirmArrival',blockId});break;
        default:throw new Error(`Unsupported instruction: ${b.type}`);
      }
    }
    return result;
  };
  const program=sequence(starts[0].getInputTargetBlock('DO'));
  if(program.length===0)throw new Error('Connect at least one instruction inside your start block.');
  validateProgram(program,kind);
  return program;
}
