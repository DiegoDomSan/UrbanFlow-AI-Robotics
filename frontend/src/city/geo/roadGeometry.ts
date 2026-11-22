import * as THREE from 'three';
import type { GeoFeature } from './geojsonTypes';
import { CITY_CONFIG, TERRAIN } from './constants';
import { toWorld } from './projection';
import type { TerrainModel } from '../terrain/terrainHeight';

export type RoadPoint = [number, number];
export interface RoadLine {
  id: string;
  highway: string;
  width: number;
  bridge: boolean;
  surface: string;
  points: RoadPoint[];
}

/** Prefer an explicit mapped width. Other widths are visual assumptions in metres. */
export function roadWidth(highway: string, properties: Record<string, unknown> = {}): number {
  const value = String(properties.width ?? '').trim();
  const mapped = /^\d+(?:\.\d+)?(?:\s*m)?$/.test(value) ? Number.parseFloat(value) : NaN;
  if (Number.isFinite(mapped) && mapped >= .5 && mapped <= 30) return mapped;
  const widths: Record<string, number> = {
    primary: 11, secondary: 9, tertiary: 8, residential: 6, living_street: 5,
    service: 4, pedestrian: 4, footway: 2, cycleway: 2, path: 1.8, track: 3, steps: 1.8,
  };
  return widths[highway] ?? 5;
}

export function clipRoadPolyline(points: RoadPoint[], width: number): RoadPoint[][] {
  const limit = CITY_CONFIG.sizeMeters / 2 - width / 2 * 2.5 - .02;
  const lines: RoadPoint[][] = [];
  let current: RoadPoint[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b[0] - a[0], dz = b[1] - a[1];
    if (Math.hypot(dx, dz) < .05) continue;
    const p = [-dx, dx, -dz, dz], q = [a[0] + limit, limit - a[0], a[1] + limit, limit - a[1]];
    let t0 = 0, t1 = 1, valid = true;
    for (let j = 0; j < 4; j++) {
      if (Math.abs(p[j]) < 1e-10) { if (q[j] < 0) { valid = false; break; } }
      else if (p[j] < 0) t0 = Math.max(t0, q[j] / p[j]); else t1 = Math.min(t1, q[j] / p[j]);
    }
    if (!valid || t0 > t1) { if (current.length > 1) lines.push(current); current = []; continue; }
    const start: RoadPoint = [a[0] + t0 * dx, a[1] + t0 * dz], end: RoadPoint = [a[0] + t1 * dx, a[1] + t1 * dz];
    const last = current[current.length - 1];
    if (last && Math.hypot(last[0] - start[0], last[1] - start[1]) < .001) current.push(end);
    else { if (current.length > 1) lines.push(current); current = [start, end]; }
  }
  if (current.length > 1) lines.push(current);
  return lines;
}

/** One clipped geographic representation for roads, terrain support and decorations. */
export function getRoadLines(features: GeoFeature[]): RoadLine[] {
  const roads: RoadLine[] = [];
  for (const feature of features) {
    const highway = feature.properties.highway, geometry = feature.geometry;
    if (typeof highway !== 'string' || !geometry) continue;
    const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
    const width = roadWidth(highway, feature.properties);
    for (const line of lines) for (const points of clipRoadPolyline(line.map(toWorld), width)) {
      roads.push({ id: String(feature.id ?? feature.properties['@id']), highway, width,
        bridge: feature.properties.bridge === 'yes', surface: String(feature.properties.surface ?? ''), points });
    }
  }
  return roads;
}

/** Miter offsets are identical for visible road edges and excavation constraints. */
export function roadSideOffsets(points: RoadPoint[], width: number): RoadPoint[] {
  const halfWidth = width / 2;
  return points.map((p, i) => {
    const previous = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
    const incoming = new THREE.Vector2(p[0] - previous[0], p[1] - previous[1]).normalize();
    const outgoing = new THREE.Vector2(next[0] - p[0], next[1] - p[1]).normalize();
    const direction = i === 0 ? outgoing.clone() : i === points.length - 1 ? incoming.clone() : incoming.clone().add(outgoing).normalize();
    if (direction.lengthSq() < .000001) direction.copy(outgoing);
    const normal = new THREE.Vector2(-direction.y, direction.x);
    const denominator = normal.dot(new THREE.Vector2(-incoming.y, incoming.x));
    const scale = i > 0 && i < points.length - 1 && Math.abs(denominator) > .1 ? Math.min(halfWidth / Math.abs(denominator), halfWidth * 2.5) : halfWidth;
    return [normal.x * scale, normal.y * scale];
  });
}

export function roadFootprintQuads(road: RoadLine): RoadPoint[][] {
  const offsets = roadSideOffsets(road.points, road.width), quads: RoadPoint[][] = [];
  for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1], b = road.points[i], oa = offsets[i - 1], ob = offsets[i];
    quads.push([[a[0] + oa[0], a[1] + oa[1]], [a[0] - oa[0], a[1] - oa[1]], [b[0] - ob[0], b[1] - ob[1]], [b[0] + ob[0], b[1] + ob[1]]]);
  }
  return quads;
}

export function getRoadHeight(terrain: TerrainModel, x: number, z: number, road: Pick<RoadLine, 'bridge'>): number {
  const ground = terrain.getTerrainHeight(x, z);
  return road.bridge ? Math.max(TERRAIN.roadCenterY, ground + .105) : ground + .105;
}
