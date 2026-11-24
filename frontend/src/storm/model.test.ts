import { describe, expect, it } from 'vitest';
import { LAB, initialWaterState, rainfallAt, stepWater } from './model';

describe('educational storm balance',()=>{
  it('conserves water across runoff, storage, gravity drainage, pump and overflow',()=>{
    let water=initialWaterState();
    for(let i=0;i<360;i++){
      water=stepWater(water,120,i%3 as 0|1|2).state;
      expect(water.storageM3).toBeGreaterThanOrEqual(0);
      expect(water.storageM3).toBeLessThanOrEqual(LAB.capacityM3);
      expect(LAB.initialStorageM3+water.runoffM3).toBeCloseTo(water.storageM3+water.drainedM3+water.pumpedM3+water.overflowM3,7);
    }
    expect(water.overflowM3).toBeGreaterThan(0);
  });
  it('limits outflows and energy to water available rather than creating negative water',()=>{
    const empty={...initialWaterState(),storageM3:0,peakStorageM3:0};
    const result=stepWater(empty,0,2);
    expect(result.state.storageM3).toBe(0);
    expect(result.state.pumpedM3).toBe(0);
    expect(result.state.energyKWh).toBe(0);
    expect(result.outflowM3).toBe(0);
  });
  it('rejects invalid steps and measurements',()=>{
    expect(()=>stepWater(initialWaterState(),10,0,0)).toThrow();
    expect(()=>stepWater(initialWaterState(),10,0,Infinity)).toThrow();
    expect(()=>stepWater(initialWaterState(),NaN,0)).toThrow();
    expect(()=>stepWater(initialWaterState(),10,3 as 0)).toThrow();
  });
  it('repeats exactly the same seeded rainfall and includes a dry recovery period',()=>{
    const config={seed:42,peakRainMMh:95};
    const first=Array.from({length:360},(_,i)=>rainfallAt(i*10,config));
    expect(first).toEqual(Array.from({length:360},(_,i)=>rainfallAt(i*10,config)));
    expect(first.slice(240).every(x=>x===0)).toBe(true);
    expect(first).not.toEqual(Array.from({length:360},(_,i)=>rainfallAt(i*10,{...config,seed:500})));
  });
});

