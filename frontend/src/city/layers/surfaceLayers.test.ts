import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createTerrainModel } from '../terrain/terrainHeight';
import { createRoadGeometryFromPoints } from './Roads';
import { conformSurfaceGeometry } from './LandCover';
import { clipBuildingPolygon } from './Buildings';
import { toWorld } from '../geo/projection';
import { CITY_CONFIG } from '../geo/constants';
import type { Position } from '../geo/geojsonTypes';

const terrain = createTerrainModel([]);
function toGeo(x: number, z: number): Position {
  const r = CITY_CONFIG.earthRadius;
  return [CITY_CONFIG.centerLon + x / r * 180 / Math.PI / Math.cos(CITY_CONFIG.centerLat * Math.PI / 180),
    CITY_CONFIG.centerLat - z / r * 180 / Math.PI];
}

describe('surface compatibility with shared terrain', () => {
  it('keeps mitered roads upward-facing and finite at a sharp bend', () => {
    const road = createRoadGeometryFromPoints([new THREE.Vector2(-20, 0), new THREE.Vector2(0, 0), new THREE.Vector2(2, 15)], 6, terrain, false)!;
    const p = road.getAttribute('position'), n = road.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      expect(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))).toBe(true);
      expect(p.getY(i)).toBeCloseTo(0.055, 6);
      expect(n.getY(i)).toBeGreaterThan(0.99);
    }
    road.dispose();
  });
  it('conforms complete land-cover triangles to the same terrain planes', () => {
    const shaped = createTerrainModel([{ type: 'Feature', id: 'way/41726575', properties: { waterway: 'stream' },
      geometry: { type: 'LineString', coordinates: [toGeo(-100, 0), toGeo(100, 0)] } }]);
    const source = new THREE.BufferGeometry();
    source.setAttribute('position', new THREE.Float32BufferAttribute([-20, 0, -20, 20, 0, -20, 0, 0, 20], 3));
    const geometry = conformSurfaceGeometry(source, shaped);
    const p = geometry.getAttribute('position');
    expect(p.count).toBeGreaterThan(3);
    for (let i = 0; i < p.count; i += 3) {
      const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
      const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
      const z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
      expect(y).toBeCloseTo(shaped.getTerrainHeight(x, z) + 0.025, 4);
    }
    source.dispose(); geometry.dispose();
  });
  it('clips a building at the study boundary while preserving a courtyard', () => {
    const ring = (x0: number, z0: number, x1: number, z1: number) =>
      [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]].map(([x,z]) => toGeo(x,z));
    const clipped = clipBuildingPolygon([ring(230, -20, 270, 20), ring(235, -5, 245, 5)]);
    expect(clipped).toHaveLength(1);
    expect(clipped[0]).toHaveLength(2);
    for (const polygon of clipped) for (const boundary of polygon) for (const coordinate of boundary) {
      const [x,z] = toWorld(coordinate);
      expect(Math.abs(x)).toBeLessThanOrEqual(250.000001);
      expect(Math.abs(z)).toBeLessThanOrEqual(250.000001);
    }
  });
  it('keeps bridge decks above excavated terrain while tracks follow it', () => {
    const shaped = createTerrainModel([{ type: 'Feature', id: 'way/41726575', properties: {},
      geometry: { type: 'LineString', coordinates: [toGeo(-100, 0), toGeo(100, 0)] } }]);
    const points = [new THREE.Vector2(0, -15), new THREE.Vector2(0, 15)];
    const bridge = createRoadGeometryFromPoints(points, 4, shaped, true)!;
    const track = createRoadGeometryFromPoints(points, 4, shaped, false)!;
    const bridgeY = Array.from({length:bridge.getAttribute('position').count}, (_, i) => bridge.getAttribute('position').getY(i));
    const trackY = Array.from({length:track.getAttribute('position').count}, (_, i) => track.getAttribute('position').getY(i));
    expect(Math.min(...bridgeY)).toBeCloseTo(0.055, 5);
    expect(Math.min(...trackY)).toBeLessThan(-3);
    bridge.dispose(); track.dispose();
  });
});

