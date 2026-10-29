import { useEffect, useMemo } from "react";
import * as THREE from "three";

import type { GeoFeature, Position } from "../geo/geojsonTypes";

import { createPolygonShape } from "../geo/geometry";

interface WaterwaysProps {
  features: GeoFeature[];
  underground: boolean;
}

const WATER_Y = 0.085;

function createWaterGeometry(rings: Position[][]): THREE.ShapeGeometry | null {
  const shape = createPolygonShape(rings);

  if (!shape) return null;

  const geometry = new THREE.ShapeGeometry(shape);

  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, WATER_Y, 0);

  return geometry;
}

export function Waterways({ features, underground }: WaterwaysProps) {
  const geometries = useMemo(() => {
    const result: THREE.ShapeGeometry[] = [];

    for (const feature of features) {
      const geometry = feature.geometry;
      const properties = feature.properties ?? {};

      if (!geometry) continue;

      const isWater =
        properties.natural === "water" || properties.waterway === "riverbank";

      if (!isWater) continue;

      if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
        continue;
      }

      const polygons =
        geometry.type === "Polygon"
          ? [geometry.coordinates]
          : geometry.coordinates;

      for (const polygon of polygons) {
        const waterGeometry = createWaterGeometry(polygon);

        if (waterGeometry) {
          result.push(waterGeometry);
        }
      }
    }

    return result;
  }, [features]);

  useEffect(() => {
    return () => {
      geometries.forEach((geometry) => geometry.dispose());
    };
  }, [geometries]);

  if (underground) return null;

  return (
    <group name="OSM Waterways">
      {geometries.map((geometry, index) => (
        <mesh key={index} geometry={geometry}>
          <meshStandardMaterial
            color="#368dad"
            roughness={0.65}
            metalness={0}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

/*
 * TODO — UrbanFlow AI: Waterways
 *
 * Water surfaces are rendered using the original polygon
 * geometries provided by OpenStreetMap.
 *
 * No artificial river width, riverbed depth, or water level
 * is generated.
 *
 * Future improvements:
 * - Implement the real channel geometry using elevation data.
 * - Connect water levels to the flood simulation.
 * - Distinguish dry riverbeds from actual water surfaces.
 * - Clip geometries to the digital twin boundaries.
 *
 * IMPORTANT:
 * The current visualization represents OSM water polygons,
 * not a validated hydraulic or terrain model.
 */
