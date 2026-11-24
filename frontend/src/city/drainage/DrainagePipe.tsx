import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { DrainagePipe as PipeData } from './types';
export function createPipeShellGeometry() {
  const positions:number[]=[],indices:number[]=[],count=20;
  // An open top quarter exposes the real circular water segment without depth sorting artifacts.
  for(let i=0;i<=count;i++){const angle=Math.PI*0.75+Math.PI*1.5*i/count;for(const z of [-0.5,0.5])positions.push(Math.cos(angle),Math.sin(angle),z);}
  for(let i=0;i<count;i++){const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
export function DrainagePipe({pipe,matrix,shell,water,material,waterMaterial,onSelect,selected}:{pipe:PipeData;matrix:THREE.Matrix4;shell:THREE.BufferGeometry;water:THREE.BufferGeometry|null;material:THREE.Material;waterMaterial:THREE.Material;onSelect:(id:string)=>void;selected:boolean}) {
  const select=(event:ThreeEvent<MouseEvent>)=>{event.stopPropagation();onSelect(pipe.id);};
  return <group dispose={null} matrixAutoUpdate={false} matrix={matrix}>
    <mesh renderOrder={6} name={pipe.id} geometry={shell} material={material} onClick={select} />
    {selected&&<mesh geometry={shell} scale={[1.08,1.08,1.002]} renderOrder={8}><meshBasicMaterial color="#ffba38" wireframe transparent opacity={0.8} depthTest={true} depthWrite={false}/></mesh>}
    {water&&<mesh renderOrder={7} name={`${pipe.id}-water`} geometry={water} material={waterMaterial} onClick={select}/>}
  </group>;
}