// Regression for V1: the mapped unpaved bank track was excavated into normal water.
// Test projected triangle overlaps, not just sampled centreline points.
import { readFileSync } from 'node:fs';
import type { GeoFeatureCollection } from '../geo/geojsonTypes';
import { getRoadLines, roadWidth } from '../geo/roadGeometry';
import { createWaterSurface } from '../terrain/waterGeometry';
const paiporta = JSON.parse(readFileSync(new URL('../../../public/data/paiporta.geojson', import.meta.url), 'utf8')) as GeoFeatureCollection;
type Point = [number, number];
const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function intersectTriangles(subject: Point[], clip: Point[]): Point[] {
  const orientation = Math.sign(cross(clip[0], clip[1], clip[2]));
  let polygon = subject;
  for (let edge = 0; edge < 3; edge++) {
    const a = clip[edge], b = clip[(edge + 1) % 3], output: Point[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i], q = polygon[(i + 1) % polygon.length];
      const dp = cross(a, b, p) * orientation, dq = cross(a, b, q) * orientation;
      if (dp >= -1e-9) output.push(p);
      if ((dp >= -1e-9) !== (dq >= -1e-9)) {
        const t = dp / (dp - dq);
        output.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
    polygon = output;
  }
  return polygon;
}
function polygonArea(points: Point[]) {
  return Math.abs(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
}

describe('Paiporta bank-road and water separation', () => {
  const model = createTerrainModel(paiporta.features);
  const roads = getRoadLines(paiporta.features);
  const track = roads.find(r => r.id === 'way/1330137343')!;
  it('uses mapped widths and keeps the bank track as a supported path, not a bridge', () => {
    expect(track.width).toBe(3);
    expect(track.bridge).toBe(false);
    expect(roads.find(r => r.id === 'way/538966394')!.width).toBe(3);
    expect(roads.filter(r => r.bridge).map(r => r.id).sort()).toEqual(['way/44172051', 'way/538966394']);
    expect(roadWidth('residential', { width: '6.5 m' })).toBe(6.5);
    expect(roadWidth('residential', { width: 'unknown' })).toBe(6);
  });
  it.each([.8, 3.05, 3.2])('keeps all bank-track triangles separate from water at depth %s m', depth => {
    const water = createWaterSurface(model, depth), mesh = createRoadGeometryFromPoints(track.points.map(p => new THREE.Vector2(...p)), track.width, model, false)!;
    const p = mesh.getAttribute('position'), indices = mesh.getIndex()!;
    const waterTriangles: { points: Point[]; minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
    for (let i = 0; i < water.positions.length; i += 9) {
      const points: Point[] = [0, 3, 6].map(j => [water.positions[i + j], water.positions[i + j + 2]]);
      waterTriangles.push({ points, minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])), minZ: Math.min(...points.map(p => p[1])), maxZ: Math.max(...points.map(p => p[1])) });
    }
    let projectedOverlap = 0;
    for (let i = 0; i < indices.count; i += 3) {
      const ids = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)];
      const triangle: Point[] = ids.map(j => [p.getX(j), p.getZ(j)]);
      const minX = Math.min(...triangle.map(p => p[0])), maxX = Math.max(...triangle.map(p => p[0]));
      const minZ = Math.min(...triangle.map(p => p[1])), maxZ = Math.max(...triangle.map(p => p[1]));
      for (const t of waterTriangles) {
        if (t.maxX < minX || t.minX > maxX || t.maxZ < minZ || t.minZ > maxZ) continue;
        projectedOverlap += polygonArea(intersectTriangles(triangle, t.points));
      }
      for (const id of ids) expect(p.getY(id)).toBeGreaterThan(water.elevation + .05);
    }
    expect(projectedOverlap).toBeLessThan(1e-6);
    mesh.dispose();
  });
  it('preserves open water under both real mapped bridges', () => {
    for (const bridge of roads.filter(r => r.bridge)) {
      const mesh = createRoadGeometryFromPoints(bridge.points.map(p => new THREE.Vector2(...p)), bridge.width, model, true)!;
      const p = mesh.getAttribute('position');
      let channelPoints = 0;
      for (let i = 0; i < p.count; i++) {
        expect(p.getY(i)).toBeGreaterThan(.05);
        if (model.getTerrainHeight(p.getX(i), p.getZ(i)) < -2.45) channelPoints++;
      }
      expect(channelPoints).toBeGreaterThan(0);
      mesh.dispose();
    }
  });
  it('does not form a dam or invent a bridge for a true unmapped ford crossing', () => {
    const river = { type: 'Feature' as const, id: 'way/41726575', properties: {}, geometry: { type: 'LineString' as const, coordinates: [toGeo(-100, 0), toGeo(100, 0)] } };
    const ford = { type: 'Feature' as const, id: 'ford', properties: { highway: 'track', ford: 'yes' }, geometry: { type: 'LineString' as const, coordinates: [toGeo(0, -20), toGeo(0, 20)] } };
    const local = createTerrainModel([river, ford]);
    expect(local.getTerrainHeight(0, 0)).toBeLessThan(-3);
    expect(getRoadLines([ford])[0].bridge).toBe(false);
  });
});
