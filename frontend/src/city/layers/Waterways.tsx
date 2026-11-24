import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { TerrainModel } from '../terrain/terrainHeight';
import { buildWaterGeometry } from '../terrain/waterGeometry';

/** One lightweight material; animated highlights never move water beyond clipped banks. */
export function Waterways({ terrain, depth, underground }: { terrain: TerrainModel; depth: number; underground: boolean }) {
  const geometry = useMemo(() => buildWaterGeometry(terrain, depth), [terrain, depth]);
  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { time: { value: 0 }, opacity: { value: .78 } },
    vertexShader: `
      attribute float waterDepth;
      varying vec3 worldPosition;
      varying float depth;
      void main() {
        worldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        depth = waterDepth;
        gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
      }`,
    fragmentShader: `
      uniform float time;
      uniform float opacity;
      varying vec3 worldPosition;
      varying float depth;
      void main() {
        float calm = 1.0 / (1.0 + depth * .55);
        float wave = sin(worldPosition.x * .65 + worldPosition.z * .23 - time * .9) * sin(worldPosition.z * .88 + time * .55);
        vec3 base = mix(vec3(.12,.49,.48), vec3(.06,.27,.37), clamp(depth / 3.5, 0.0, 1.0));
        float shimmer = pow(max(0.0, wave), 8.0) * .16 * calm;
        float edge = smoothstep(0.0, .12, depth);
        gl_FragColor = vec4(base + shimmer, opacity * mix(.45, 1.0, edge));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }), []);
  useEffect(() => { material.uniforms.opacity.value = underground ? .36 : .78; }, [material, underground]);
  useFrame((_, delta) => { material.uniforms.time.value += Math.min(delta, .05); });
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  if (depth <= 0) return null;
  return <mesh name="Mapped ravine · demonstration water" geometry={geometry} material={material} renderOrder={underground ? 4 : 1} />;
}
