import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { TerrainModel } from './terrainHeight';
import { buildTerrainGeometry } from './terrainGeometry';

export function Terrain({ terrain, underground, opacity = .12 }: { terrain: TerrainModel; underground: boolean; opacity?: number }) {
  const terrainOpacity = THREE.MathUtils.clamp(opacity, .05, .55);
  const geometry = useMemo(() => buildTerrainGeometry(terrain), [terrain]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh name="Solid terrain · synthetic elevations" geometry={geometry} receiveShadow={!underground} renderOrder={underground ? 3 : 0}>
    <meshStandardMaterial key={underground ? "top-xray" : "top-solid"} attach="material-0" vertexColors roughness={.98} transparent={underground} opacity={underground ? terrainOpacity : 1} depthWrite={!underground} side={THREE.FrontSide} />
    <meshStandardMaterial key={underground ? "side-xray" : "side-solid"} attach="material-1" vertexColors roughness={1} transparent={underground} opacity={underground ? Math.min(.6, terrainOpacity * 1.35) : 1} depthWrite={!underground} side={THREE.FrontSide} />
  </mesh>;
}
