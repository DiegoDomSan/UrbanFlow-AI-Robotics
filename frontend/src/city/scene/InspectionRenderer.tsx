import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';

/** Context and infrastructure use separate depth buffers. Infrastructure keeps real
 * self-occlusion: the pipe shell correctly occludes its water and adjacent pipes.
 * This is an explicit inspection pass, not per-object depthTest=false painting. */
export function InspectionRenderer({inspect}:{inspect:boolean}) {
  const {gl,scene,raycaster}=useThree();
  const diagnostics=useMemo(()=>import.meta.env.DEV && new URLSearchParams(location.search).has('diagnostics'),[]);
  const stats=useRef({frames:0,seconds:0});
  useEffect(()=>{
    const autoReset=gl.info.autoReset, rayMask=raycaster.layers.mask;
    raycaster.layers.enable(1);
    gl.info.autoReset=false;
    return ()=>{gl.info.autoReset=autoReset;raycaster.layers.mask=rayMask;};
  },[gl,raycaster]);
  useFrame(({camera},delta)=>{
    const autoClear=gl.autoClear, mask=camera.layers.mask, background=scene.background;
    const shadowAuto=gl.shadowMap.autoUpdate;
    gl.info.reset();
    gl.autoClear=false;
    gl.clear(true,true,true);
    camera.layers.set(0);
    gl.render(scene,camera);
    if(inspect){
    gl.clearDepth();
    scene.background=null;
    gl.shadowMap.autoUpdate=false;
    camera.layers.set(1);
    gl.render(scene,camera);
    }
    scene.background=background;
    camera.layers.mask=mask;
    gl.shadowMap.autoUpdate=shadowAuto;
    gl.autoClear=autoClear;
    if(diagnostics) {
      stats.current.frames++;stats.current.seconds+=delta;
      if(stats.current.seconds>=5){
        console.info('UrbanFlow rendering',JSON.stringify({fps:Math.round(stats.current.frames/stats.current.seconds),calls:gl.info.render.calls,triangles:gl.info.render.triangles,geometries:gl.info.memory.geometries,textures:gl.info.memory.textures}));
        stats.current={frames:0,seconds:0};
      }
    }
  },1);
  return null;
}
