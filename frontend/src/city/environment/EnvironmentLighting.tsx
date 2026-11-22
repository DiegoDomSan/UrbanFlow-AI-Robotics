import { memo, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import type { Light } from 'three';
import { ENVIRONMENT_CONFIG } from './environmentConfig';

const lightLayers = (light: Light | null) => { light?.layers.enable(1); };

/** Environment changes never mutate camera, controls, selection or simulation data. */
export const EnvironmentLighting = memo(function EnvironmentLighting({night, underground}: {night: boolean; underground: boolean}) {
  const gl = useThree(state => state.gl);
  const environment = night ? ENVIRONMENT_CONFIG.night : ENVIRONMENT_CONFIG.day;
  useEffect(() => {
    const previous = gl.toneMappingExposure;
    gl.toneMappingExposure = environment.exposure;
    return () => { gl.toneMappingExposure = previous; };
  }, [gl, environment.exposure]);
  return <>
    <color attach="background" args={[underground ? (night ? ENVIRONMENT_CONFIG.underground.nightBackground : ENVIRONMENT_CONFIG.underground.dayBackground) : environment.background]} />
    <ambientLight ref={lightLayers} intensity={Math.max(environment.ambient, underground ? ENVIRONMENT_CONFIG.underground.ambientMinimum : 0)} />
    <hemisphereLight ref={lightLayers} args={[environment.sky, environment.ground, Math.max(environment.hemisphere, underground ? ENVIRONMENT_CONFIG.underground.hemisphereMinimum : 0)]} />
    <directionalLight ref={lightLayers} position={[-150, 300, 160]} color={environment.sun} intensity={environment.sunIntensity} castShadow={!underground}
      shadow-mapSize={[2048, 2048]} shadow-camera-left={-340} shadow-camera-right={340}
      shadow-camera-top={340} shadow-camera-bottom={-340} shadow-camera-near={1} shadow-camera-far={850}
      shadow-bias={-0.0002} shadow-normalBias={0.15} />
  </>;
});
