/** A teaching model, not a calibrated hydrological model or a flood forecast.
 * One storage bucket represents an invented catchment. It is deliberately independent
 * of the mapped pipes, all robotics state and any external AI controller. */
export type PumpAction = 0 | 1 | 2;
export const LAB = Object.freeze({ areaM2: 250_000, runoffCoefficient: .7, capacityM3: 1800,
  passiveDrainM3s: .6, pumpM3s: 3.2, pumpKW: 16, dtSeconds: 10,
  durationSeconds: 3600, rainDurationSeconds: 2400, initialStorageM3: 180 });
export interface StormConfig { peakRainMMh: number; seed: number }
export interface WaterState {
  seconds: number; storageM3: number; rainfallMMh: number; runoffM3: number;
  drainedM3: number; pumpedM3: number; overflowM3: number; energyKWh: number;
  peakStorageM3: number; lastAction: PumpAction;
}
export interface WaterStep { state: WaterState; reward: number; inflowM3: number; outflowM3: number; overflowM3: number }
export const initialWaterState = (): WaterState => ({seconds:0,storageM3:LAB.initialStorageM3,rainfallMMh:0,
  runoffM3:0,drainedM3:0,pumpedM3:0,overflowM3:0,energyKWh:0,peakStorageM3:LAB.initialStorageM3,lastAction:0});
const clamp=(v:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,v));
export function randomSource(seed:number) {
  let state=seed>>>0;
  return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
}
/** Smooth bell-shaped storm plus deterministic, seed-controlled two-minute gusts. */
export function rainfallAt(seconds:number, config:StormConfig):number {
  if(seconds<0||seconds>=LAB.rainDurationSeconds)return 0;
  const envelope=Math.sin(Math.PI*seconds/LAB.rainDurationSeconds);
  const gustSeed=(config.seed+Math.floor(seconds/120)*7919)>>>0;
  const gust=.75+randomSource(gustSeed)()*.5;
  return clamp(config.peakRainMMh,0,140)*envelope*gust;
}
export function stepWater(previous:WaterState, rainfallMMh:number, action:PumpAction, dt:number=LAB.dtSeconds):WaterStep {
  if(!Number.isFinite(dt)||dt<=0||dt>60)throw new Error('The water model requires a time step in (0, 60] seconds.');
  if(action!==0&&action!==1&&action!==2)throw new Error('Unknown pump action.');
  if(!Number.isFinite(rainfallMMh)||rainfallMMh<0)throw new Error('Rainfall must be a non-negative finite value.');
  const inflowM3=rainfallMMh/1000/3600*LAB.areaM2*LAB.runoffCoefficient*dt;
  const available=previous.storageM3+inflowM3;
  const drained=Math.min(available,LAB.passiveDrainM3s*Math.sqrt(previous.storageM3/LAB.capacityM3)*dt);
  const requestedPump=LAB.pumpM3s*(action/2)*dt;
  const pumped=Math.min(Math.max(0,available-drained),requestedPump);
  const remaining=available-drained-pumped;
  const overflow=Math.max(0,remaining-LAB.capacityM3);
  const storage=Math.min(LAB.capacityM3,remaining);
  // Power is charged only for the fraction of the interval with water available.
  const energy=LAB.pumpKW*(action/2)*dt/3600*(requestedPump>0?pumped/requestedPump:0);
  const state:WaterState={seconds:previous.seconds+dt,storageM3:storage,rainfallMMh,
    runoffM3:previous.runoffM3+inflowM3,drainedM3:previous.drainedM3+drained,
    pumpedM3:previous.pumpedM3+pumped,overflowM3:previous.overflowM3+overflow,
    energyKWh:previous.energyKWh+energy,peakStorageM3:Math.max(previous.peakStorageM3,storage),lastAction:action};
  // Teaching-only water-balance score; not a municipal cost function.
  const reward=-overflow*12-energy*8-Math.pow(storage/LAB.capacityM3,3)*.15;
  return {state,reward,inflowM3,outflowM3:drained+pumped,overflowM3:overflow};
}
