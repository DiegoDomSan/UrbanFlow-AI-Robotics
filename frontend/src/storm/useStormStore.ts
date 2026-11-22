import { create } from 'zustand';
import { useCityStore } from '../stores/useCityStore';
import { LAB, initialWaterState, rainfallAt, stepWater, type PumpAction, type WaterState } from './model';
export type StormStatus='IDLE'|'RUNNING'|'PAUSED'|'COMPLETED';
interface StormState {
  storm: WaterState; status: StormStatus; peakRain: number; speed: number; seed: number; manualPump: PumpAction;
  series: WaterState[]; accumulator: number; connected: boolean; message: string;
  setPeak: (v: number) => void; setSpeed: (v: number) => void; setPump: (v: PumpAction) => void;
  setSeed: (v: number) => void; play: () => void; pause: () => void; reset: () => void;
  disconnect: () => void; tick: (wallSeconds: number) => void;
}
const visualise=(s:WaterState)=>{
  // Deliberately a visual index: the storage bucket is NOT the geometric river volume.
  const city=useCityStore.getState();
  city.setWaterDepth(Math.min(3.2,.2+3*s.storageM3/LAB.capacityM3));
  city.setPipeFill(Math.min(100,100*s.storageM3/LAB.capacityM3));
};
export const useStormStore=create<StormState>((set,get)=>({
  storm:initialWaterState(),status:'IDLE',peakRain:95,speed:120,seed:42,manualPump:0,
  series:[initialWaterState()],accumulator:0,connected:false,message:'Choose a storm, then start the experiment.',
  setPeak:v=>{if(get().status==='IDLE')set({peakRain:Math.max(0,Math.min(140,v))});},
  setSeed:v=>{if(get().status==='IDLE')set({seed:Math.floor(Math.max(0,Math.min(99999,v)))});},
  setSpeed:v=>set({speed:Math.max(10,Math.min(300,v))}),
  setPump:v=>{if(v===0||v===1||v===2)set({manualPump:v});},
  play:()=>{
    const s=get();if(s.status==='COMPLETED')return;
    set({status:'RUNNING',connected:true,message:'Storm running. Water and pipe fill show the educational storage index.'});
    visualise(s.storm);
  },
  pause:()=>{if(get().status==='RUNNING')set({status:'PAUSED',message:'Paused. The water balance and clock are frozen.'});},
  reset:()=>{
    const storm=initialWaterState();set({storm,status:'IDLE',series:[storm],accumulator:0,connected:false,message:'Experiment reset. Select conditions before starting.'});
    // Leave independent city controls where the user last saw them until Start is explicit.
  },
  disconnect:()=>set(s=>({connected:false,status:s.status==='RUNNING'?'PAUSED':s.status,message:'City controls released. Start resumes the experiment and reconnects its visual index.'})),
  tick:wallSeconds=>{
    const before=get();if(before.status!=='RUNNING'||!Number.isFinite(wallSeconds)||wallSeconds<=0)return;
    let accumulator=before.accumulator+Math.min(wallSeconds,.25)*before.speed;
    let storm=before.storm;const series=[...before.series];
    while(accumulator>=LAB.dtSeconds&&storm.seconds<LAB.durationSeconds){
      const rain=rainfallAt(storm.seconds,{peakRainMMh:before.peakRain,seed:before.seed});
      const action=before.manualPump;
      storm=stepWater(storm,rain,action).state;accumulator-=LAB.dtSeconds;
      if(storm.seconds%60===0)series.push(storm);
    }
    const done=storm.seconds>=LAB.durationSeconds;
    set({storm,series,accumulator:done?0:accumulator,status:done?'COMPLETED':'RUNNING',
      ...(done?{message:'One-hour experiment complete. Reset to try another scenario.'}:{})});
    if(before.connected&&storm!==before.storm)visualise(storm);
  },
}));
