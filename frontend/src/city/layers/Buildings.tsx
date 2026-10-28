import { useEffect, useMemo } from "react";
import * as THREE from "three";

import type { GeoFeature } from "../geo/geojsonTypes";
import { toWorld, insideArea } from "../geo/projection";
import { createBuildingGeometry, createRoofGeometry } from "../geo/geometry";

type BuildingsProps = {
  features: GeoFeature[];
  underground: boolean;
};

function buildingHeight(props: Record<string, unknown>): number {
  const height = Number.parseFloat(String(props.height ?? ""));

  if (Number.isFinite(height) && height > 0) {
    return height;
  }

  const levels = Number.parseFloat(String(props["building:levels"] ?? ""));

  if (Number.isFinite(levels) && levels > 0) {
    return levels * 3.1;
  }

  // Estimación visual, no altura verificada.
  return 10;
}

export function Buildings({ features, underground }: BuildingsProps) {
  const buildings = useMemo(() => {
    const result: {
      geometry: THREE.ExtrudeGeometry;
      roofGeometry: THREE.BufferGeometry | null;
    }[] = [];

    for (const feature of features) {
      if (!feature.properties?.building || !feature.geometry) {
        continue;
      }

      const geometryType = feature.geometry;

      const polygons =
        geometryType.type === "Polygon"
          ? [geometryType.coordinates]
          : geometryType.type === "MultiPolygon"
            ? geometryType.coordinates
            : [];

      for (const polygon of polygons) {
        const outer = polygon[0];
        if (!outer?.length) continue;

        const points = outer.map(toWorld);

        const centerX =
          points.reduce((sum, point) => sum + point[0], 0) / points.length;

        const centerZ =
          points.reduce((sum, point) => sum + point[1], 0) / points.length;

        if (!insideArea(centerX, centerZ)) continue;

        const height = buildingHeight(feature.properties);
        const geometry = createBuildingGeometry(polygon, height);

        if (!geometry) continue;

        const roofGeometry = createRoofGeometry(polygon, height);

        result.push({ geometry, roofGeometry });
      }
    }

    return result;
  }, [features]);

  useEffect(() => {
    return () => {
      buildings.forEach((building) => {
        building.geometry.dispose();
        building.roofGeometry?.dispose();
      });
    };
  }, [buildings]);

  return (
    <group name="Paiporta Buildings">
      {buildings.map((building, index) => {
        const wallColor = underground ? "#5297bd" : "#173e64";
        const roofColor = underground ? "#5297bd" : "#32678d";
        const opacity = underground ? 0.2 : 1;

        return (
          <group key={index}>
            <mesh
              geometry={building.geometry}
              castShadow={!underground}
              receiveShadow={!underground}
              renderOrder={underground ? 2 : 0}
            >
              <meshBasicMaterial attach="material-0" visible={false} />

              <meshStandardMaterial
                attach="material-1"
                color={wallColor}
                transparent={underground}
                opacity={opacity}
                depthWrite={!underground}
                side={THREE.DoubleSide}
                roughness={0.82}
                metalness={0.04}
              />
            </mesh>

            {building.roofGeometry && (
              <mesh
                geometry={building.roofGeometry}
                castShadow={!underground}
                receiveShadow={!underground}
                renderOrder={underground ? 2 : 1}
              >
                <meshStandardMaterial
                  color={roofColor}
                  transparent={underground}
                  opacity={opacity}
                  depthWrite={!underground}
                  side={THREE.DoubleSide}
                  roughness={0.9}
                  metalness={0}
                />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}
