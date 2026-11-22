import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import type { GeoFeatureCollection, Position } from '../geo/geojsonTypes';
import { CITY_CONFIG } from '../geo/constants';
import { createBuildingGeometry } from '../geo/geometry';
import { createTerrainModel } from '../terrain/terrainHeight';
import { createBuildingBatches } from '../layers/Buildings';
import { createDetailedWallGeometry, FACADE_CONFIG, getFacadeLayout } from './buildingDetails';
import { buildingSeed, getBuildingColors } from './buildingMaterials';

function coordinate(x: number, z: number): Position {
  return [CITY_CONFIG.centerLon + x / (CITY_CONFIG.earthRadius * Math.cos(CITY_CONFIG.centerLat * Math.PI / 180)) * 180 / Math.PI,
    CITY_CONFIG.centerLat - z / CITY_CONFIG.earthRadius * 180 / Math.PI];
}

describe('V2 facade details retain geographic building geometry', () => {
  it('paints the exact extrusion wall triangles, including courtyard walls', () => {
    const polygon = [
      [[0,0],[20,0],[20,14],[0,14],[0,0]].map(([x,z])=>coordinate(x,z)),
      [[6,4],[6,10],[14,10],[14,4],[6,4]].map(([x,z])=>coordinate(x,z)),
    ];
    const extrusion = createBuildingGeometry(polygon, 10)!;
    const walls = createDetailedWallGeometry(extrusion, new THREE.Color('#ded2ba'), 0.25);
    const expected = extrusion.groups.filter(g=>g.materialIndex===1).flatMap(g=>Array.from({length:g.count}, (_,i)=>g.start+i));
    const p = walls.getAttribute('position'), original = extrusion.getAttribute('position');
    expect(p.count).toBe(expected.length);
    expected.forEach((source,i)=> {
      expect([p.getX(i),p.getY(i),p.getZ(i)]).toEqual([original.getX(source),original.getY(source),original.getZ(source)]);
    });
    const uv = walls.getAttribute('facadeUV'), layout = walls.getAttribute('facadeLayout');
    for (let i=0;i<p.count;i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(-0.00001);
      expect(uv.getX(i)).toBeLessThanOrEqual(layout.getX(i)+0.00001);
      expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getY(i)).toBeLessThanOrEqual(layout.getY(i)+0.00001);
    }
    walls.dispose(); extrusion.dispose();
  });

  it('keeps windows within every eligible facade and below its roof', () => {
    for (const width of [0.2,1,3.2,3.3,4,8,23,77]) for (const height of [2.8,3,3.1,6.2,10,19.5]) {
      const layout=getFacadeLayout(width,height);
      if (width<3.3 || height<3) expect(layout.columns).toBe(0);
      for(let col=0;col<layout.columns;col++) for(let floor=0;floor<layout.floors;floor++) {
        const x=FACADE_CONFIG.edgeMargin+(col+.5)*layout.cellWidth;
        const y=(floor+.5)*layout.floorHeight;
        expect(x-FACADE_CONFIG.windowWidth/2-FACADE_CONFIG.frameWidth).toBeGreaterThan(0);
        expect(x+FACADE_CONFIG.windowWidth/2+FACADE_CONFIG.frameWidth).toBeLessThan(width);
        expect(y-FACADE_CONFIG.windowHeight/2-FACADE_CONFIG.frameWidth).toBeGreaterThan(0);
        expect(y+FACADE_CONFIG.windowHeight/2+FACADE_CONFIG.frameWidth).toBeLessThan(height);
      }
    }
  });

  it('uses stable varied colors and keeps the whole real city in two geometry batches', () => {
    const data=JSON.parse(readFileSync(new URL('../../../public/data/paiporta.geojson',import.meta.url),'utf8')) as GeoFeatureCollection;
    const terrain=createTerrainModel(data.features);
    expect(buildingSeed('way/123')).toBe(buildingSeed('way/123'));
    expect(getBuildingColors('way/123')).toEqual(getBuildingColors('way/123'));
    expect(new Set(Array.from({length:50},(_,i)=>getBuildingColors(`way/${i}`).wall.getHex())).size).toBeGreaterThan(5);
    const batches=createBuildingBatches(data.features,terrain);
    expect(batches.walls).not.toBeNull();expect(batches.roofs).not.toBeNull();
    for(const geometry of [batches.walls!,batches.roofs!]) {
      geometry.computeBoundingBox();
      expect(geometry.boundingBox!.min.x).toBeGreaterThanOrEqual(-250.001);
      expect(geometry.boundingBox!.max.x).toBeLessThanOrEqual(250.001);
      expect(geometry.boundingBox!.min.z).toBeGreaterThanOrEqual(-250.001);
      expect(geometry.boundingBox!.max.z).toBeLessThanOrEqual(250.001);
      expect(geometry.getAttribute('color').count).toBe(geometry.getAttribute('position').count);
      expect(geometry.groups.length).toBe(0);
      geometry.dispose();
    }
  });
});
