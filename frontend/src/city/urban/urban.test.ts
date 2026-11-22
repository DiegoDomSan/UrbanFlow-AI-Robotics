import { readFileSync } from 'node:fs';
import { describe,it,expect } from 'vitest';
import polygonClipping from 'polygon-clipping';
import { createUrbanDetails } from './createUrbanDetails';
import { createTerrainModel } from '../terrain/terrainHeight';
import { getRoadLines } from '../geo/roadGeometry';
import { featurePolygons,inPolygon,pointSegmentDistance,polygonArea,polylineEnvelope,distance,strip } from './geometry';
import { createUrbanMatrices } from './urbanMeshes';
import { URBAN_CONFIG as C } from './urbanConfig';
import type { GeoFeatureCollection } from '../geo/geojsonTypes';

const source=JSON.parse(readFileSync(new URL('../../../public/data/paiporta.geojson',import.meta.url),'utf8')) as GeoFeatureCollection;
const terrain=createTerrainModel(source.features),urban=createUrbanDetails(source.features,terrain),roads=getRoadLines(source.features);
const buildings=source.features.filter(f=>f.properties.building).flatMap(featurePolygons);
// Micrometre quantization makes an independent boolean re-check stable at coincident edges.
const quantize=(polygons:number[][][][])=>polygons.map(p=>p.map(r=>r.map(v=>v.map(n=>Math.round(n*1e6)/1e6)))) as [number,number][][][];
const roadById=new Map(roads.map(r=>[r.id,r]));

describe('mapped-street educational details',()=>{
  it('is deterministic, cached, and supplies bounded nonempty detail sets',()=>{
    expect(createUrbanDetails(source.features,terrain)).toBe(urban);
    expect(createUrbanDetails([...source.features],terrain)).toEqual(urban);
    expect(urban.sidewalks.length).toBeGreaterThan(0);
    expect(urban.crossingCenters.length).toBeGreaterThan(2);
    expect(urban.lamps.length).toBeGreaterThan(12);
    expect(urban.signals.length).toBeGreaterThan(1);
    expect(urban.shrubs.length).toBeGreaterThan(10);
    expect(urban.grassPatches.length).toBeGreaterThan(0);
    expect(urban.lamps.length).toBeLessThanOrEqual(C.maxLamps);
    expect(urban.crossingCenters.length).toBeLessThanOrEqual(C.maxCrossings);
    expect(C.maxDynamicLights).toBeLessThanOrEqual(6);
    expect(createUrbanDetails(source.features,terrain,C.seed+1).shrubs).not.toEqual(urban.shrubs);
  });
  it('clips sidewalks and curbs away from buildings, streets and the water corridor',()=>{
    const roadPolygons=roads.map(r=>polylineEnvelope(r.points,r.width));
    for(const polygons of [urban.sidewalks,urban.curbs]){
      expect(polygonArea(polygonClipping.intersection(quantize(polygons),quantize(buildings)))).toBeLessThan(.001);
      expect(polygonArea(polygonClipping.intersection(quantize(polygons),quantize(polygonClipping.union(roadPolygons[0],...roadPolygons.slice(1)))))).toBeLessThan(.00001);
      for(const polygon of polygons)for(const ring of polygon)for(const [x,z] of ring){
        expect(Math.abs(x)).toBeLessThanOrEqual(249.001);expect(Math.abs(z)).toBeLessThanOrEqual(249.001);
        expect(terrain.getTerrainHeight(x,z)).toBeGreaterThan(-.2);
      }
    }
  });
  it('keeps the whole footprint of planted patches off buildings, pavement and water',()=>{
    const occupied=[...buildings,...roads.map(r=>polylineEnvelope(r.points,r.width)),...urban.sidewalks];
    for(const plant of [...urban.shrubs,...urban.grassPatches]){
      const center:[number,number]=[plant.x,plant.z];
      for(const polygon of occupied){
        expect(inPolygon(center,polygon)).toBe(false);
        for(const ring of polygon)for(let i=1;i<ring.length;i++)expect(pointSegmentDistance(center,ring[i-1],ring[i])+1e-6).toBeGreaterThanOrEqual(plant.radius);
      }
      expect(terrain.getRavineDistance(plant.x,plant.z)-plant.radius).toBeGreaterThan(terrain.config.upperWidth/2);
    }
  });
  it('places lamps and signals beside roads on sidewalks, clear of footprints',()=>{
    for(const object of [...urban.lamps,...urban.signals]){
      const p:[number,number]=[object.x,object.z];
      expect(urban.sidewalks.some(poly=>inPolygon(p,poly))).toBe(true);
      expect(buildings.some(poly=>inPolygon(p,poly))).toBe(false);
      const road=roadById.get(object.roadId)!;
      const d=Math.min(...road.points.slice(1).map((b,i)=>pointSegmentDistance(p,road.points[i],b)));
      expect(d).toBeGreaterThan(road.width/2+.1);expect(d).toBeLessThan(road.width/2+C.sidewalkWidth+.1);
    }
  });
  it('aligns white crossing stripes to their street and keeps their complete footprint on pavement',()=>{
    for(const crossing of urban.crossingStripes){
      const road=roadById.get(crossing.roadId)!;
      const dx=crossing.direction[0],dz=crossing.direction[1];
      expect(Math.hypot(dx,dz)).toBeCloseTo(1,6);
      const stripe=strip([crossing.x-dx*crossing.length/2,crossing.z-dz*crossing.length/2],[crossing.x+dx*crossing.length/2,crossing.z+dz*crossing.length/2],crossing.width/2);
      const outside=polygonClipping.difference(stripe,polylineEnvelope(road.points,road.width));
      expect(polygonArea(outside)).toBeLessThan(.00001);
      expect(polygonArea(polygonClipping.intersection(stripe,buildings))).toBeLessThan(.00001);
      expect(terrain.getRavineDistance(crossing.x,crossing.z)).toBeGreaterThan(14);
    }
  });
  it('keeps the fictional tram on one suitable mapped corridor with real rail gauge',()=>{
    expect(urban.tram).not.toBeNull();const tram=urban.tram!;
    expect(tram.label).toBe('Fictional educational tram corridor');
    expect(tram.gauge).toBe(1.435);expect(tram.length).toBeLessThanOrEqual(110);expect(tram.length).toBeGreaterThanOrEqual(45);
    const bed=strip(tram.start,tram.end,C.tramBedWidth/2),road=roadById.get(tram.roadId)!;
    expect(polygonArea(polygonClipping.intersection(bed,buildings))).toBeLessThan(.00001);
    expect(polygonArea(polygonClipping.difference(bed,polylineEnvelope(road.points,road.width)))).toBeLessThan(.00001);
    for(let i=0;i<=100;i++){const t=i/100,x=tram.start[0]+(tram.end[0]-tram.start[0])*t,z=tram.start[1]+(tram.end[1]-tram.start[1])*t;expect(terrain.getRavineDistance(x,z)).toBeGreaterThan(15);}
    const rails=createUrbanMatrices(urban).rails;
    expect(rails).toHaveLength(2);
    expect(distance([rails[0].elements[12],rails[0].elements[14]],[rails[1].elements[12],rails[1].elements[14]])).toBeCloseTo(1.435,7);
  });
});
