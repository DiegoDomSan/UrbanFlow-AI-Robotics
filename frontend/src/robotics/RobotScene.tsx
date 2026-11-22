import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import { useRoboticsStore } from './useRoboticsStore';
import type { RobotKind } from './types';

let focusRequested=false;
const focusRobot=()=>{focusRequested=true;};

const colors: Record<RobotKind,string> = { inspection:'#59dec4', maintenance:'#f4b85c', drone:'#8bbaff', emergency:'#ff8095' };
const names: Record<RobotKind,string> = { inspection:'Inspection Rover', maintenance:'Maintenance Robot', drone:'Monitoring Drone', emergency:'Emergency Rover' };

function RobotModel({kind}:{kind:RobotKind}) {
  const model=useRef<THREE.Group>(null);
  useFrame((_,delta)=>{
    const s=useRoboticsStore.getState();
    if(s.status!=='RUNNING') return;
    model.current?.traverse(o=>{if(o.name==='propeller')o.rotation.y+=delta*32;});
  });
  const color=colors[kind];
  return <group ref={model}>
    {kind==='drone'?<>
      <mesh position={[0,.5,0]} castShadow><boxGeometry args={[.75,.28,.75]}/><meshStandardMaterial color={color} metalness={.35} roughness={.45}/></mesh>
      {([-1,1] as const).flatMap(x=>([-1,1] as const).map(z=><group key={`${x}:${z}`} position={[x*.8,.5,z*.8]}>
        <mesh position={[-x*.35,0,-z*.35]} rotation={[0,x*z*Math.PI/4,0]}><boxGeometry args={[.12,.1,1.1]}/><meshStandardMaterial color="#244656"/></mesh>
        <mesh><cylinderGeometry args={[.14,.14,.2,12]}/><meshStandardMaterial color="#213645"/></mesh>
        <mesh name="propeller" position={[0,.16,0]}><boxGeometry args={[.85,.025,.09]}/><meshStandardMaterial color="#d6e9f2"/></mesh>
        <mesh position={[0,-.24,0]}><boxGeometry args={[.07,.35,.07]}/><meshStandardMaterial color="#243c46"/></mesh>
      </group>))}
      <mesh position={[0,.28,.26]}><sphereGeometry args={[.12,12,8]}/><meshStandardMaterial color="#163746" emissive="#4bbdff" emissiveIntensity={.5}/></mesh>
    </>:<>
      <mesh position={[0,.56,0]} castShadow><boxGeometry args={[1.18,.42,1.75]}/><meshStandardMaterial color={color} metalness={.2} roughness={.5}/></mesh>
      <mesh position={[0,.82,-.08]} castShadow><boxGeometry args={[.91,.2,1.2]}/><meshStandardMaterial color="#e9efdc" roughness={.65}/></mesh>
      {([-1,1] as const).flatMap(x=>([-1,1] as const).map(z=><mesh key={`${x}:${z}`} position={[x*.65,.29,z*.58]} rotation={[0,0,Math.PI/2]} castShadow><cylinderGeometry args={[.29,.29,.2,14]}/><meshStandardMaterial color="#243644" roughness={.9}/></mesh>))}
      {[-.4,.4].map(x=><mesh key={x} position={[x,.59,.9]}><boxGeometry args={[.15,.1,.035]}/><meshStandardMaterial color="#efffff" emissive="#c9fff3" emissiveIntensity={1}/></mesh>)}
      {kind==='inspection'&&<><mesh position={[0,1.05,.12]}><cylinderGeometry args={[.05,.05,.4,8]}/><meshStandardMaterial color="#254652"/></mesh><mesh position={[0,1.3,.16]}><boxGeometry args={[.4,.22,.24]}/><meshStandardMaterial color="#294b58"/></mesh><mesh position={[.12,1.3,.3]}><sphereGeometry args={[.07,10,8]}/><meshStandardMaterial color="#71ffdf" emissive="#4dd6c4"/></mesh></>}
      {kind==='maintenance'&&<><mesh position={[0,1.14,-.2]} rotation={[.6,0,0]}><boxGeometry args={[.16,.7,.16]}/><meshStandardMaterial color="#d8a65d"/></mesh><mesh position={[0,1.35,.2]} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.12,.12,.65,10]}/><meshStandardMaterial color="#e4b874"/></mesh><mesh position={[0,1.35,.55]}><boxGeometry args={[.35,.09,.1]}/><meshStandardMaterial color="#253b45"/></mesh></>}
      {kind==='emergency'&&<><mesh position={[0,1.12,-.1]} castShadow><boxGeometry args={[.8,.4,.9]}/><meshStandardMaterial color="#f5ede0"/></mesh><mesh position={[0,1.33,-.1]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[.46,.15]}/><meshBasicMaterial color="#e86078"/></mesh><mesh position={[0,1.331,-.1]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[.15,.46]}/><meshBasicMaterial color="#e86078"/></mesh></>}
    </>}
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,.035,0]}><ringGeometry args={[1.25,1.36,36]}/><meshBasicMaterial color={color} transparent opacity={.8} side={THREE.DoubleSide} depthWrite={false}/></mesh>
    <Html position={[0,2.1,0]} center distanceFactor={45} zIndexRange={[3,0]} style={{pointerEvents:'none'}}><span className="robot-world-label">{names[kind]}</span></Html>
  </group>;
}

