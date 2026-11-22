import { useLayoutEffect,useMemo,useRef } from 'react';
import * as THREE from 'three';
import type { DrainageNetworkData } from './types';
export function DrainageManholes({network,underground}:{network:DrainageNetworkData;underground:boolean}) {
  const covers=useRef<THREE.InstancedMesh>(null),shafts=useRef<THREE.InstancedMesh>(null),inlets=useRef<THREE.InstancedMesh>(null);
  const all=useMemo(()=>network.nodes.filter(n=>n.kind!=='outfall'&&n.kind!=='bend'),[network]);
  const radii=useMemo(()=>new Map(all.map(n=>[n.id,Math.max(.55,...network.pipes.filter(p=>p.from===n.id||p.to===n.id).map(p=>p.diameter/2+.16))])),[all,network]);
  const grates=useMemo(()=>all.filter(n=>n.kind==='inlet'),[all]);
  useLayoutEffect(()=>{
    const object=new THREE.Object3D();
    all.forEach((n,i)=>{object.position.set(n.x,n.surfaceY+0.16,n.z);object.scale.set(1,1,1);object.updateMatrix();covers.current?.setMatrixAt(i,object.matrix);const h=n.surfaceY-n.y;object.position.set(n.x,n.y+h/2,n.z);object.scale.set(radii.get(n.id)!/.52,h,radii.get(n.id)!/.52);object.updateMatrix();shafts.current?.setMatrixAt(i,object.matrix);});
    grates.forEach((n,i)=>{object.position.set(n.x,n.surfaceY+0.2,n.z);object.scale.set(1,1,1);object.updateMatrix();inlets.current?.setMatrixAt(i,object.matrix);});
    for(const mesh of [covers.current,shafts.current,inlets.current])if(mesh){mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();}
  },[all,grates,underground,radii]);
  return <group name="Inspection chambers and street inlets">
    <instancedMesh ref={covers} args={[undefined,undefined,all.length]}>
      <cylinderGeometry args={[0.58,0.58,0.06,12]}/><meshStandardMaterial color={underground?'#91c9d5':'#61717a'} roughness={0.8}/>
    </instancedMesh>
    <instancedMesh ref={inlets} args={[undefined,undefined,grates.length]}>
      <boxGeometry args={[0.85,0.035,0.54]}/><meshStandardMaterial color="#172c34" roughness={0.8}/>
    </instancedMesh>
    {underground&&<instancedMesh ref={shafts} args={[undefined,undefined,all.length]}>
      <cylinderGeometry args={[0.52,0.52,1,10,1,true]}/><meshStandardMaterial color="#6195ac" transparent opacity={0.48} depthWrite={false} side={THREE.DoubleSide}/>
    </instancedMesh>}
  </group>;
}
