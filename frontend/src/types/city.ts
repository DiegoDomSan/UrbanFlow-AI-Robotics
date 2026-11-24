export type ViewMode = 'surface' | 'underground' | 'flood' | 'sensors';
export type PositionMeters = readonly [number, number, number];
export interface Building { id: string; position: PositionMeters; dimensions: PositionMeters; kind: 'residential' | 'commercial' | 'office'; }
export interface CityModel { id: string; widthMeters: number; depthMeters: number; buildings: readonly Building[]; }
