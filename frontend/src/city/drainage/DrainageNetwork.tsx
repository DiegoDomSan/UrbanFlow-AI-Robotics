import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { DrainageNetworkData } from './types';
import { createPipeShellGeometry } from './DrainagePipe';
import { createPipeWaterGeometry } from './DrainageWater';
import { DrainageManholes } from './DrainageManholes';
export interface DrainageNetworkProps {
  network:DrainageNetworkData; underground:boolean; visible:boolean; fill:number; highlightCollectors:boolean;
  selectedId:string|null;onSelect:(id:string|null)=>void;showWater:boolean;night:boolean;
}
/** Two shared instance batches retain physical pipe diameters. One-pixel schematic
 * traces aid distant inspection and fade on approach, without enlarging pipes. */
export function DrainageNetwork({network,underground,visible,fill,highlightCollectors,selectedId,onSelect,showWater,night}:DrainageNetworkProps) {
  const group=useRef<THREE.Group>(null),shellBatch=useRef<THREE.InstancedMesh>(null),waterBatch=useRef<THREE.InstancedMesh>(null);
  const shell=useMemo(createPipeShellGeometry,[]),water=useMemo(()=>createPipeWaterGeometry(fill),[fill]);
  const data=useMemo(()=>{
    const nodes=new Map(network.nodes.map(n=>[n.id,n]));
    const traces={collector:[] as number[],secondary:[] as number[]};
    const transforms=network.pipes.map(pipe=>{
      const a=nodes.get(pipe.from)!,b=nodes.get(pipe.to)!,start=new THREE.Vector3(a.x,a.y,a.z),end=new THREE.Vector3(b.x,b.y,b.z),forward=end.clone().sub(start).normalize();
      const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),forward).normalize(),up=new THREE.Vector3().crossVectors(forward,right).normalize();
      traces[pipe.kind].push(a.x,a.y+pipe.diameter/2,a.z,b.x,b.y+pipe.diameter/2,b.z);
      return new THREE.Matrix4().compose(start.add(end).multiplyScalar(.5),new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,up,forward)),new THREE.Vector3(pipe.diameter/2,pipe.diameter/2,pipe.length));
    });
    return {transforms,traces:Object.entries(traces).map(([kind,positions])=>({kind,geometry:new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(positions,3))})),center:new THREE.Box3().setFromPoints(network.nodes.map(n=>new THREE.Vector3(n.x,n.y,n.z))).getCenter(new THREE.Vector3())};
  },[network]);
  const traceMaterials=useMemo(()=>[new THREE.LineBasicMaterial({color:'#36d6ed',transparent:true,depthWrite:false}),new THREE.LineBasicMaterial({color:'#798fee',transparent:true,depthWrite:false})],[]);
  useFrame(({camera,controls})=>{
    const target=(controls as unknown as {target?:THREE.Vector3}|null)?.target??data.center;
    const opacity=THREE.MathUtils.clamp((camera.position.distanceTo(target)-90)/260,0,.85);
    traceMaterials.forEach(m=>m.opacity=opacity);
  });
  useLayoutEffect(()=>{
    const color=new THREE.Color();
    data.transforms.forEach((matrix,i)=>{
      shellBatch.current?.setMatrixAt(i,matrix);waterBatch.current?.setMatrixAt(i,matrix);
      const pipe=network.pipes[i];color.set(selectedId===pipe.id?'#ffe197':pipe.kind==='collector'?(highlightCollectors?'#16d6ee':'#269fb8'):'#637fca');
      shellBatch.current?.setColorAt(i,color);
    });
    for(const mesh of [shellBatch.current,waterBatch.current])if(mesh){mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();}
    group.current?.traverse(object=>object.layers.set(underground?1:0));
    traceMaterials[0].color.set(highlightCollectors?'#36d6ed':'#269fb8');
  },[data,network,underground,visible,fill,showWater,selectedId,highlightCollectors,traceMaterials]);
  useEffect(()=>()=>shell.dispose(),[shell]);
  useEffect(()=>()=>water?.dispose(),[water]);
  useEffect(()=>()=>data.traces.forEach(t=>t.geometry.dispose()),[data]);
  useEffect(()=>()=>traceMaterials.forEach(m=>m.dispose()),[traceMaterials]);
  const select=(event:ThreeEvent<MouseEvent>)=>{if(event.instanceId!==undefined){event.stopPropagation();onSelect(network.pipes[event.instanceId].id);}};
  const selectedIndex=network.pipes.findIndex(p=>p.id===selectedId);
  if(!visible)return null;
  return <group ref={group} name={network.label}>
    <DrainageManholes network={network} underground={underground}/>
    {underground&&<>
      <instancedMesh ref={shellBatch} args={[shell,undefined,network.pipes.length]} onClick={select}>
        <meshStandardMaterial color="#ffffff" roughness={.5} side={THREE.DoubleSide} emissive="#237b9c" emissiveIntensity={night?.45:.17}/>
      </instancedMesh>
      {showWater&&water&&<instancedMesh ref={waterBatch} args={[water,undefined,network.pipes.length]} onClick={select} renderOrder={2}>
        <meshStandardMaterial color="#97e8ff" emissive="#36a9e2" emissiveIntensity={.32} roughness={.22} side={THREE.DoubleSide} transparent opacity={.82} depthWrite={false}/>
      </instancedMesh>}
      {data.traces.map((t,i)=><lineSegments key={t.kind} geometry={t.geometry} material={traceMaterials[i]} raycast={()=>{}} renderOrder={1}/>)}
      {selectedIndex>=0&&<mesh geometry={shell} matrixAutoUpdate={false} matrix={data.transforms[selectedIndex]} renderOrder={3}>
        <meshBasicMaterial color="#ffdc7e" wireframe transparent opacity={.95} depthWrite={false} polygonOffset polygonOffsetFactor={-2}/>
      </mesh>}
      {network.nodes.filter(n=>n.kind==='outfall').map(n=><mesh key={n.id} position={[n.x,n.y,n.z]}><sphereGeometry args={[.75,12,8]}/><meshStandardMaterial color="#ffbf6f" wireframe/></mesh>)}
    </>}
  </group>;
}
