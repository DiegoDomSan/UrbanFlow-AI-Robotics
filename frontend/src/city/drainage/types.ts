/** Plain data only: meters, local X east / Y up / Z south. */
export type DrainageNodeKind = 'inlet' | 'manhole' | 'junction' | 'bend' | 'outfall';
export interface DrainageNode {
  id: string;
  kind: DrainageNodeKind;
  x: number;
  y: number;
  z: number;
  surfaceY: number;
  downstreamId: string | null;
}
export interface DrainagePipe {
  id: string;
  kind: 'collector' | 'secondary';
  from: string;
  to: string;
  diameter: number;
  length: number;
  gradient: number;
  fillPercentage: number;
  downstreamId: string | null;
  roadId: string;
}
export interface DrainageNetworkData {
  seed: number;
  label: string;
  nodes: DrainageNode[];
  pipes: DrainagePipe[];
  outfallIds: string[];
  coverageNote: string;
}
