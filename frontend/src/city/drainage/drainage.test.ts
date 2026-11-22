import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { GeoFeatureCollection } from '../geo/geojsonTypes';
import { createTerrainModel } from '../terrain/terrainHeight';
import { createSyntheticNetwork } from './createSyntheticNetwork';
import { validateDrainageNetwork } from './drainageValidation';
import { avoidsBuildings,buildingObstacles } from './streetGraph';
import { fillHeight,createPipeWaterGeometry } from './DrainageWater';
const data=JSON.parse(readFileSync(new URL('../../../public/data/paiporta.geojson',import.meta.url),'utf8')) as GeoFeatureCollection;
const terrain=createTerrainModel(data.features),network=createSyntheticNetwork(data.features,terrain);
describe('Synthetic drainage: actual Paiporta geometry',()=>{
  it('reproduces all IDs, elevations, connections and diameters with seed 20261106',()=>{
    expect(createSyntheticNetwork(data.features,terrain,20261106)).toEqual(network);
    expect(createSyntheticNetwork(data.features,terrain,42).pipes.map(p=>p.diameter)).not.toEqual(network.pipes.map(p=>p.diameter));
  });
  it('has a meaningful, connected gravity network with a valid outfall',()=>{
    expect(network.pipes.length).toBeGreaterThan(20);
    expect(network.nodes.some(n=>n.kind==='inlet')).toBe(true);
    expect(network.nodes.some(n=>n.kind==='junction')).toBe(true);
    expect(network.pipes.some(p=>p.kind==='collector')).toBe(true);
    expect(network.pipes.some(p=>p.kind==='secondary')).toBe(true);
    expect(validateDrainageNetwork(network,terrain)).toEqual([]);
  });
  it('every inlet reaches the outfall without loops',()=>{
    const nodes=new Map(network.nodes.map(n=>[n.id,n]));
    for(const inlet of network.nodes.filter(n=>n.kind==='inlet')) {
      let current=inlet;const seen=new Set<string>();
      while(current.kind!=='outfall'){expect(seen.has(current.id)).toBe(false);seen.add(current.id);expect(current.downstreamId).not.toBeNull();current=nodes.get(current.downstreamId!)!;expect(current).toBeDefined();}
      expect(network.outfallIds).toContain(current.id);
    }
  });
  it('pipe footprints clear buildings, retain positive slopes and stay below terrain',()=>{
    const obstacles=buildingObstacles(data.features),nodes=new Map(network.nodes.map(n=>[n.id,n]));
    for(const pipe of network.pipes){
      const a=nodes.get(pipe.from)!,b=nodes.get(pipe.to)!;
      expect(avoidsBuildings([a.x,a.z],[b.x,b.z],obstacles)).toBe(true);
      expect(a.y).toBeGreaterThan(b.y);
      if(pipe.downstreamId)expect(network.pipes.find(p=>p.id===pipe.downstreamId)!.diameter).toBeGreaterThanOrEqual(pipe.diameter);
      if(b.kind!=='outfall')expect(pipe.length).toBeLessThanOrEqual(48.01);
      expect(a.surfaceY-a.y).toBeGreaterThanOrEqual(2);
      expect(a.surfaceY-a.y).toBeLessThanOrEqual(6);
    }
  });
  it('rejects a reversed gradient, malformed diameter, isolated inlet and broken outfall',()=>{
    const clone=():typeof network=>JSON.parse(JSON.stringify(network));
    const reversed=clone();reversed.pipes[0].gradient=-0.1;expect(validateDrainageNetwork(reversed,terrain).some(e=>e.includes('gradient'))).toBe(true);
    const diameter=clone();diameter.pipes[0].diameter=12;expect(validateDrainageNetwork(diameter,terrain).some(e=>e.includes('diameter'))).toBe(true);
    const isolated=clone();isolated.nodes.push({...isolated.nodes[0],id:'isolated',kind:'inlet',downstreamId:null});expect(validateDrainageNetwork(isolated,terrain).some(e=>e.includes('disconnected'))).toBe(true);
    const outfall=clone();outfall.outfallIds=[];expect(validateDrainageNetwork(outfall,terrain).some(e=>e.includes('outfall'))).toBe(true);
  });
});
describe('Circular pipe filling',()=>{
  it('preserves exact empty, half-full and full limits',()=>{
    expect(fillHeight(0)).toBe(-1);expect(fillHeight(50)).toBeCloseTo(0,8);expect(fillHeight(100)).toBe(1);expect(createPipeWaterGeometry(0)).toBeNull();
  });
  it('maps requested volume fraction to circular-segment depth',()=>{
    for(const percent of [5,20,35,70,95]){const h=fillHeight(percent);const fraction=(h*Math.sqrt(1-h*h)+Math.asin(h)+Math.PI/2)/Math.PI;expect(fraction).toBeCloseTo(percent/100,8);}
    const g=createPipeWaterGeometry(35)!;g.computeBoundingBox();expect(g.boundingBox!.max.y).toBeCloseTo(fillHeight(35)*.93,5);g.dispose();
  });
});

it('rejects an outfall declaration that does not identify an outfall node',()=>{
  const invalid=structuredClone(network);
  invalid.outfallIds.push('missing-outfall');
  expect(validateDrainageNetwork(invalid,terrain).some(e=>e.includes('declared outfall'))).toBe(true);
});
