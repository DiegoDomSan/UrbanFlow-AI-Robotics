import * as THREE from 'three';
import type { TerrainModel } from './terrainHeight';

export interface WaterStats { volume: number; area: number; elevation: number }
type Vertex = { x: number; z: number; h: number };
export interface WaterSurfaceData extends WaterStats { positions: number[]; depths: number[] }

/** Clip each piecewise-linear terrain triangle to its submerged part. */
function submergedPolygon(triangle: Vertex[], level: number): Vertex[] {
  const polygon: Vertex[] = [];
  for (let i = 0; i < triangle.length; i++) {
    const a = triangle[i], b = triangle[(i + 1) % triangle.length];
    const aIn = a.h < level - 1e-9, bIn = b.h < level - 1e-9;
    if (aIn) polygon.push(a);
    if (aIn !== bIn) {
      const t = (level - a.h) / (b.h - a.h);
      polygon.push({ x: a.x + t * (b.x - a.x), z: a.z + t * (b.z - a.z), h: level });
    }
  }
  return polygon;
}

const surfaceCache = new WeakMap<TerrainModel, { depth: number; result: WaterSurfaceData }>();
export function createWaterSurface(terrain: TerrainModel, requestedDepth: number): WaterSurfaceData {
  const depth = Math.max(0, Math.min(terrain.config.ravineDepth, Number.isFinite(requestedDepth) ? requestedDepth : 0));
  const cached = surfaceCache.get(terrain);
  if (cached?.depth === depth) return cached.result;
  const elevation = terrain.config.topY - terrain.config.ravineDepth + depth;
  const result: WaterSurfaceData = { positions: [], depths: [], volume: 0, area: 0, elevation };
  if (depth <= 0) { surfaceCache.set(terrain, { depth, result }); return result; }
  const { divisions: n, step, heights } = terrain.sampleGrid(), half = terrain.config.size / 2;
  function addTriangle(a: Vertex, b: Vertex, c: Vertex) {
    if (Math.min(a.h, b.h, c.h) >= elevation - 1e-9) return;
    const polygon = submergedPolygon([a, b, c], elevation);
    for (let i = 1; i < polygon.length - 1; i++) {
      const t = [polygon[0], polygon[i], polygon[i + 1]];
      const area = Math.abs((t[1].x - t[0].x) * (t[2].z - t[0].z) - (t[2].x - t[0].x) * (t[1].z - t[0].z)) / 2;
      if (area < 1e-10) continue;
      const depths = t.map(p => Math.max(0, elevation - p.h));
      result.area += area;
      // Exact integration of linear water depth over each clipped triangle.
      result.volume += area * (depths[0] + depths[1] + depths[2]) / 3;
      t.forEach((p, j) => { result.positions.push(p.x, elevation + .008, p.z); result.depths.push(depths[j]); });
    }
  }
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const index = z * (n + 1) + x, px = -half + x * step, pz = -half + z * step;
    const a = { x: px, z: pz, h: heights[index] }, b = { x: px + step, z: pz, h: heights[index + 1] };
    const c = { x: px, z: pz + step, h: heights[index + n + 1] }, d = { x: px + step, z: pz + step, h: heights[index + n + 2] };
    addTriangle(a, c, b); addTriangle(b, c, d);
  }
  surfaceCache.set(terrain, { depth, result });
  return result;
}

export function calculateWaterStats(terrain: TerrainModel, depth: number): WaterStats {
  const { area, volume, elevation } = createWaterSurface(terrain, depth);
  return { area, volume, elevation };
}

export function buildWaterGeometry(terrain: TerrainModel, depth: number): THREE.BufferGeometry {
  const data = createWaterSurface(terrain, depth), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute('waterDepth', new THREE.Float32BufferAttribute(data.depths, 1));
  geometry.computeVertexNormals();
  if (data.positions.length) { geometry.computeBoundingBox(); geometry.computeBoundingSphere(); }
  return geometry;
}
