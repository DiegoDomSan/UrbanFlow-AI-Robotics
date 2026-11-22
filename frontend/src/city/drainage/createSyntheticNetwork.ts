import type { GeoFeature } from '../geo/geojsonTypes';
import type { TerrainModel } from '../terrain/terrainHeight';
import type { DrainageNetworkData, DrainageNode, DrainagePipe } from './types';
import { DRAINAGE_CONFIG as C } from './drainageConfig';
import { createStreetGraph, avoidsBuildings, distance, type Point2 } from './streetGraph';
function randomGenerator(seed:number) {
  let value=seed>>>0;
  return () => { value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296; };
}
function nearestRiver(point:Point2,path:Point2[]) {
  let best:Point2=path[0],bestDistance=Infinity;
  for(let i=1;i<path.length;i++) {
    const a=path[i-1],b=path[i],dx=b[0]-a[0],dz=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dz)/(dx*dx+dz*dz||1)));
    const p:Point2=[a[0]+t*dx,a[1]+t*dz],d=distance(p,point);
    if(d<bestDistance){best=p;bestDistance=d;}
  }
  return best;
}
/** A gravity tree follows a viable connected component of mapped streets.
 * No hydraulic capacity, surveyed invert or real sewer asset is implied. */
export function createSyntheticNetwork(features:GeoFeature[],terrain:TerrainModel,seed:number=C.seed):DrainageNetworkData {
  const {nodes:street,obstacles}=createStreetGraph(features,terrain),random=randomGenerator(seed);
  if(!street.length || terrain.riverPath.length<2) throw new Error('No usable street network or mapped ravine for the drainage model.');
  const visited=new Set<number>(),components:number[][]=[];
  for(let i=0;i<street.length;i++) {
    if(visited.has(i))continue;
    const component:number[]=[],queue=[i];visited.add(i);
    for(let k=0;k<queue.length;k++){const id=queue[k];component.push(id);for(const e of street[id].edges)if(!visited.has(e.to)){visited.add(e.to);queue.push(e.to);}}
    components.push(component);
  }
  components.sort((a,b)=>b.length-a.length);
  let root=-1,outlet:Point2|null=null;
  let component:number[]=[];
  // The first component with a collision-free bank connection becomes a modeled catchment.
  for(const candidates of components) {
    if(candidates.length<6)continue;
    const ordered=[...candidates].sort((a,b)=>terrain.getRavineDistance(street[a].x,street[a].z)-terrain.getRavineDistance(street[b].x,street[b].z)||a-b);
    for(const id of ordered) {
      const a:Point2=[street[id].x,street[id].z],river=nearestRiver(a,terrain.riverPath);
      if(distance(a,river)>65)continue;
      let p:Point2|null=null;
      // End where the bank falls to the outlet center: an explicitly exposed mouth.
      for(let t=0;t<=1.0001;t+=0.005){const q:Point2=[a[0]+(river[0]-a[0])*t,a[1]+(river[1]-a[1])*t];if(terrain.getTerrainHeight(...q)<=C.outletElevation){p=q;break;}}
      if(!p||Math.abs(p[0])>245||Math.abs(p[1])>245||!avoidsBuildings(a,p,obstacles))continue;
      root=id;outlet=p;component=candidates;break;
    }
    if(root>=0)break;
  }
  if(root<0 || !outlet) throw new Error('Unable to place a safe synthetic bank outfall.');
  const distances=new Map<number,number>([[root,0]]),parent=new Map<number,{id:number;roadId:string}>(),remaining=new Set(component);
  while(remaining.size) {
    let current=-1,minimum=Infinity;
    for(const id of remaining){const d=distances.get(id)??Infinity;if(d<minimum){minimum=d;current=id;}}
    if(current<0)break;
    remaining.delete(current);
    for(const edge of street[current].edges){const d=minimum+edge.length;if(d<(distances.get(edge.to)??Infinity)-1e-8){distances.set(edge.to,d);parent.set(edge.to,{id:current,roadId:edge.roadId});}}
  }
  const outletLength=distance([street[root].x,street[root].z],outlet);
  const included=component.filter(id=>(distances.get(id)??Infinity)+outletLength<=C.maxCatchmentPath).sort((a,b)=>a-b);
  const includedSet=new Set(included),idFor=(id:number)=>`MH-${String(id+1).padStart(3,'0')}`;
  const children=new Map<number,number[]>();
  for(const id of included){const p=parent.get(id);if(p&&includedSet.has(p.id)){const list=children.get(p.id)??[];list.push(id);children.set(p.id,list);}}
  const drainageNodes:DrainageNode[]=included.map(id=>({
    id:idFor(id),kind:(children.get(id)?.length??0)===0?'inlet':(children.get(id)?.length??0)>1?'junction':'manhole',
    x:street[id].x,z:street[id].z,y:C.outletElevation+((distances.get(id)??0)+outletLength)*C.gravityGradient,
    surfaceY:terrain.getTerrainHeight(street[id].x,street[id].z),downstreamId:id===root?'OUT-001':idFor(parent.get(id)!.id),
  }));
  // Degree-two OSM vertices are routing bends, not automatically inspection chambers.
  // Place intermediate chambers about 40–55 m apart; junctions/inlets can be closer.
  const lastChamberDistance=new Map<number,number>();
  for(const id of [...included].sort((a,b)=>(distances.get(a)??0)-(distances.get(b)??0))) {
    const n=drainageNodes.find(n=>n.id===idFor(id))!,d=distances.get(id)??0,p=parent.get(id);
    const previous=p?(lastChamberDistance.get(p.id)??0):0;
    const next=children.get(id)??[];
    if(n.kind==='manhole' && id!==root && d-previous<40 && !next.some(child=>(distances.get(child)??0)-previous>55))n.kind='bend';
    lastChamberDistance.set(id,n.kind==='bend'?previous:d);
  }
  drainageNodes.push({id:'OUT-001',kind:'outfall',x:outlet[0],z:outlet[1],y:C.outletElevation,surfaceY:terrain.getTerrainHeight(...outlet),downstreamId:null});
  const counts=new Map<number,number>();
  const count=(id:number):number=>{if(counts.has(id))return counts.get(id)!;const n=1+(children.get(id)??[]).reduce((sum,c)=>sum+count(c),0);counts.set(id,n);return n;};
  count(root);
  const nodeMap=new Map(drainageNodes.map(n=>[n.id,n]));
  const pipes:DrainagePipe[]=included.map((id,index)=>{
    const from=nodeMap.get(idFor(id))!,to=nodeMap.get(from.downstreamId!)!,horizontal=Math.hypot(from.x-to.x,from.z-to.z);
    const collector=(counts.get(id)??1)>=5||id===root;
    const range=collector?C.collectorDiameter:C.secondaryDiameter;
    const steps=Math.round((range[1]-range[0])*10);
    const diameter=range[0]+0.1*Math.floor(random()*(steps+1));
    return {id:`SW-${String(index+1).padStart(3,'0')}`,kind:collector?'collector':'secondary',from:from.id,to:to.id,diameter:Number(diameter.toFixed(1)),length:Math.hypot(horizontal,from.y-to.y),gradient:(from.y-to.y)/horizontal,fillPercentage:C.defaultFillPercentage,downstreamId:null,roadId:id===root?'synthetic-bank-connection':parent.get(id)!.roadId};
  });
  // Downstream pipes must not narrow below their incoming upstream branches.
  const pipeFrom=new Map(pipes.map(p=>[p.from,p]));
  for(const id of [...included].sort((a,b)=>(distances.get(b)??0)-(distances.get(a)??0))) {
    const pipe=pipeFrom.get(idFor(id))!;
    for(const child of children.get(id)??[])pipe.diameter=Math.max(pipe.diameter,pipeFrom.get(idFor(child))!.diameter);
  }
  const outgoing=new Map(pipes.map(p=>[p.from,p.id]));
  for(const pipe of pipes)pipe.downstreamId=outgoing.get(pipe.to)??null;
  return {seed,label:'Synthetic Stormwater Drainage Network — Educational Model',nodes:drainageNodes,pipes,outfallIds:['OUT-001'],coverageNote:`Synthetic catchment: ${included.length} connected street nodes on one bank. Other components and routes beyond ${C.maxCatchmentPath} m are excluded; no fictional crossings beneath the ravine are generated.`};
}
