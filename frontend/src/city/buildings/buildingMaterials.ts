import * as THREE from 'three';
import { FACADE_CONFIG } from './buildingDetails';

/** Cohesive illustrative materials; OSM does not establish actual facade colors. */
export const BUILDING_PALETTE = [
  { wall: '#ded2ba', roof: '#a3927d' },
  { wall: '#d2c2ad', roof: '#8b8175' },
  { wall: '#e6ddc9', roof: '#b4a28d' },
  { wall: '#c49b83', roof: '#956e58' },
  { wall: '#ccae98', roof: '#ab8069' },
  { wall: '#bcc8c8', roof: '#899a9e' },
  { wall: '#e9e4d8', roof: '#b5b1a3' },
  { wall: '#d3cec3', roof: '#98958b' },
] as const;

export function buildingSeed(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return hash >>> 0;
}
export function getBuildingColors(id: string) {
  const seed = buildingSeed(id), palette = BUILDING_PALETTE[seed % BUILDING_PALETTE.length];
  return { wall: new THREE.Color(palette.wall), roof: new THREE.Color(palette.roof), seed: (seed % 4093) / 4093 };
}

/** One wall material for the whole city, including windows. Switching night only
 * changes uniforms; it does not change mesh geometry or allocate window objects. */
export function createFacadeMaterial() {
  const material = new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.84, metalness: 0.015, side: THREE.DoubleSide});
  const uniforms = { night: {value: 0}, details: {value: 1} };
  material.onBeforeCompile = shader => {
    shader.uniforms.uFacadeNight = uniforms.night;
    shader.uniforms.uFacadeDetails = uniforms.details;
    shader.vertexShader = `attribute vec2 facadeUV;
attribute vec4 facadeLayout;
attribute float facadeSeed;
varying vec2 vFacadeUV;
varying vec4 vFacadeLayout;
varying float vFacadeSeed;
${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>
vFacadeUV = facadeUV;
vFacadeLayout = facadeLayout;
vFacadeSeed = facadeSeed;`);
    shader.fragmentShader = `uniform float uFacadeNight;
uniform float uFacadeDetails;
varying vec2 vFacadeUV;
varying vec4 vFacadeLayout;
varying float vFacadeSeed;
float facadeRandom(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + vFacadeSeed * 517.9) * 43758.5453); }
${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
float facadeWindow = 0.0;
float facadeGlow = 0.0;
if (uFacadeDetails > 0.5 && vFacadeLayout.z > 0.5 && vFacadeLayout.w > 0.5) {
  float facadeCell = (vFacadeLayout.x - ${(FACADE_CONFIG.edgeMargin * 2).toFixed(2)}) / vFacadeLayout.z;
  float facadeColumn = floor((vFacadeUV.x - ${FACADE_CONFIG.edgeMargin.toFixed(2)}) / facadeCell);
  float facadeFloor = floor(vFacadeUV.y / ${FACADE_CONFIG.floorHeight.toFixed(2)});
  vec2 facadeCenter = vec2(${FACADE_CONFIG.edgeMargin.toFixed(2)} + (facadeColumn + 0.5) * facadeCell, (facadeFloor + 0.5) * ${FACADE_CONFIG.floorHeight.toFixed(2)});
  vec2 facadeOffset = abs(vFacadeUV - facadeCenter);
  vec2 facadeAA = max(fwidth(vFacadeUV) * 0.65, vec2(0.012));
  vec2 facadeFrame = vec2(${(FACADE_CONFIG.windowWidth / 2 + FACADE_CONFIG.frameWidth).toFixed(3)}, ${(FACADE_CONFIG.windowHeight / 2 + FACADE_CONFIG.frameWidth).toFixed(3)});
  float facadeValid = step(0.0, facadeColumn) * (1.0 - step(vFacadeLayout.z, facadeColumn)) * step(0.0, facadeFloor) * (1.0 - step(vFacadeLayout.w, facadeFloor));
  vec2 outerMask = 1.0 - smoothstep(facadeFrame - facadeAA, facadeFrame + facadeAA, facadeOffset);
  vec2 glassMask = 1.0 - smoothstep(facadeFrame - vec2(${FACADE_CONFIG.frameWidth.toFixed(2)}) - facadeAA, facadeFrame - vec2(${FACADE_CONFIG.frameWidth.toFixed(2)}) + facadeAA, facadeOffset);
  float facadeOuter = outerMask.x * outerMask.y * facadeValid;
  facadeWindow = glassMask.x * glassMask.y * facadeValid;
  facadeGlow = step(0.64, facadeRandom(vec2(facadeColumn, facadeFloor))) * facadeWindow * uFacadeNight;
  vec3 facadeGlass = mix(vec3(0.047, 0.085, 0.110), vec3(0.13, 0.20, 0.23), smoothstep(-0.5, 0.5, vFacadeUV.y - facadeCenter.y));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.60, facadeOuter);
  diffuseColor.rgb = mix(diffuseColor.rgb, facadeGlass, facadeWindow);
  // A narrow sill/floor band adds scale while retaining the original flat wall geometry.
  float facadeBand = 1.0 - smoothstep(0.035, 0.09 + facadeAA.y, abs(mod(vFacadeUV.y, ${FACADE_CONFIG.floorHeight.toFixed(2)}) - 0.10));
  diffuseColor.rgb *= 1.0 - 0.045 * facadeBand;
}
`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(1.0, 0.56, 0.20) * facadeGlow * 0.90;`);
  };
  material.customProgramCacheKey = () => 'urbanflow-facades-v2';
  return {material, uniforms};
}
