import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { GeoFeatureCollection } from '../geo/geojsonTypes';
import { createTerrainModel, type TerrainModel } from './terrainHeight';
import { buildTerrainGeometry } from './terrainGeometry';
import { calculateWaterStats, createWaterSurface } from './waterGeometry';
import { toWorld } from '../geo/projection';

const data = JSON.parse(readFileSync(new URL('../../../public/data/paiporta.geojson', import.meta.url), 'utf8')) as GeoFeatureCollection;
const terrain = createTerrainModel(data.features);

describe('Mapped hydrography and synthetic elevations', () => {
  it('uses the mapped ravine and preserves the original projection', () => {
    expect(terrain.sourceFeatureId).toBe('way/41726575');
    expect(terrain.riverPath.length).toBeGreaterThan(5);
    expect(toWorld([-.4184, 39.428])).toEqual([0, -0]);
    expect(terrain.getTerrainHeight(-200, 200)).toBeCloseTo(-.05, 8);
    expect(terrain.getTerrainHeight(62.1, -74.94)).toBeLessThan(-3);
  });
  it('does not excavate culverts or manufacture an unmapped river', () => {
    const onlyCulvert = data.features.filter(f => f.id === 'way/1386680417');
    const flat = createTerrainModel(onlyCulvert, { resolution: 10 });
    expect(flat.riverPath).toHaveLength(0);
    expect(flat.getTerrainHeight(62.68, -125.28)).toBe(-.05);
    expect(calculateWaterStats(flat, 3.2).volume).toBe(0);
  });
  it('creates two separated, explicitly synthetic deeper pools', () => {
    expect(terrain.basins).toHaveLength(2);
    const [a, b] = terrain.basins;
    expect(a.synthetic && b.synthetic).toBe(true);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(90);
    for (const pool of terrain.basins) expect(terrain.getTerrainHeight(pool.x, pool.z)).toBeLessThan(-3.5);
  });
  it('keeps building centroids at their existing foundation level', () => {
    for (const feature of data.features) {
      if (!feature.properties.building || feature.geometry?.type !== 'Polygon') continue;
      const points = feature.geometry.coordinates[0].map(toWorld);
      const x = points.reduce((s, p) => s + p[0], 0) / points.length, z = points.reduce((s, p) => s + p[1], 0) / points.length;
      if (Math.abs(x) < 250 && Math.abs(z) < 250) expect(terrain.getTerrainHeight(x, z)).toBeGreaterThan(-.08);
    }
  });
});

describe('Closed terrain mesh', () => {
  it('has 500 m extent, 12 m thickness, finite normals, and two faces per edge', () => {
    const model = createTerrainModel(data.features, { resolution: 10 }), mesh = buildTerrainGeometry(model);
    const position = mesh.getAttribute('position'), normal = mesh.getAttribute('normal'), index = mesh.getIndex()!;
    expect(mesh.boundingBox!.min.y).toBeCloseTo(-12.05, 4);
    expect(mesh.boundingBox!.max.x - mesh.boundingBox!.min.x).toBe(500);
    expect(mesh.boundingBox!.max.z - mesh.boundingBox!.min.z).toBe(500);
    const edges = new Map<string, number>();
    for (let i = 0; i < index.count; i += 3) {
      const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      for (let j = 0; j < 3; j++) {
        const a = ids[j], b = ids[(j + 1) % 3], key = a < b ? `${a}/${b}` : `${b}/${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    expect([...edges.values()].every(v => v === 2)).toBe(true);
    for (let i = 0; i < position.count; i++) {
      expect(Number.isFinite(normal.getX(i) + normal.getY(i) + normal.getZ(i))).toBe(true);
    }
    // Flat interior must face up; underside faces down.
    expect(normal.getY(40 * 51 + 5)).toBeGreaterThan(.99);
    expect(normal.getY(position.count - 1)).toBeLessThan(-.99);
    mesh.dispose();
  });
  it('uses the rendered triangle interpolation at arbitrary points', () => {
    const { divisions: n, step, heights } = terrain.sampleGrid();
    const ix = 154, iz = 88, u = .27, v = .31, a = iz * (n + 1) + ix;
    const expected = heights[a] + u * (heights[a + 1] - heights[a]) + v * (heights[a + n + 1] - heights[a]);
    expect(terrain.getTerrainHeight(-250 + (ix + u) * step, -250 + (iz + v) * step)).toBeCloseTo(expected, 10);
    expect(terrain.sampleGrid()).toBe(terrain.sampleGrid());
  });
});

describe('Water clipping and volume integration', () => {
  it('dry mode has no triangles, area, or residual pool water', () => {
    const dry = createWaterSurface(terrain, 0);
    expect(dry.positions).toHaveLength(0);
    expect(dry.volume).toBe(0);
    expect(dry.area).toBe(0);
  });
  it('raises both area and volume with the selected depth', () => {
    const low = calculateWaterStats(terrain, .25), normal = calculateWaterStats(terrain, .8), storm = calculateWaterStats(terrain, 3.05);
    expect(low.volume).toBeGreaterThan(0);
    expect(normal.volume).toBeGreaterThan(low.volume);
    expect(storm.volume).toBeGreaterThan(normal.volume);
    expect(normal.area).toBeGreaterThan(low.area);
    expect(storm.area).toBeGreaterThan(normal.area);
    expect(storm.area).toBeLessThan(15000);
  });
  it('clips all visible vertices to the actual submerged terrain', () => {
    const water = createWaterSurface(terrain, .8);
    for (let i = 0; i < water.positions.length; i += 3) {
      const [x, , z] = water.positions.slice(i, i + 3);
      expect(terrain.getTerrainHeight(x, z)).toBeLessThanOrEqual(water.elevation + 1e-7);
    }
  });
  it('integrates an independently known sloped triangular wedge', () => {
    // One 2x2 cell, h=x: level 1 covers half the cell, area=2, volume=1.
    const wedge: TerrainModel = {
      config: { ...terrain.config, size: 2, topY: 2, ravineDepth: 2 }, riverPath: [], basins: [], sourceFeatureId: null,
      sampleGrid: () => ({ divisions: 1, step: 2, heights: new Float64Array([0, 2, 0, 2]) }),
      getTerrainHeight: x => x + 1, getRavineDistance: () => 0,
    };
    const stats = calculateWaterStats(wedge, 1);
    expect(stats.area).toBeCloseTo(2, 10);
    expect(stats.volume).toBeCloseTo(1, 10);
  });
});

describe('Configurable terrain thickness', () => {
  it('never folds geological walls below a shallower configured base', () => {
    const shallow = createTerrainModel(data.features, { thickness: 6, resolution: 4 });
    const mesh = buildTerrainGeometry(shallow);
    const positions = mesh.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      expect(positions.getY(i)).toBeGreaterThanOrEqual(-6.050001);
      expect(positions.getY(i)).toBeLessThanOrEqual(-0.049999);
    }
    mesh.dispose();
  });
});
