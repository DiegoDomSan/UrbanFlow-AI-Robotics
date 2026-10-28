import * as THREE from "three";
import { CITY_CONFIG } from "./constants";
import type { Position } from "./geojsonTypes";

export function toWorld(coordinates: Position): [number, number] {
  const [lon, lat] = coordinates;

  const latRadians = THREE.MathUtils.degToRad(CITY_CONFIG.centerLat);

  const x =
    THREE.MathUtils.degToRad(lon - CITY_CONFIG.centerLon) *
    CITY_CONFIG.earthRadius *
    Math.cos(latRadians);

  const z =
    -THREE.MathUtils.degToRad(lat - CITY_CONFIG.centerLat) *
    CITY_CONFIG.earthRadius;

  return [x, z];
}

export function insideArea(x: number, z: number): boolean {
  const halfSize = CITY_CONFIG.sizeMeters / 2;

  return Math.abs(x) <= halfSize && Math.abs(z) <= halfSize;
}
