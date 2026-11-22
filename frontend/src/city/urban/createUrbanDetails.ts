import polygonClipping from 'polygon-clipping';
import type { GeoFeature } from '../geo/geojsonTypes';
import type { TerrainModel } from '../terrain/terrainHeight';
import { getRoadLines, getRoadHeight, type RoadLine } from '../geo/roadGeometry';
import { URBAN_CONFIG as C } from './urbanConfig';
import type { Point2, MultiPolygon2, UrbanDetailsData, TramCorridor, SurfaceMark } from './types';
import { add, distance, featurePolygons, inPolygon, pointSegmentDistance, polygonArea, polylineEnvelope, seededRandom, strip, union } from './geometry';

type Segment = { a: Point2; b: Point2; road: RoadLine; length: number; direction: Point2 };
type Junction = { p: Point2; segments: Segment[] };
const cache = new WeakMap<GeoFeature[], WeakMap<TerrainModel, Map<number, UrbanDetailsData>>>();
const suitable = new Set(['primary', 'secondary', 'tertiary', 'residential', 'living_street', 'unclassified']);

/** Decorative geometry derives from mapped streets; it is not surveyed infrastructure. */
export function createUrbanDetails(features: GeoFeature[], terrain: TerrainModel, seed: number = C.seed): UrbanDetailsData {
  let byTerrain = cache.get(features);
  if (!byTerrain) { byTerrain = new WeakMap(); cache.set(features, byTerrain); }
  let bySeed = byTerrain.get(terrain);
  if (!bySeed) { bySeed = new Map(); byTerrain.set(terrain, bySeed); }
  const cached = bySeed.get(seed);
  if (cached) return cached;
  const roads = getRoadLines(features), urbanRoads = roads.filter(r => suitable.has(r.highway) && !r.bridge);
  const random = seededRandom(seed), half = terrain.config.size / 2 - 1;
  const boundary: MultiPolygon2 = [[[[-half,-half],[half,-half],[half,half],[-half,half],[-half,-half]]]];
  const buildings = features.filter(f => f.properties.building).flatMap(featurePolygons);
  const buildingBounds = buildings.map(polygon => ({ polygon,
    minX:Math.min(...polygon[0].map(p=>p[0])), maxX:Math.max(...polygon[0].map(p=>p[0])),
    minZ:Math.min(...polygon[0].map(p=>p[1])), maxZ:Math.max(...polygon[0].map(p=>p[1])),
  }));
  const buildingClear = (p: Point2, margin = .35) => !buildingBounds.some(b => {
    if (p[0]<b.minX-margin||p[0]>b.maxX+margin||p[1]<b.minZ-margin||p[1]>b.maxZ+margin) return false;
    return inPolygon(p,b.polygon)||b.polygon.some(r=>r.some((a,i)=>pointSegmentDistance(p,a,r[(i+1)%r.length])<margin));
  });
  const landSafe = (p:Point2, margin=0) => Math.abs(p[0])<half-margin && Math.abs(p[1])<half-margin
    && terrain.getRavineDistance(p[0],p[1])>terrain.config.upperWidth/2*(1+terrain.config.bankVariation)+1+margin
    && terrain.getTerrainHeight(p[0],p[1])>terrain.config.topY-.12 && buildingClear(p,margin+.15);
  const allRoadEnvelopes = roads.map(r=>polylineEnvelope(r.points,r.width+.22));
  const roadUnion = union(allRoadEnvelopes);
  const waterExclusion = terrain.riverPath.length>1 ? [polylineEnvelope(terrain.riverPath, terrain.config.upperWidth*(1+terrain.config.bankVariation)+2)] : [];
  const forbidden = union([...roadUnion,...buildings,...waterExclusion]);
  const makeBand=(extra:number) => {
    const envelope=union(urbanRoads.map(r=>polylineEnvelope(r.points,r.width+extra*2)));
    if(!envelope.length)return [];
    const clipped=polygonClipping.intersection(envelope,boundary);
    return forbidden.length?polygonClipping.difference(clipped,forbidden):clipped;
  };
  const sidewalks=makeBand(C.sidewalkWidth),curbs=makeBand(.11+C.curbWidth);
  const segments:Segment[]=urbanRoads.flatMap(road=>road.points.slice(1).map((b,i)=>{
    const a=road.points[i],length=distance(a,b);
    return {a,b,road,length,direction:[(b[0]-a[0])/length,(b[1]-a[1])/length] as Point2};
  })).filter(s=>s.length>.5);
  const junctions:Junction[]=[];
  for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++){
    const a=segments[i],b=segments[j];
    if(a.road.id===b.road.id)continue;
    const rx=a.b[0]-a.a[0],rz=a.b[1]-a.a[1],sx=b.b[0]-b.a[0],sz=b.b[1]-b.a[1],cross=rx*sz-rz*sx;
    if(Math.abs(cross)/(a.length*b.length)<.32)continue;
    const qx=b.a[0]-a.a[0],qz=b.a[1]-a.a[1],u=(qx*sz-qz*sx)/cross,v=(qx*rz-qz*rx)/cross;
    if(u<-.001||u>1.001||v<-.001||v>1.001)continue;
    const p:Point2=[a.a[0]+u*rx,a.a[1]+u*rz];
    if(!landSafe(p,2))continue;
    let junction=junctions.find(n=>distance(n.p,p)<2);
    if(!junction){junction={p,segments:[]};junctions.push(junction);}
    for(const segment of [a,b])if(!junction.segments.includes(segment))junction.segments.push(segment);
  }
  junctions.sort((a,b)=>Math.max(...b.segments.map(s=>s.road.width))-Math.max(...a.segments.map(s=>s.road.width)) || a.p[0]-b.p[0] || a.p[1]-b.p[1]);

  let tram:TramCorridor|null=null;
  const tramCandidates=segments.filter(s=>s.road.width>=8&&s.length>=C.tramMinLength+8).sort((a,b)=>b.length-a.length||a.road.id.localeCompare(b.road.id));
  for(const s of tramCandidates){
    const length=Math.min(C.tramMaxLength,s.length-8),start=add(s.a,s.direction,(s.length-length)/2),end=add(start,s.direction,length);
    const normal:Point2=[-s.direction[1],s.direction[0]];
    let valid=true;
    for(let d=0;d<=length;d+=1.5)for(const side of [-1,1])if(!landSafe(add(add(start,s.direction,d),normal,side*C.tramBedWidth/2),.15))valid=false;
    if(valid){tram={label:'Fictional educational tram corridor',roadId:s.road.id,start,end,direction:s.direction,length,gauge:C.tramGauge,y:getRoadHeight(terrain,...start,s.road)};break;}
  }
  const inTram=(p:Point2,margin=0)=>!!tram&&pointSegmentDistance(p,tram.start,tram.end)<C.tramBedWidth/2+margin;
  const result:UrbanDetailsData={synthetic:true,seed,sidewalks,curbs,crossingStripes:[],crossingCenters:[],laneMarkings:[],lamps:[],signals:[],shrubs:[],grassPatches:[],tram,
    diagnostics:{roads:urbanRoads.length,intersections:junctions.length,sidewalkArea:polygonArea(sidewalks),curbArea:polygonArea(curbs)}};
  const mark=(p:Point2,s:Segment,length:number,width:number):SurfaceMark=>({x:p[0],z:p[1],y:getRoadHeight(terrain,...p,s.road)+.018,direction:s.direction,length,width,roadId:s.road.id});
  const markClear=(p:Point2,s:Segment,length:number,width:number)=>{
    const n:Point2=[-s.direction[1],s.direction[0]];
    return [-1,1].every(a=>[-1,1].every(b=>landSafe(add(add(p,s.direction,a*length/2),n,b*width/2),.06)));
  };
  for(const junction of junctions){
    if(result.crossingCenters.length>=C.maxCrossings)break;
    if(result.crossingCenters.some(c=>distance([c.x,c.z],junction.p)<24))continue;
    for(const s of [...junction.segments].sort((a,b)=>b.road.width-a.road.width).slice(0,2)){
      if(result.crossingCenters.length>=C.maxCrossings)break;
      const offset=Math.max(...junction.segments.map(x=>x.road.width))/2+4.4;
      const towardB=distance(junction.p,s.b)>distance(junction.p,s.a),direction=add([0,0],s.direction,towardB?1:-1);
      const p=add(junction.p,direction,offset);
      if(pointSegmentDistance(p,s.a,s.b)>.1 || Math.min(distance(p,s.a),distance(p,s.b))<1.6||!markClear(p,s,3,s.road.width-.6)||inTram(p,2))continue;
      const normal:Point2=[-s.direction[1],s.direction[0]],count=Math.floor((s.road.width-.65)/.82);
      for(let stripe=0;stripe<count;stripe++)result.crossingStripes.push(mark(add(p,normal,(stripe-(count-1)/2)*.82),s,2.8,.44));
      result.crossingCenters.push({x:p[0],z:p[1],direction:s.direction,roadId:s.road.id});
      const signal=add(add(p,direction,-1.9),normal,(towardB?1:-1)*(s.road.width/2+.65));
      if(result.signals.length<C.maxTrafficSignals&&landSafe(signal,.3)&&sidewalks.some(poly=>inPolygon(signal,poly))){
        result.signals.push({x:signal[0],z:signal[1],y:terrain.getTerrainHeight(...signal)+C.sidewalkElevation,facing:direction,roadId:s.road.id});
      }
    }
  }
  for(const s of segments){
    if(s.road.width>=7&&s.road.highway!=='living_street'){
      for(let d=4;d<s.length-3;d+=7){
        const p=add(s.a,s.direction,d);
        if(!landSafe(p,.2)||inTram(p,1)||junctions.some(j=>distance(j.p,p)<9)||result.crossingCenters.some(c=>distance([c.x,c.z],p)<5)||!markClear(p,s,2.8,.14))continue;
        result.laneMarkings.push(mark(p,s,2.8,.14));
      }
    }
  }
  // Arc-length stationing per original line avoids a new lamp at every OSM vertex.
  for(const road of urbanRoads){
    let station=13,covered=0;
    for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i],length=distance(a,b),direction:Point2=[(b[0]-a[0])/length,(b[1]-a[1])/length],normal:Point2=[-direction[1],direction[0]];
      while(station<covered+length){
        const center=add(a,direction,station-covered);
        for(const side of [1,-1]){
          if(result.lamps.length>=C.maxLamps)break;
          const p=add(center,normal,side*(road.width/2+.86));
          if(!landSafe(p,.35)||!sidewalks.some(poly=>inPolygon(p,poly))||junctions.some(j=>distance(j.p,p)<7)||result.lamps.some(l=>distance([l.x,l.z],p)<16)||result.signals.some(l=>distance([l.x,l.z],p)<2))continue;
          result.lamps.push({x:p[0],z:p[1],y:terrain.getTerrainHeight(...p)+C.sidewalkElevation,inward:add([0,0],normal,-side),roadId:road.id});
        }
        station+=C.lampSpacing;
      }
      covered+=length;
    }
  }
  const green=features.filter(f=>['park','garden'].includes(String(f.properties.leisure))||['grass','recreation_ground','greenfield'].includes(String(f.properties.landuse))).flatMap(featurePolygons);
  const availableGreen=green.length?polygonClipping.difference(polygonClipping.intersection(union(green),boundary),forbidden,sidewalks):[];
  // Check the complete bounding circle, not sparse perimeter samples that can miss a corner.
  const landscapeSafe=(p:Point2,r:number)=>landSafe(p,r)&&availableGreen.some(poly=>inPolygon(p,poly)&&poly.every(ring=>ring.every((a,i)=>pointSegmentDistance(p,a,ring[(i+1)%ring.length])>=r+.02)));
  for(let attempt=0;attempt<5000&&(result.shrubs.length<C.maxShrubs||result.grassPatches.length<C.maxGrassPatches);attempt++){
    if(!availableGreen.length)break;
    const area=availableGreen[Math.floor(random()*availableGreen.length)],ring=area[0];
    const xs=ring.map(p=>p[0]),zs=ring.map(p=>p[1]);
    const p:Point2=[Math.min(...xs)+random()*(Math.max(...xs)-Math.min(...xs)),Math.min(...zs)+random()*(Math.max(...zs)-Math.min(...zs))];
    const shrub=attempt%3!==0,radius=shrub ? .38+random()*.35 : 1.2+random()*1.9;
    if(!landscapeSafe(p,radius)||result.shrubs.some(x=>distance([x.x,x.z],p)<radius+x.radius+.65))continue;
    const item={x:p[0],z:p[1],y:terrain.getTerrainHeight(...p),radius,height:shrub ? .4+random()*.5 : .016,variant:Math.floor(random()*3)};
    if(shrub&&result.shrubs.length<C.maxShrubs)result.shrubs.push(item);
    if(!shrub&&result.grassPatches.length<C.maxGrassPatches)result.grassPatches.push(item);
  }
  bySeed.set(seed,result);
  return result;
}
