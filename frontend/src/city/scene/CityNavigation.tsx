import { useEffect, useMemo, useRef, type ElementRef } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useCityStore } from '../../stores/useCityStore';
import type { DrainageNetworkData } from '../drainage/types';

export function CityNavigation({ network }: { network: DrainageNetworkData }) {
  const controls = useRef<ElementRef<typeof OrbitControls>>(null);
  const {camera,size,gl} = useThree();
  const view = useCityStore(s=>s.cameraView);
  const revision = useCityStore(s=>s.cameraRevision);
  const focus = useCityStore(s=>s.focusPoint);
  const center = useMemo(() => {
    const xs=network.nodes.map(n=>n.x),zs=network.nodes.map(n=>n.z);
    return [(Math.min(...xs)+Math.max(...xs))/2,-2,(Math.min(...zs)+Math.max(...zs))/2] as const;
  },[network]);
  useEffect(() => {
    const target=focus ?? (view==='underground'?center:[0,-1,0]);
    const offsets = {isometric:[510,440,510],top:[0,670,0.1],section:[460,48,400],underground:[365,465,365]};
    const offset=focus?[36,30,36]:offsets[view];
    const fit=focus?1:Math.max(1,size.height/size.width*1.05);
    camera.position.set(target[0]+offset[0]*fit,target[1]+offset[1]*fit,target[2]+offset[2]*fit);
    controls.current?.target.set(target[0],target[1],target[2]);
    controls.current?.update();
  },[camera,view,revision,focus,center,size.width,size.height]);
  useEffect(()=>{
    // Keyboard panning is scoped to the focused canvas; sliders retain their arrow keys.
    const element=gl.domElement,control=controls.current;
    element.tabIndex=0;
    element.setAttribute('aria-label','3D city. Drag to orbit, scroll to zoom, right-drag or use arrow keys to pan.');
    control?.listenToKeyEvents(element);
    const focusCanvas=()=>element.focus({preventScroll:true});
    element.addEventListener('pointerdown',focusCanvas);
    return ()=>{control?.stopListenToKeyEvents();element.removeEventListener('pointerdown',focusCanvas);};
  },[gl]);
  return <OrbitControls ref={controls} makeDefault enableRotate enableZoom enablePan enableDamping
    dampingFactor={.08} rotateSpeed={.7} zoomSpeed={1} panSpeed={.8} screenSpacePanning
    minDistance={5} maxDistance={1800} minPolarAngle={0} maxPolarAngle={Math.PI} />;
}
