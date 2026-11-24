import * as THREE from 'three';
/** Invert the area of a circular segment: percent is cross-sectional volume,
 * not percent of diameter. The same mesh is shared by every pipe. */
export function fillHeight(fillPercentage:number):number {
  const fill=Math.max(0,Math.min(1,fillPercentage/100));
  if(fill===0)return -1;if(fill===1)return 1;
  let low=-1,high=1;
  for(let i=0;i<36;i++){const h=(low+high)/2,area=(h*Math.sqrt(Math.max(0,1-h*h))+Math.asin(h)+Math.PI/2)/Math.PI;if(area<fill)low=h;else high=h;}
  return (low+high)/2;
}
export function createPipeWaterGeometry(fillPercentage:number) {
  if(fillPercentage<=0)return null;
  const h=fillHeight(fillPercentage),a=Math.asin(h),points:THREE.Vector2[]=[];
  // Travel around the lower circle from the left waterline to the right one.
  const start=Math.PI-a,end=2*Math.PI+a;
  for(let i=0;i<=32;i++){const t=start+(end-start)*i/32;points.push(new THREE.Vector2(Math.cos(t)*0.93,Math.sin(t)*0.93));}
  const shape=new THREE.Shape(points),geometry=new THREE.ExtrudeGeometry(shape,{depth:1,bevelEnabled:false,steps:1,curveSegments:1});
  geometry.translate(0,0,-0.5);
  return geometry;
}
