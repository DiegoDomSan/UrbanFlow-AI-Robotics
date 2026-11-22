import { create } from 'zustand';
import type { ViewMode } from '../types/city';
import { WATER_PRESETS } from '../city/terrain/terrainConfig';

export type WaterPreset = 'dry' | 'normal' | 'storm' | 'custom';
export type EnvironmentMode = 'day' | 'night';
export type CameraView = 'isometric' | 'top' | 'section' | 'underground';
interface CityState {
  mode: ViewMode;
  environment: EnvironmentMode;
  selectedId: string | null;
  waterDepth: number;
  waterPreset: WaterPreset;
  terrainOpacity: number;
  drainageVisible: boolean;
  showPipeWater: boolean;
  pipeFill: number;
  highlightCollectors: boolean;
  cameraView: CameraView;
  cameraRevision: number;
  focusPoint: [number, number, number] | null;
  focusAt: (point: [number, number, number]) => void;
  setMode: (mode: ViewMode) => void;
  setEnvironment: (environment: EnvironmentMode) => void;
  select: (id: string | null) => void;
  setWaterDepth: (depth: number) => void;
  setWaterPreset: (preset: Exclude<WaterPreset, 'custom'>) => void;
  setTerrainOpacity: (opacity: number) => void;
  setDrainageVisible: (visible: boolean) => void;
  setShowPipeWater: (visible: boolean) => void;
  setPipeFill: (fill: number) => void;
  setHighlightCollectors: (highlight: boolean) => void;
  setCameraView: (view: CameraView) => void;
}
const clamp = (value:number,min:number,max:number) => Math.max(min,Math.min(max,Number.isFinite(value)?value:min));
export const useCityStore = create<CityState>((set) => ({
  mode: 'surface', environment: 'day', selectedId: null,
  waterDepth: 0.8, waterPreset: 'normal', terrainOpacity: 0.1,
  drainageVisible: true, showPipeWater: true, pipeFill: 35, highlightCollectors: true,
  cameraView: 'isometric', cameraRevision: 0, focusPoint: null,
  focusAt: (focusPoint) => set(s => ({ focusPoint, cameraRevision: s.cameraRevision + 1 })),
  setMode: (mode) => set(s => ({mode,selectedId:null,focusPoint:null,
    cameraView:mode==='underground'?'underground':'isometric',cameraRevision:s.cameraRevision+1})),
  // Environment changes are deliberately independent from inspection, water and camera state.
  setEnvironment: (environment) => set({ environment }),
  select: (selectedId) => set({ selectedId }),
  setWaterDepth: (depth) => set({ waterDepth: clamp(depth,0,3.2), waterPreset: 'custom' }),
  setWaterPreset: (waterPreset) => set({ waterPreset, waterDepth: WATER_PRESETS[waterPreset] }),
  setTerrainOpacity: (opacity) => set({ terrainOpacity: clamp(opacity,.05,.55) }),
  setDrainageVisible: (drainageVisible) => set({ drainageVisible, selectedId: null }),
  setShowPipeWater: (showPipeWater) => set({ showPipeWater }),
  setPipeFill: (fill) => set({ pipeFill: clamp(fill,0,100) }),
  setHighlightCollectors: (highlightCollectors) => set({ highlightCollectors }),
  setCameraView: (cameraView) => set(s => ({ cameraView, focusPoint: null, cameraRevision: s.cameraRevision + 1 })),
}));
