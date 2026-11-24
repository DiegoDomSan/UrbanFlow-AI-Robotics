import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { conformSurfaceGeometry } from '../layers/LandCover';
import type { TerrainModel } from '../terrain/terrainHeight';
import type { MultiPolygon2, SurfaceMark, UrbanDetailsData } from './types';
import { URBAN_CONFIG as C } from './urbanConfig';

export function transform(x:number,y:number,z:number,sx:number,sy:number,sz:number,yaw=0):THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw),new THREE.Vector3(sx,sy,sz));
}
export function pavingGeometry(polygons:MultiPolygon2,terrain:TerrainModel,elevation:number):THREE.BufferGeometry {
  const pieces:THREE.BufferGeometry[]=[];
  for(const polygon of polygons){
    const shape=new THREE.Shape(polygon[0].map(([x,z])=>new THREE.Vector2(x,-z)));
    for(const ring of polygon.slice(1))shape.holes.push(new THREE.Path(ring.map(([x,z])=>new THREE.Vector2(x,-z))));
    const source=new THREE.ShapeGeometry(shape);source.rotateX(-Math.PI/2);
    const top=conformSurfaceGeometry(source,terrain);source.dispose();top.translate(0,elevation-.025,0);pieces.push(top);
    const sides:number[]=[];
    for(const ring of polygon)for(let i=1;i<ring.length;i++){
      const [ax,az]=ring[i-1],[bx,bz]=ring[i],ay=terrain.getTerrainHeight(ax,az),by=terrain.getTerrainHeight(bx,bz);
      sides.push(ax,ay+.07,az,bx,by+.07,bz,ax,ay+elevation,az,bx,by+.07,bz,bx,by+elevation,bz,ax,ay+elevation,az);
    }
    const wall=new THREE.BufferGeometry();wall.setAttribute('position',new THREE.Float32BufferAttribute(sides,3));wall.computeVertexNormals();pieces.push(wall);
  }
  const geometry=pieces.length?mergeGeometries(pieces)!:new THREE.BufferGeometry();
  pieces.forEach(p=>p.dispose());
  return geometry;
}
export const markMatrices=(marks:SurfaceMark[])=>marks.map(m=>transform(m.x,m.y,m.z,m.length,.012,m.width,-Math.atan2(m.direction[1],m.direction[0])));
export function createUrbanMatrices(data:UrbanDetailsData) {
  const lampPoles=data.lamps.map(l=>transform(l.x,l.y+C.lampHeight/2,l.z,.11,C.lampHeight,.11));
  const lampArms=data.lamps.map(l=>transform(l.x+l.inward[0]*.6,l.y+C.lampHeight-.12,l.z+l.inward[1]*.6,1.35,.11,.11,-Math.atan2(l.inward[1],l.inward[0])));
  const lampHeads=data.lamps.map(l=>transform(l.x+l.inward[0]*1.16,l.y+C.lampHeight-.22,l.z+l.inward[1]*1.16,.8,.16,.34,-Math.atan2(l.inward[1],l.inward[0])));
  const lampBulbs=data.lamps.map(l=>transform(l.x+l.inward[0]*1.16,l.y+C.lampHeight-.315,l.z+l.inward[1]*1.16,.64,.035,.27,-Math.atan2(l.inward[1],l.inward[0])));
  const signalPoles=data.signals.map(l=>transform(l.x,l.y+1.85,l.z,.085,3.7,.085));
  const signalHeads=data.signals.map(l=>transform(l.x,l.y+3.75,l.z,.43,1.04,.32,Math.atan2(l.facing[0],l.facing[1])));
  const signalBulbs=[.29,0,-.29].map(offset=>data.signals.map(l=>transform(l.x+l.facing[0]*.18,l.y+3.75+offset,l.z+l.facing[1]*.18,.115,.115,.065,Math.atan2(l.facing[0],l.facing[1]))));
  const shrubs=data.shrubs.map(p=>transform(p.x,p.y+p.height/2,p.z,p.radius,p.height/2,p.radius));
  const grass=data.grassPatches.map(p=>transform(p.x,p.y+.038,p.z,p.radius,.014,p.radius));
  const rails:THREE.Matrix4[]=[],trackBed:THREE.Matrix4[]=[];
  if(data.tram){
    const t=data.tram,cx=(t.start[0]+t.end[0])/2,cz=(t.start[1]+t.end[1])/2,nx=-t.direction[1],nz=t.direction[0],yaw=-Math.atan2(t.direction[1],t.direction[0]);
    trackBed.push(transform(cx,t.y+.009,cz,t.length,.018,C.tramBedWidth,yaw));
    for(const side of [-1,1])rails.push(transform(cx+side*nx*t.gauge/2,t.y+.045,cz+side*nz*t.gauge/2,t.length,.055,.055,yaw));
  }
  return {lampPoles,lampArms,lampHeads,lampBulbs,signalPoles,signalHeads,signalBulbs,shrubs,grass,rails,trackBed,crossings:markMatrices(data.crossingStripes),markings:markMatrices(data.laneMarkings)};
}
