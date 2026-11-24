import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, LineBasicMaterial, type LineSegments } from 'three';
import { randomSource } from './model';
import { useStormStore } from './useStormStore';
/** Lightweight illustrative rain. It does not measure or simulate particle runoff. */
export function StormWeather(){
  const ref=useRef<LineSegments>(null);
  const positions=useMemo(()=>{const random=randomSource(713);const array=new Float32Array(360*6);for(let i=0;i<360;i++){const offset=i*6;array[offset]=(random()-.5)*480;array[offset+1]=random()*100+5;array[offset+2]=(random()-.5)*480;array[offset+3]=array[offset]+.7;array[offset+4]=array[offset+1]+5;array[offset+5]=array[offset+2];}return array;},[]);
  useFrame((_,delta)=>{
    const lines=ref.current;if(!lines)return;
    const s=useStormStore.getState();lines.visible=s.status==='RUNNING'&&s.storm.rainfallMMh>1;
    if(!lines.visible)return;
    (lines.material as LineBasicMaterial).opacity=Math.min(.65,.18+s.storm.rainfallMMh/200);
    for(let i=0;i<360;i++){const o=i*6;positions[o+1]-=Math.min(delta,.05)*90;if(positions[o+1]<1)positions[o+1]+=105;positions[o+4]=positions[o+1]+5;}
    (lines.geometry.getAttribute('position') as BufferAttribute).needsUpdate=true;
  });
  return <lineSegments ref={ref} visible={false} frustumCulled={false} raycast={()=>null}>
    <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions,3]}/></bufferGeometry>
    <lineBasicMaterial color="#b8e7f8" transparent opacity={.4} depthWrite={false}/>
  </lineSegments>;
}
