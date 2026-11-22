export type Point2 = [number, number];
export type Polygon2 = Point2[][];
export type MultiPolygon2 = Polygon2[];
export interface SurfaceMark {
  x: number; z: number; y: number;
  direction: Point2;
  length: number; width: number;
  roadId: string;
}
export interface StreetLamp {
  x: number; z: number; y: number;
  inward: Point2;
  roadId: string;
}
export interface TrafficSignal {
  x: number; z: number; y: number;
  facing: Point2;
  roadId: string;
}
export interface LandscapePlant { x: number; z: number; y: number; radius: number; height: number; variant: number }
export interface TramCorridor {
  label: 'Fictional educational tram corridor';
  roadId: string;
  start: Point2; end: Point2;
  direction: Point2;
  length: number; gauge: number; y: number;
}
export interface UrbanDetailsData {
  synthetic: true;
  seed: number;
  sidewalks: MultiPolygon2;
  curbs: MultiPolygon2;
  crossingStripes: SurfaceMark[];
  crossingCenters: { x: number; z: number; direction: Point2; roadId: string }[];
  laneMarkings: SurfaceMark[];
  lamps: StreetLamp[];
  signals: TrafficSignal[];
  shrubs: LandscapePlant[];
  grassPatches: LandscapePlant[];
  tram: TramCorridor | null;
  diagnostics: { roads: number; intersections: number; sidewalkArea: number; curbArea: number };
}
