import polygonClipping from 'polygon-clipping';
import type { GeoFeature } from '../geo/geojsonTypes';
import { toWorld } from '../geo/projection';
import { roadSideOffsets } from '../geo/roadGeometry';
import type { Point2, Polygon2, MultiPolygon2 } from './types';
export const distance = (a: Point2, b: Point2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const add = (a: Point2, d: Point2, t: number): Point2 => [a[0] + d[0] * t, a[1] + d[1] * t];
export function pointSegmentDistance(p: Point2, a: Point2, b: Point2): number {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
}
export function inRing(p: Point2, ring: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export const inPolygon = (p: Point2, polygon: Polygon2) => inRing(p, polygon[0]) && !polygon.slice(1).some(r => inRing(p, r));
export function featurePolygons(feature: GeoFeature): MultiPolygon2 {
  const g = feature.geometry;
  return (g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : []).map(p => p.map(r => r.map(toWorld)));
}
export function strip(a: Point2, b: Point2, halfWidth: number): Polygon2 {
  const length = distance(a, b), nx = -(b[1] - a[1]) / length * halfWidth, nz = (b[0] - a[0]) / length * halfWidth;
  return [[[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz], [a[0] + nx, a[1] + nz]]];
}
export function polylineEnvelope(points: Point2[], width: number): Polygon2 {
  const offsets = roadSideOffsets(points, width);
  const left = points.map((p, i) => add(p, offsets[i], 1));
  const right = points.map((p, i) => add(p, offsets[i], -1)).reverse();
  return [[...left, ...right, left[0]]];
}
export function union(polygons: MultiPolygon2): MultiPolygon2 {
  if (!polygons.length) return [];
  return polygonClipping.union(polygons[0], ...polygons.slice(1));
}
export function polygonArea(polygons: MultiPolygon2): number {
  return polygons.reduce((sum, polygon) => sum + polygon.reduce((area, ring, index) => {
    let a = 0;
    for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - p[1] * q[0]; }
    return area + Math.abs(a / 2) * (index ? -1 : 1);
  }, 0), 0);
}
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
