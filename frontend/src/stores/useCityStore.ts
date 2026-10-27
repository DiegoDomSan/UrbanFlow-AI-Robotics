import { create } from 'zustand';
import type { ViewMode } from '../types/city';
interface CityState { mode: ViewMode; selectedId: string | null; setMode: (mode: ViewMode) => void; select: (id: string | null) => void; }
export const useCityStore = create<CityState>((set) => ({
  mode: 'surface', selectedId: null,
  setMode: (mode) => set({ mode, selectedId: null }),
  select: (selectedId) => set({ selectedId })
}));