function AccessibleRoads() {
  const world=useRoboticsStore(s=>s.world);
  const geometry=useMemo(()=>{
    const positions:number[]=[];
    world?.nodes.forEach((n,i)=>n.edges.forEach(e=>{if(e.to<=i)return;const b=world.nodes[e.to];positions.push(n.x,world.terrain.getTerrainHeight(n.x,n.z)+.27,n.z,b.x,world.terrain.getTerrainHeight(b.x,b.z)+.27,b.z);}));
    return new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  },[world]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  return <lineSegments geometry={geometry}><lineBasicMaterial color="#62d7b5" transparent opacity={.7} depthWrite={false}/></lineSegments>;
}

export function RobotScene() {
  const root=useRef<THREE.Group>(null);
  const selected=useRoboticsStore(s=>s.selected);
  const world=useRoboticsStore(s=>s.world);
  const route=useRoboticsStore(s=>s.route);
  const path=useRoboticsStore(s=>s.path);
  const planning=useRoboticsStore(s=>s.planning);
  const {gl,camera,scene}=useThree();
  // Sole interpreter clock. Pose writes go directly to the scene to avoid rerendering the city.
  useFrame((frame,delta)=>{
    const s=useRoboticsStore.getState();s.tick(delta);
    if(focusRequested&&s.selected){
      const controls=frame.controls as unknown as {target:THREE.Vector3;update:()=>void}|undefined;
      if(controls?.target){frame.camera.position.set(s.position[0]+8,s.position[1]+42,s.position[2]+8);controls.target.set(s.position[0],s.position[1]+.6,s.position[2]);controls.update();focusRequested=false;}
    }
    const next=useRoboticsStore.getState();
    if(root.current){root.current.position.set(...next.position);root.current.rotation.y=next.heading;}
  });
  useEffect(()=>{
    if(selected&&world)focusRobot();
  },[selected,world]);
  useEffect(()=>{
    const canvas=gl.domElement;let down:{x:number;y:number;id:number}|null=null;
    const ray=new THREE.Raycaster(),point=new THREE.Vector2();
    const onDown=(e:PointerEvent)=>{if(e.button===0)down={x:e.clientX,y:e.clientY,id:e.pointerId};};
    const onUp=(e:PointerEvent)=>{
      const d=down;down=null;
      if(!d||d.id!==e.pointerId||Math.hypot(e.clientX-d.x,e.clientY-d.y)>6||!useRoboticsStore.getState().planning)return;
      const rect=canvas.getBoundingClientRect();point.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(point,camera);
      const hit=ray.intersectObjects(scene.children,true).find(h=>{
        if(!(h.object as THREE.Mesh).isMesh)return false;
        for(let o:THREE.Object3D|null=h.object;o;o=o.parent)if(o.name==='Robot workshop geometry')return false;
        return h.object.layers.isEnabled(0);
      });
      if(hit)useRoboticsStore.getState().addWaypoint(hit.point.x,hit.point.z);
    };
    const onCancel=()=>{down=null;};
    canvas.addEventListener('pointerdown',onDown);canvas.addEventListener('pointerup',onUp);canvas.addEventListener('pointercancel',onCancel);
    return()=>{canvas.removeEventListener('pointerdown',onDown);canvas.removeEventListener('pointerup',onUp);canvas.removeEventListener('pointercancel',onCancel);};
  },[gl,camera,scene]);
  const points=useMemo(()=>path.map(p=>[p[0],p[1]+.2,p[2]] as [number,number,number]),[path]);
  if(!selected||!world)return null;
  return <group name="Robot workshop geometry">
    {planning&&<AccessibleRoads/>}
    {points.length>1&&<Line points={points} color={colors[selected]} lineWidth={2} transparent opacity={.95}/>}
    {route.map((w,i)=><group key={w.id} position={w.position}>
      <mesh position={[0,.15,0]}><sphereGeometry args={[.45,12,8]}/><meshStandardMaterial color={colors[selected]} emissive={colors[selected]} emissiveIntensity={.4}/></mesh>
      <Html position={[0,1.2,0]} center zIndexRange={[3,0]} style={{pointerEvents:'none'}}><span className="robot-waypoint-label">{i+1}</span></Html>
    </group>)}
    <group position={world.start}><mesh rotation={[-Math.PI/2,0,0]} position={[0,.07,0]}><ringGeometry args={[1.6,1.9,32]}/><meshBasicMaterial color="#edf0c5" side={THREE.DoubleSide}/></mesh></group>
    <group ref={root}><RobotModel kind={selected}/></group>
  </group>;
}

export function RobotMapControls() {
  const selected=useRoboticsStore(s=>s.selected),planning=useRoboticsStore(s=>s.planning);
  const message=useRoboticsStore(s=>s.message);
  if(!selected)return null;
  return <div className="robot-map-controls">
    <button onClick={focusRobot}>⌖ Focus robot</button>
    {planning&&<div className="robot-plan-hint"><strong>Click the map to add waypoints</strong>Drag to orbit as usual. Green lines show accessible ground streets.<br/><small>{message||'Use the editor route list to reorder or remove points.'}</small><br/><button onClick={()=>useRoboticsStore.getState().setPlanning(false)}>Finish planning</button></div>}
  </div>;
}
