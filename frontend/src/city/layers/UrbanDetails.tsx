import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { GeoFeature } from '../geo/geojsonTypes';
import type { TerrainModel } from '../terrain/terrainHeight';
import { createUrbanDetails } from '../urban/createUrbanDetails';
import { createUrbanMatrices, pavingGeometry } from '../urban/urbanMeshes';
import { URBAN_CONFIG as C } from '../urban/urbanConfig';

type InstanceProps={geometry:THREE.BufferGeometry;matrices:THREE.Matrix4[];color:string;underground:boolean;emissive?:string;emissiveIntensity?:number;colors?:string[];metalness?:number};
function Batch({geometry,matrices,color,underground,emissive='#000000',emissiveIntensity=0,colors,metalness=0}:InstanceProps){
  const ref=useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(()=>{
    const mesh=ref.current;if(!mesh)return;
    matrices.forEach((matrix,i)=>{mesh.setMatrixAt(i,matrix);if(colors)mesh.setColorAt(i,new THREE.Color(colors[i%colors.length]));});
    mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();
  },[matrices,colors]);
  if(!matrices.length)return null;
  return <instancedMesh ref={ref} args={[geometry,undefined,matrices.length]} castShadow={!underground} receiveShadow={!underground}>
    <meshStandardMaterial key={underground?'xray':'surface'} color={color} roughness={.76} metalness={metalness} emissive={emissive} emissiveIntensity={emissiveIntensity}
      transparent={underground} opacity={underground ? .12 : 1} depthWrite={!underground}/>
  </instancedMesh>;
}

/** Static geometry is cached; only materials and six lamps respond to environment changes. */
export function UrbanDetails({features,terrain,underground,night}:{features:GeoFeature[];terrain:TerrainModel;underground:boolean;night:boolean}){
  const data=useMemo(()=>createUrbanDetails(features,terrain),[features,terrain]);
  const matrices=useMemo(()=>createUrbanMatrices(data),[data]);
  const resources=useMemo(()=>({
    box:new THREE.BoxGeometry(1,1,1),pole:new THREE.CylinderGeometry(1,1,1,7),sphere:new THREE.SphereGeometry(1,10,7),shrub:new THREE.IcosahedronGeometry(1,1),
    sidewalks:pavingGeometry(data.sidewalks,terrain,C.sidewalkElevation),curbs:pavingGeometry(data.curbs,terrain,C.sidewalkElevation+.045),
  }),[data,terrain]);
  const shrubColors=useMemo(()=>data.shrubs.map(p=>['#4e7452','#5c8054','#6f8656'][p.variant]),[data]);
  const grassColors=useMemo(()=>data.grassPatches.map(p=>['#7f9863','#88a36a','#769261'][p.variant]),[data]);
  const signalColors=useMemo(()=>[0,1,2].map(state=>data.signals.map((_,i)=>state===(i%2?2:0)?['#df493b','#dfad37','#72bd80'][state]:['#472d29','#4b4230','#284d37'][state])),[data]);
  const selectedLights=useMemo(()=>Array.from({length:Math.min(C.maxDynamicLights,data.lamps.length)},(_,i)=>data.lamps[Math.floor(i*data.lamps.length/Math.min(C.maxDynamicLights,data.lamps.length))]),[data]);
  useEffect(()=>()=>Object.values(resources).forEach(g=>g.dispose()),[resources]);
  const shared={underground};
  return <group name="Fictional educational urban details">
    <mesh geometry={resources.sidewalks} receiveShadow={!underground}>
      <meshStandardMaterial key={underground?'xray':'surface'} color="#c1bba7" roughness={.96} side={THREE.DoubleSide} transparent={underground} opacity={underground ? .1 : 1} depthWrite={!underground}/>
    </mesh>
    <mesh geometry={resources.curbs} receiveShadow={!underground}>
      <meshStandardMaterial key={underground?'xray':'surface'} color="#e0d5bd" roughness={.92} side={THREE.DoubleSide} transparent={underground} opacity={underground ? .1 : 1} depthWrite={!underground}/>
    </mesh>
    <Batch {...shared} geometry={resources.box} matrices={matrices.trackBed} color="#677573"/>
    <group name="Fictional educational tram corridor"><Batch {...shared} geometry={resources.box} matrices={matrices.rails} color="#b8c4c7" metalness={.65}/></group>
    <Batch {...shared} geometry={resources.box} matrices={matrices.crossings} color="#edece2"/>
    <Batch {...shared} geometry={resources.box} matrices={matrices.markings} color="#eee7cb"/>
    <Batch {...shared} geometry={resources.pole} matrices={matrices.lampPoles} color="#4c5d60" metalness={.35}/>
    <Batch {...shared} geometry={resources.box} matrices={matrices.lampArms} color="#4c5d60" metalness={.35}/>
    <Batch {...shared} geometry={resources.box} matrices={matrices.lampHeads} color="#4b6065"/>
    <Batch {...shared} geometry={resources.box} matrices={matrices.lampBulbs} color={night?'#fff3c9':'#bac5c5'} emissive="#ffda8b" emissiveIntensity={night?2.5:0}/>
    <Batch {...shared} geometry={resources.pole} matrices={matrices.signalPoles} color="#394d52"/>
    <Batch {...shared} geometry={resources.box} matrices={matrices.signalHeads} color="#20343a"/>
    {matrices.signalBulbs.map((matrices,index)=><Batch key={index} {...shared} geometry={resources.sphere} matrices={matrices} color="#ffffff" colors={signalColors[index]} emissive={['#652219','#4b3513','#174328'][index]} emissiveIntensity={night ? .8 : .3}/>)}
    {!underground&&<>
      <Batch {...shared} geometry={resources.shrub} matrices={matrices.shrubs} color="#ffffff" colors={shrubColors}/>
      <Batch {...shared} geometry={resources.pole} matrices={matrices.grass} color="#ffffff" colors={grassColors}/>
    </>}
    {night&&selectedLights.map((lamp,i)=><pointLight key={i} position={[lamp.x+lamp.inward[0]*1.16,lamp.y+C.lampHeight-.4,lamp.z+lamp.inward[1]*1.16]} color="#ffdca0" intensity={155} distance={28} decay={2}/>)}
  </group>;
}
