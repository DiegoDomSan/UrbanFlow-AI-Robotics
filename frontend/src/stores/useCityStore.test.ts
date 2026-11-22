import { beforeEach,describe,expect,it } from 'vitest';
import { useCityStore } from './useCityStore';
const initial=useCityStore.getInitialState();
beforeEach(()=>useCityStore.setState(initial,true));
describe('independent environment and inspection state',()=>{
  it('keeps the current inspection, camera request and water values through repeated day/night changes',()=>{
    const s=useCityStore.getState();s.setMode('underground');s.select('COL-012');s.setWaterDepth(2.35);s.setPipeFill(72);s.setTerrainOpacity(.24);s.focusAt([12,-3,45]);
    const before={...useCityStore.getState()};
    for(let i=0;i<10;i++){s.setEnvironment('night');s.setEnvironment('day');}
    expect(useCityStore.getState()).toEqual(before);
  });
  it('hides water without discarding fill or selection and hides the network without resetting environment',()=>{
    const s=useCityStore.getState();s.setMode('underground');s.select('SEC-001');s.setPipeFill(100);s.setEnvironment('night');s.setShowPipeWater(false);
    expect(useCityStore.getState()).toMatchObject({showPipeWater:false,pipeFill:100,selectedId:'SEC-001',environment:'night'});
    s.setShowPipeWater(true);s.setDrainageVisible(false);
    expect(useCityStore.getState()).toMatchObject({drainageVisible:false,selectedId:null,pipeFill:100,environment:'night'});
  });
  it('bounds controls and restores the correct water presets without nonfinite geometry inputs',()=>{
    const s=useCityStore.getState();s.setTerrainOpacity(5);s.setPipeFill(-5);s.setWaterDepth(NaN);
    expect(useCityStore.getState()).toMatchObject({terrainOpacity:.55,pipeFill:0,waterDepth:0});
    s.setTerrainOpacity(NaN);s.setPipeFill(Infinity);s.setWaterPreset('storm');
    expect(useCityStore.getState()).toMatchObject({terrainOpacity:.05,pipeFill:0,waterDepth:3.05,waterPreset:'storm'});
    s.setWaterPreset('dry');expect(useCityStore.getState().waterDepth).toBe(0);
  });
});
