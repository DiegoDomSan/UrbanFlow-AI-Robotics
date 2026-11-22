import { memo, useEffect, useMemo } from "react";
import * as THREE from "three";
import polygonClipping from "polygon-clipping";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { GeoFeature, Position } from "../geo/geojsonTypes";
import { toWorld } from "../geo/projection";
import { CITY_CONFIG } from "../geo/constants";
import { createBuildingGeometry, createRoofGeometry } from "../geo/geometry";
import type { TerrainModel } from "../terrain/terrainHeight";
import { createDetailedWallGeometry, setGeometryColor } from "../buildings/buildingDetails";
import { createFacadeMaterial, getBuildingColors } from "../buildings/buildingMaterials";

type BuildingsProps = { features: GeoFeature[]; underground: boolean; terrain: TerrainModel; night: boolean };

function buildingHeight(props: Record<string, unknown>): number {
  const height = Number.parseFloat(String(props.height ?? ""));
  if (Number.isFinite(height) && height > 0) return height;
  const levels = Number.parseFloat(String(props["building:levels"] ?? ""));
  if (Number.isFinite(levels) && levels > 0) return levels * 3.1;
  return 10; // Illustrative fallback; the GeoJSON is not a height survey.
}

const half = CITY_CONFIG.sizeMeters / 2;
const dLat = half / CITY_CONFIG.earthRadius * 180 / Math.PI;
const dLon = dLat / Math.cos(CITY_CONFIG.centerLat * Math.PI / 180);
const { centerLat: lat, centerLon: lon } = CITY_CONFIG;
const boundary: [number, number][][] = [[
  [lon - dLon, lat - dLat], [lon + dLon, lat - dLat],
  [lon + dLon, lat + dLat], [lon - dLon, lat + dLat], [lon - dLon, lat - dLat],
]];

export function clipBuildingPolygon(polygon: Position[][]): Position[][][] {
  // Clip footprints, including courtyard holes, rather than rejecting by centroid.
  return polygonClipping.intersection(polygon.map((ring) => ring.map((p) => [p[0], p[1]])), boundary);
}

function combine(parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!parts.length) return null;
  const combined = mergeGeometries(parts);
  parts.forEach((part) => part.dispose());
  return combined;
}

export function createBuildingBatches(features: GeoFeature[], terrain: TerrainModel) {
    const walls: THREE.BufferGeometry[] = [], roofs: THREE.BufferGeometry[] = [];
    for (const [featureIndex, feature] of features.entries()) {
      if (!feature.properties?.building || !feature.geometry) continue;
      const colors = getBuildingColors(String(feature.id ?? feature.properties["@id"] ?? featureIndex));
      const geometry = feature.geometry;
      const polygons = geometry.type === "Polygon" ? [geometry.coordinates]
        : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
      for (const original of polygons) {
        if (!original[0]?.length) continue;
        for (const polygon of clipBuildingPolygon(original)) {
          const points = polygon[0].map(toWorld);
          // Foundations use the shared surface. Terrain protects mapped footprints.
          const centerX = points.reduce((sum, p) => sum + p[0], 0) / points.length;
          const centerZ = points.reduce((sum, p) => sum + p[1], 0) / points.length;
          const base = terrain.getTerrainHeight(centerX, centerZ) + 0.05;
          const height = buildingHeight(feature.properties);
          const extrusion = createBuildingGeometry(polygon, height);
          if (!extrusion) continue;
          const wall = createDetailedWallGeometry(extrusion, colors.wall, colors.seed);
          wall.translate(0, base, 0);
          walls.push(wall);
          extrusion.dispose();
          const originalRoof = createRoofGeometry(polygon, height);
          if (originalRoof) {
            const roof = originalRoof.index ? originalRoof.toNonIndexed() : originalRoof.clone();
            roof.deleteAttribute("uv");
            roof.translate(0, base, 0);
            setGeometryColor(roof, colors.roof);
            roofs.push(roof);
            originalRoof.dispose();
          }
        }
      }
    }
    // Two draw calls for the whole building stock, retaining every footprint and hole.
    return { walls: combine(walls), roofs: combine(roofs) };
 }

export const Buildings = memo(function Buildings({ features, underground, terrain, night }: BuildingsProps) {
  const buildings = useMemo(() => createBuildingBatches(features, terrain), [features, terrain]);
  const facade = useMemo(createFacadeMaterial, []);
  const roofMaterial = useMemo(() => new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.94, side: THREE.DoubleSide}), []);
  useEffect(() => {
    facade.uniforms.night.value = night ? 1 : 0;
    facade.uniforms.details.value = underground ? 0 : 1;
    for (const material of [facade.material, roofMaterial]) {
      if (material.transparent !== underground) material.needsUpdate = true;
      material.transparent = underground;
      material.opacity = underground ? 0.075 : 1;
      material.depthWrite = !underground;
      material.color.set(underground ? '#9db5bc' : '#ffffff');
    }
  }, [facade, roofMaterial, night, underground]);
  useEffect(() => () => { buildings.walls?.dispose(); buildings.roofs?.dispose(); }, [buildings]);
  useEffect(() => () => { facade.material.dispose(); roofMaterial.dispose(); }, [facade, roofMaterial]);
  return <group name="Paiporta Buildings" dispose={null}>
    {buildings.walls && <mesh geometry={buildings.walls} material={facade.material} castShadow={!underground} receiveShadow={!underground} renderOrder={underground ? 2 : 0} />}
    {buildings.roofs && <mesh geometry={buildings.roofs} material={roofMaterial} castShadow={!underground} receiveShadow={!underground} renderOrder={underground ? 2 : 1} />}
  </group>;
});
