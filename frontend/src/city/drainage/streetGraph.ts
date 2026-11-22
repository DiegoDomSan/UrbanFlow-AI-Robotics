import type { GeoFeature } from '../geo/geojsonTypes';
import { toWorld } from '../geo/projection';
import { DRAINAGE_CONFIG as C } from './drainageConfig';
export type Point2 = [number, number];
export type HeightSource = { getTerrainHeight(x:number,z:number):number; getRavineDistance(x:number,z:number):number; riverPath: Point2[] };
type Footprint = { rings: Point2[][]; minX:number;maxX:number;minZ:number;maxZ:number };
export type StreetNode = {x:number;z:number;edges:{to:number;length:number;roadId:string}[]};
export const distance = (a:Point2,b:Point2) => Math.hypot(a[0]-b[0],a[1]-b[1]);
export function segmentDistance(p:Point2,a:Point2,b:Point2) {
  const dx=b[0]-a[0], dz=b[1]-a[1];
  const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz || 1)));
  return distance(p,[a[0]+t*dx,a[1]+t*dz]);
}
function inRing(p:Point2,ring:Point2[]) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if ((a[1]>p[1]) !== (b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
  }
  return inside;
}
export function buildingObstacles(features:GeoFeature[]) {
  const result:Footprint[]=[];
  for(const f of features) {
    if(!f.properties.building || !f.geometry) continue;
    const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[];
    for(const p of polygons) {
      const rings=p.map(r=>r.map(toWorld));
      if(!rings[0]?.length) continue;
      result.push({rings,minX:Math.min(...rings[0].map(p=>p[0])),maxX:Math.max(...rings[0].map(p=>p[0])),minZ:Math.min(...rings[0].map(p=>p[1])),maxZ:Math.max(...rings[0].map(p=>p[1]))});
    }
  }
  return result;
}
export function avoidsBuildings(a:Point2,b:Point2,obstacles:Footprint[],margin=C.buildingClearance) {
  const nearby=obstacles.filter(o=>o.maxX+margin>=Math.min(a[0],b[0])&&o.minX-margin<=Math.max(a[0],b[0])&&o.maxZ+margin>=Math.min(a[1],b[1])&&o.minZ-margin<=Math.max(a[1],b[1]));
  const n=Math.max(1,Math.ceil(distance(a,b)/0.7));
  for(let i=0;i<=n;i++) {
    const p:Point2=[a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n];
    for(const o of nearby) {
      if(inRing(p,o.rings[0])&&!o.rings.slice(1).some(r=>inRing(p,r))) return false;
      for(const ring of o.rings) for(let j=1;j<ring.length;j++) if(segmentDistance(p,ring[j-1],ring[j])<margin) return false;
    }
  }
  return true;
}
function clip(a:Point2,b:Point2):[Point2,Point2]|null {
  const dx=b[0]-a[0],dz=b[1]-a[1], p=[-dx,dx,-dz,dz], q=[a[0]+245,245-a[0],a[1]+245,245-a[1]];
  let low=0,high=1;
  for(let i=0;i<4;i++) { if(Math.abs(p[i])<1e-10) {if(q[i]<0)return null;} else if(p[i]<0)low=Math.max(low,q[i]/p[i]);else high=Math.min(high,q[i]/p[i]); }
  return low>high?null:[[a[0]+dx*low,a[1]+dz*low],[a[0]+dx*high,a[1]+dz*high]];
}
export function createStreetGraph(features:GeoFeature[],terrain:HeightSource) {
  const segments:{a:Point2;b:Point2;roadId:string;cuts:number[]}[]=[];
  const allowed=new Set(['primary','secondary','tertiary','residential','living_street','service','pedestrian','unclassified']);
  const obstacles=buildingObstacles(features);
  for(const feature of features) {
    if(!allowed.has(String(feature.properties.highway)) || feature.properties.bridge==='yes' || !feature.geometry) continue;
    const lines=feature.geometry.type==='LineString'?[feature.geometry.coordinates]:feature.geometry.type==='MultiLineString'?feature.geometry.coordinates:[];
    for(const line of lines) for(let i=1;i<line.length;i++) {
      const clipped=clip(toWorld(line[i-1]),toWorld(line[i]));
      if(clipped&&distance(...clipped)>0.3) segments.push({a:clipped[0],b:clipped[1],roadId:String(feature.id),cuts:[0,1]});
    }
  }
  // Split genuine road intersections before constructing the adjacency graph.
  for(let i=0;i<segments.length;i++) for(let j=i+1;j<segments.length;j++) {
    const s=segments[i],t=segments[j],rx=s.b[0]-s.a[0],rz=s.b[1]-s.a[1],sx=t.b[0]-t.a[0],sz=t.b[1]-t.a[1];
    const cross=rx*sz-rz*sx;
    if(Math.abs(cross)<1e-9)continue;
    const qx=t.a[0]-s.a[0],qz=t.a[1]-s.a[1],u=(qx*sz-qz*sx)/cross,v=(qx*rz-qz*rx)/cross;
    if(u>=-1e-7&&u<=1+1e-7&&v>=-1e-7&&v<=1+1e-7) {s.cuts.push(Math.max(0,Math.min(1,u)));t.cuts.push(Math.max(0,Math.min(1,v)));}
  }
  const nodes:StreetNode[]=[],index=new Map<string,number>();
  const node=(p:Point2) => { const key=`${p[0].toFixed(2)},${p[1].toFixed(2)}`;if(index.has(key))return index.get(key)!;const id=nodes.length;nodes.push({x:p[0],z:p[1],edges:[]});index.set(key,id);return id; };
  for(const segment of segments) {
    const cuts=[...new Set(segment.cuts)].sort((a,b)=>a-b);
    for(let i=1;i<cuts.length;i++) {
      const start=cuts[i-1],end=cuts[i],length=distance(segment.a,segment.b)*(end-start);
      const parts=Math.max(1,Math.ceil(length/C.maxManholeSpacing));
      for(let j=0;j<parts;j++) {
        const at=(t:number):Point2=>[segment.a[0]+(segment.b[0]-segment.a[0])*t,segment.a[1]+(segment.b[1]-segment.a[1])*t];
        const a=at(start+(end-start)*j/parts),b=at(start+(end-start)*(j+1)/parts);
        if(distance(a,b)<0.2) continue;
        const n=Math.ceil(distance(a,b)/2);
        let clear=true;
        for(let k=0;k<=n;k++) {const x=a[0]+(b[0]-a[0])*k/n,z=a[1]+(b[1]-a[1])*k/n;if(terrain.getRavineDistance(x,z)<C.channelSetback||terrain.getTerrainHeight(x,z)<-0.14){clear=false;break;}}
        if(!clear||!avoidsBuildings(a,b,obstacles))continue;
        const na=node(a),nb=node(b);
        if(nodes[na].edges.some(e=>e.to===nb))continue;
        nodes[na].edges.push({to:nb,length:distance(a,b),roadId:segment.roadId});nodes[nb].edges.push({to:na,length:distance(a,b),roadId:segment.roadId});
      }
    }
  }
  return {nodes,obstacles};
}
