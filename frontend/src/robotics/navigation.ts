import type { GeoFeature } from '../city/geo/geojsonTypes';
import type { TerrainModel } from '../city/terrain/terrainHeight';
import type { DrainageNetworkData } from '../city/drainage/types';
import { avoidsBuildings, createStreetGraph, type Point2 } from '../city/drainage/streetGraph';
import { getRoadHeight } from '../city/geo/roadGeometry';
import type { Position, RobotKind, RoboticsWorld } from './types';

export function buildingPathClear(a:Point2,b:Point2,obstacles:RoboticsWorld['obstacles'],margin:number=.8):boolean {
 const check=avoidsBuildings as (a:Point2,b:Point2,obstacles:RoboticsWorld['obstacles'],margin:number)=>boolean;
 return check(a,b,obstacles,margin);
}
export const distance3=(a:Position,b:Position)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
export const groundPosition=(world:Pick<RoboticsWorld,'terrain'>,x:number,z:number):Position=>[x,getRoadHeight(world.terrain,x,z,{bridge:false})+.02,z];
export function buildRoboticsWorld(features:GeoFeature[],terrain:TerrainModel,network:DrainageNetworkData):RoboticsWorld {
 const {nodes,obstacles}=createStreetGraph(features,terrain);
 if(!nodes.length)throw new Error('No accessible ground routes are available in this map.');
 // Use the component containing most streets. Never bridge disconnected streets with straight lines.
 const seen=new Set<number>(); let largest:number[]=[];
 for(let i=0;i<nodes.length;i++)if(!seen.has(i)) {const group:number[]=[],queue=[i];seen.add(i);while(queue.length){const n=queue.pop()!;group.push(n);for(const e of nodes[n].edges)if(!seen.has(e.to)){seen.add(e.to);queue.push(e.to);}}if(group.length>largest.length)largest=group;}
 const origin=largest.reduce((best,i)=>Math.hypot(nodes[i].x,nodes[i].z)<Math.hypot(nodes[best].x,nodes[best].z)?i:best,largest[0]);
 const start:Position=[nodes[origin].x,getRoadHeight(terrain,nodes[origin].x,nodes[origin].z,{bridge:false})+.02,nodes[origin].z];
 let roofY=20;
 for(const f of features)if(f.properties.building){const explicit=Number.parseFloat(String(f.properties.height??'')),levels=Number.parseFloat(String(f.properties['building:levels']??''));const h=Number.isFinite(explicit)?explicit:Number.isFinite(levels)?levels*3.1:10;roofY=Math.max(roofY,h+2);}
 const world:RoboticsWorld={nodes,obstacles,terrain,start,drainagePoints:[],safeFlightY:Math.ceil(roofY+10)};
 world.drainagePoints=network.nodes.filter(n=>n.kind==='inlet'||n.kind==='manhole'||n.kind==='junction').flatMap(n=>{
  const position=groundPosition(world,n.x,n.z);
  try{planRoute(world,'maintenance',start,position);return [{id:n.id,label:`${n.kind==='inlet'?'Inlet':'Access'} ${n.id}`,position}];}catch{return [];}
 });
 return world;
}
interface RoadSnap {point:Position;a:number;b:number;t:number;distance:number}
function roadSnap(world:RoboticsWorld,position:Position):RoadSnap {
 let best:RoadSnap|null=null;
 for(let a=0;a<world.nodes.length;a++)for(const edge of world.nodes[a].edges){const b=edge.to;if(b<a)continue;const p=world.nodes[a],q=world.nodes[b],dx=q.x-p.x,dz=q.z-p.z;
  const t=Math.max(0,Math.min(1,((position[0]-p.x)*dx+(position[2]-p.z)*dz)/(dx*dx+dz*dz)));
  const x=p.x+t*dx,z=p.z+t*dz,distance=Math.hypot(x-position[0],z-position[2]);
  if(!best||distance<best.distance)best={point:groundPosition(world,x,z),a,b,t,distance};
 }
 if(!best)throw new Error('The accessible road graph is empty.');return best;
}
// Worlds are immutable map snapshots. Cache one shortest-path tree per origin so
// validating every drainage entrance does not repeatedly traverse the same graph.
const shortestTrees=new WeakMap<RoboticsWorld,Map<number,{dist:Float64Array;parent:Int32Array}>>();
function shortest(world:RoboticsWorld,start:number,end:number):number[]|null {
 if(start===end)return [start];
 let trees=shortestTrees.get(world);if(!trees){trees=new Map();shortestTrees.set(world,trees);}
 let tree=trees.get(start);
 if(!tree){
  const dist=new Float64Array(world.nodes.length).fill(Infinity),parent=new Int32Array(world.nodes.length).fill(-1),visited=new Uint8Array(world.nodes.length);dist[start]=0;
  for(let count=0;count<world.nodes.length;count++) {let current=-1;for(let i=0;i<dist.length;i++)if(!visited[i]&&(current<0||dist[i]<dist[current]))current=i;
   if(current<0||!Number.isFinite(dist[current]))break;visited[current]=1;
   for(const e of world.nodes[current].edges){const next=dist[current]+e.length;if(next<dist[e.to]){dist[e.to]=next;parent[e.to]=current;}}
  }
  tree={dist,parent};trees.set(start,tree);
 }
 if(!Number.isFinite(tree.dist[end]))return null;const path=[end];while(path[0]!==start){const p=tree.parent[path[0]];if(p<0)return null;path.unshift(p);}return path;
}
function clean(points:Position[]):Position[]{return points.filter((p,i)=>i===0||distance3(p,points[i-1])>.02);}
function checkBounds(p:Position){if(!p.every(Number.isFinite)||Math.abs(p[0])>245||Math.abs(p[2])>245)throw new Error('Choose a destination inside the 490 × 490 m route planning area.');}
/** Clicks are snapped to registered streets. Distant clicks are rejected rather than sent through buildings. */
export function snapWaypoint(world:RoboticsWorld,kind:RobotKind,x:number,z:number):Position {
 const p:Position=[x,world.safeFlightY,z];checkBounds(p);if(kind==='drone')return p;
 const snap=roadSnap(world,p);if(snap.distance>18)throw new Error('Click closer to an accessible street (within 18 m). Bridges and isolated streets are excluded.');return snap.point;
}
export function planRoute(world:RoboticsWorld,kind:RobotKind,from:Position,to:Position):Position[] {
 checkBounds(from);checkBounds(to);
 if(kind==='drone') {
  // Horizontal flight only above all registered building roofs. Vertical movement is handled at takeoff/home.
  const y=Math.max(world.safeFlightY,from[1],to[1]);return clean([from,[from[0],y,from[2]],[to[0],y,to[2]]]);
 }
 const a=roadSnap(world,from),b=roadSnap(world,to);
 if(a.distance>3||b.distance>3)throw new Error('The destination is outside the accessible street corridor.');
 const safe=(x:Position,y:Position)=>buildingPathClear([x[0],x[2]],[y[0],y[2]],world.obstacles,.8);
 if(!safe(from,a.point)||!safe(b.point,to))throw new Error('A building blocks the connection to this destination.');
 if(a.a===b.a&&a.b===b.b)return clean([from,a.point,b.point,to]);
 let best:Position[]|null=null,bestLength=Infinity;
 for(const start of [a.a,a.b])for(const end of [b.a,b.b]){const ids=shortest(world,start,end);if(!ids)continue;const points=clean([from,a.point,...ids.map(i=>groundPosition(world,world.nodes[i].x,world.nodes[i].z)),b.point,to]);const length=points.slice(1).reduce((sum,p,i)=>sum+distance3(points[i],p),0);if(length<bestLength){best=points;bestLength=length;}}
 if(!best)throw new Error('This street is disconnected from the robot’s road network. Choose a waypoint on the same side of the river.');
 return best;
}
/** Direct forward commands remain on the mapped street corridor at every sampled position. */
export function forwardPath(world:RoboticsWorld,kind:RobotKind,from:Position,heading:number,metres:number):Position[] {
 const end:Position=[from[0]+Math.sin(heading)*metres,from[1],from[2]+Math.cos(heading)*metres];checkBounds(end);
 if(kind==='drone'){if(from[1]<world.safeFlightY-.1)throw new Error('Take off to the safe cruise height before moving.');return [from,end];}
 const steps=Math.max(1,Math.ceil(Math.abs(metres)/.5)),path:Position[]=[from];
 for(let i=1;i<=steps;i++){const p=groundPosition(world,from[0]+(end[0]-from[0])*i/steps,from[2]+(end[2]-from[2])*i/steps);const snap=roadSnap(world,p);
  if(snap.distance>1.25||!buildingPathClear([path[path.length-1][0],path[path.length-1][2]],[p[0],p[2]],world.obstacles,.8))throw new Error('Forward movement leaves the accessible road or meets a building. Use a planned route or turn first.');path.push(p);
 }
 return path;
}
export function initialHeading(world:RoboticsWorld):number {const snap=roadSnap(world,world.start),target=world.nodes[snap.t<.5?snap.b:snap.a];return Math.atan2(target.x-world.start[0],target.z-world.start[2]);}
export function nearestDrain(world:RoboticsWorld,position:Position,id='nearest') {
 const point=id==='nearest'?[...world.drainagePoints].sort((a,b)=>distance3(a.position,position)-distance3(b.position,position))[0]:world.drainagePoints.find(p=>p.id===id);
 if(!point)throw new Error('No accessible drainage entrance is selected.');return point;
}
export function routeLength(points:Position[]):number{return points.slice(1).reduce((n,p,i)=>n+distance3(points[i],p),0);}
