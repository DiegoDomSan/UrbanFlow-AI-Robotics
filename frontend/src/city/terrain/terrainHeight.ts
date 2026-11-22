import type { GeoFeature } from '../geo/geojsonTypes';
import { toWorld } from '../geo/projection';
import { terrainConfig, type TerrainConfig } from './terrainConfig';
import { getRoadLines, roadFootprintQuads } from '../geo/roadGeometry';

export type TerrainPoint = [number, number];
export interface SyntheticBasin { id: string; x: number; z: number; radius: number; extraDepth: number; synthetic: true }
export interface TerrainGrid { divisions: number; step: number; heights: Float64Array }
export interface TerrainModel {
  config: TerrainConfig;
  riverPath: TerrainPoint[];
  basins: SyntheticBasin[];
  sourceFeatureId: string | null;
  getTerrainHeight: (x: number, z: number) => number;
  getRavineDistance: (x: number, z: number) => number;
  sampleGrid: () => TerrainGrid;
}

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (v: number) => { const t = clamp(v); return t * t * (3 - 2 * t); };

export function distanceToSegment(x: number, z: number, a: TerrainPoint, b: TerrainPoint): number {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1));
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
}

function inRing(x: number, z: number, ring: TerrainPoint[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** OSM gives the alignment only. All vertical dimensions and pools are synthetic. */
export function createTerrainModel(features: GeoFeature[], overrides: Partial<TerrainConfig> = {}): TerrainModel {
  const config = { ...terrainConfig, ...overrides };
  if (config.size <= 0 || config.resolution <= 0 || config.thickness <= config.ravineDepth + config.basinExtraDepth || config.upperWidth <= config.bottomWidth || config.bottomWidth <= 0 || config.ravineDepth <= 0 || config.foundationBuffer <= 0 || config.roadBankBlend <= 0) {
    throw new Error('Invalid terrain configuration: dimensions must be positive, banks wider than bed, and bottom below pools.');
  }
  const half = config.size / 2;
  const source = features.find(f => String(f.id ?? f.properties['@id']) === 'way/41726575' && f.geometry?.type === 'LineString' && f.properties.tunnel !== 'culvert');
  const allPoints = source?.geometry?.type === 'LineString' ? source.geometry.coordinates.map(toWorld) : [];
  // Keep connected segments around the study boundary; never invent a substitute waterway.
  const riverPath: TerrainPoint[] = [];
  const margin = config.upperWidth;
  for (let i = 1; i < allPoints.length; i++) {
    const a = allPoints[i - 1], b = allPoints[i];
    if (Math.max(a[0], b[0]) < -half - margin || Math.min(a[0], b[0]) > half + margin || Math.max(a[1], b[1]) < -half - margin || Math.min(a[1], b[1]) > half + margin) continue;
    if (!riverPath.length) riverPath.push(a);
    riverPath.push(b);
  }
  const buildings = features.flatMap(f => {
    if (!f.properties.building || !f.geometry) return [];
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    return polys.map(p => p[0].map(toWorld)).filter(p => p.length >= 3).map(ring => ({ ring, minX: Math.min(...ring.map(p => p[0])), maxX: Math.max(...ring.map(p => p[0])), minZ: Math.min(...ring.map(p => p[1])), maxZ: Math.max(...ring.map(p => p[1])) }));
  });
  const roads: { a: TerrainPoint; b: TerrainPoint; clearance: number }[] = [];
  for (const f of features) {
    if (!f.properties.highway || !f.geometry) continue;
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
    for (const line of lines) for (let i = 1; i < line.length; i++) roads.push({ a: toWorld(line[i - 1]), b: toWorld(line[i]), clearance: ['primary', 'secondary', 'tertiary'].includes(String(f.properties.highway)) ? 6 : 3 });
  }
  // Roadside terrain support is part of the excavated solid, never a water mask.
  // Preserve true bridges and actual centreline crossings: no artificial dam or bridge.
  const crossesRiver = (a: TerrainPoint, b: TerrainPoint) => riverPath.slice(1).some((d, i) => {
    const c = riverPath[i], rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1];
    const denominator = rx * sz - rz * sx;
    if (Math.abs(denominator) < 1e-10) return false;
    const qx = c[0] - a[0], qz = c[1] - a[1];
    const t = (qx * sz - qz * sx) / denominator, u = (qx * rz - qz * rx) / denominator;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  });
  const roadSupports = getRoadLines(features).filter(road => !road.bridge).flatMap(road =>
    roadFootprintQuads(road).flatMap((ring, i) => crossesRiver(road.points[i], road.points[i + 1]) ? [] : [{ ring,
      minX: Math.min(...ring.map(p => p[0])), maxX: Math.max(...ring.map(p => p[0])),
      minZ: Math.min(...ring.map(p => p[1])), maxZ: Math.max(...ring.map(p => p[1])),
    }])
  );
  const gridStep = config.size / Math.ceil(config.size / config.resolution);
  // Every vertex of a grid triangle meeting the road footprint must be supported.
  // This conservative diagonal accounts for grid interpolation at road edges.
  const supportMargin = gridStep * Math.SQRT2 + 0.02;
  function roadProtection(x: number, z: number): number {
    const range = supportMargin + config.roadBankBlend;
    let distance = range;
    for (const road of roadSupports) {
      if (x < road.minX - range || x > road.maxX + range || z < road.minZ - range || z > road.maxZ + range) continue;
      if (inRing(x, z, road.ring)) return 0;
      for (let i = 0; i < road.ring.length; i++) distance = Math.min(distance, distanceToSegment(x, z, road.ring[i], road.ring[(i + 1) % road.ring.length]));
    }
    return smooth((distance - supportMargin) / config.roadBankBlend);
  }
  const nearest = (x: number, z: number) => {
    let distance = Infinity, station = 0, accumulated = 0;
    for (let i = 1; i < riverPath.length; i++) {
      const a = riverPath[i - 1], b = riverPath[i];
      const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
      const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (len * len || 1));
      const d = Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
      if (d < distance) { distance = d; station = accumulated + t * len; }
      accumulated += len;
    }
    return { distance, station };
  };
  const buildingDistance = (x: number, z: number, range: number) => {
    let d = range;
    for (const b of buildings) {
      if (x < b.minX - range || x > b.maxX + range || z < b.minZ - range || z > b.maxZ + range) continue;
      if (inRing(x, z, b.ring)) return 0;
      for (let i = 0; i < b.ring.length; i++) d = Math.min(d, distanceToSegment(x, z, b.ring[i], b.ring[(i + 1) % b.ring.length]));
    }
    return d;
  };
  // Candidate pools stay on the mapped bed, clear of roads and foundations.
  const candidates: { x: number; z: number; score: number }[] = [];
  for (let i = 1; i < riverPath.length; i++) {
    const a = riverPath[i - 1], b = riverPath[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let s = 0; s < length; s += 4) {
      const x = a[0] + (b[0] - a[0]) * s / length, z = a[1] + (b[1] - a[1]) * s / length;
      if (Math.abs(x) > half - 20 || Math.abs(z) > half - 20) continue;
      const clearance = Math.min(buildingDistance(x, z, 40), ...roads.map(r => distanceToSegment(x, z, r.a, r.b) - r.clearance));
      if (clearance >= config.basinRadius + 1) candidates.push({ x, z, score: clearance });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.x - b.x);
  const basins: SyntheticBasin[] = [];
  for (const c of candidates) {
    if (basins.some(b => Math.hypot(c.x - b.x, c.z - b.z) < 90)) continue;
    basins.push({ id: `synthetic-pool-${basins.length + 1}`, x: c.x, z: c.z, radius: config.basinRadius, extraDepth: config.basinExtraDepth, synthetic: true });
    if (basins.length === 2) break;
  }
  function analyticHeight(x: number, z: number): number {
    const { distance, station } = nearest(x, z);
    const outer = config.upperWidth / 2 * (1 + config.bankVariation * Math.sin(station / 38) * Math.sin(station / 79));
    const inner = config.bottomWidth / 2;
    if (distance >= outer) return config.topY;
    const excavation = config.ravineDepth * (1 - smooth((distance - inner) / (outer - inner)));
    let extra = 0;
    for (const b of basins) {
      const t = Math.hypot(x - b.x, z - b.z) / b.radius;
      extra = Math.max(extra, b.extraDepth * (1 - smooth(t)));
    }
    const protection = Math.min(smooth(buildingDistance(x, z, config.foundationBuffer) / config.foundationBuffer), roadProtection(x, z));
    return config.topY - (excavation + extra) * protection;
  }
  let cachedGrid: TerrainGrid | undefined;
  function sampleGrid(): TerrainGrid {
    if (!cachedGrid) {
      const divisions = Math.ceil(config.size / config.resolution), step = config.size / divisions;
      const heights = new Float64Array((divisions + 1) ** 2);
      for (let z = 0; z <= divisions; z++) for (let x = 0; x <= divisions; x++) heights[z * (divisions + 1) + x] = analyticHeight(-half + x * step, -half + z * step);
      cachedGrid = { divisions, step, heights };
    }
    return cachedGrid;
  }
  // Barycentric interpolation of the ACTUAL top mesh keeps all consumers aligned.
  function getTerrainHeight(x: number, z: number): number {
    if (Math.abs(x) > half || Math.abs(z) > half) return analyticHeight(x, z);
    const { divisions: n, step, heights: h } = sampleGrid();
    const gx = (x + half) / step, gz = (z + half) / step;
    const ix = Math.min(n - 1, Math.floor(gx)), iz = Math.min(n - 1, Math.floor(gz));
    const u = gx - ix, v = gz - iz, a = iz * (n + 1) + ix;
    return u + v <= 1 ? h[a] + u * (h[a + 1] - h[a]) + v * (h[a + n + 1] - h[a]) : h[a + n + 2] + (1 - u) * (h[a + n + 1] - h[a + n + 2]) + (1 - v) * (h[a + 1] - h[a + n + 2]);
  }
  return {
    config, riverPath, basins, sourceFeatureId: source ? String(source.id ?? source.properties['@id']) : null,
    getTerrainHeight,
    getRavineDistance: (x, z) => nearest(x, z).distance,
    sampleGrid,
  };
}
