import { beforeEach, describe, expect, it } from 'vitest';
import { useCityStore } from '../stores/useCityStore';
import { useStormStore } from './useStormStore';
const lab=()=>useStormStore.getState();
beforeEach(()=>{lab().reset();lab().setPeak(95);lab().setSeed(42);lab().setSpeed(120);lab().setPump(0);});
describe('learning runtime transitions and isolation',()=>{
  it('advances only while running, freezes pause, and resets its own clock',()=>{
    lab().tick(.2);expect(lab().storm.seconds).toBe(0);
    lab().play();lab().tick(.2);expect(lab().storm.seconds).toBe(20);
    lab().pause();const frozen=lab().storm;lab().tick(.2);expect(lab().storm).toBe(frozen);
    lab().play();lab().tick(.2);expect(lab().storm.seconds).toBeGreaterThan(20);
    lab().reset();expect(lab().status).toBe('IDLE');expect(lab().storm.seconds).toBe(0);
    expect(lab().connected).toBe(false);
  });
  it('releases city controls without changing camera mode or focus',()=>{
    useCityStore.getState().setMode('underground');useCityStore.getState().focusAt([10,2,3]);
    const revision=useCityStore.getState().cameraRevision;
    lab().play();lab().tick(.2);
    expect(useCityStore.getState().mode).toBe('underground');
    expect(useCityStore.getState().cameraRevision).toBe(revision);
    lab().disconnect();useCityStore.getState().setWaterDepth(.7);lab().tick(.2);
    expect(useCityStore.getState().waterDepth).toBe(.7);
    expect(lab().status).toBe('PAUSED');
  });
  it('locks storm inputs after start and completes within its bounded horizon',()=>{
    lab().play();lab().setPeak(0);lab().setSeed(1);
    expect(lab().peakRain).toBe(95);expect(lab().seed).toBe(42);
    for(let i=0;i<200;i++)lab().tick(.25);
    expect(lab().status).toBe('COMPLETED');expect(lab().storm.seconds).toBe(3600);
    const complete=lab().storm;lab().play();lab().tick(.2);expect(lab().storm).toBe(complete);
  });
});
