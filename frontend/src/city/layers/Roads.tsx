import { useEffect, useMemo } from "react";
import * as THREE from "three";

import type { GeoFeature, Position } from "../geo/geojsonTypes";

import { insideArea, toWorld } from "../geo/projection";
import { TERRAIN } from "../geo/constants";

interface RoadsProps {
  features: GeoFeature[];
  underground: boolean;
}

function roadWidth(type: string): number {
  const widths: Record<string, number> = {
    primary: 11,
    secondary: 9,
    tertiary: 8,
    residential: 6,
    living_street: 5,
    service: 4,
    pedestrian: 4,
    footway: 2,
    cycleway: 2,
  };

  return widths[type] ?? 5;
}

function createRoadGeometry(
  coordinates: Position[],
  width: number,
): THREE.BufferGeometry | null {
  // Convertimos las coordenadas GPS a metros locales.
  const points: THREE.Vector2[] = [];

  for (const coordinate of coordinates) {
    const [x, z] = toWorld(coordinate);
    const point = new THREE.Vector2(x, z);

    if (
      points.length === 0 ||
      point.distanceTo(points[points.length - 1]) > 0.05
    ) {
      points.push(point);
    }
  }

  if (points.length < 2) return null;

  // Filtramos las vías alejadas de nuestra área.
  if (!points.some((p) => insideArea(p.x, p.y))) {
    return null;
  }

  const halfWidth = width / 2;
  const vertices: number[] = [];
  const indices: number[] = [];

  const offsets: THREE.Vector2[] = [];

  for (let i = 0; i < points.length; i++) {
    const previous = points[Math.max(0, i - 1)];
    const current = points[i];
    const next = points[Math.min(points.length - 1, i + 1)];

    const incoming = current.clone().sub(previous);
    const outgoing = next.clone().sub(current);

    if (incoming.lengthSq() > 0) incoming.normalize();
    if (outgoing.lengthSq() > 0) outgoing.normalize();

    let direction: THREE.Vector2;

    if (i === 0) {
      direction = outgoing;
    } else if (i === points.length - 1) {
      direction = incoming;
    } else {
      direction = incoming.clone().add(outgoing);

      if (direction.lengthSq() < 0.000001) {
        direction = outgoing;
      }

      direction.normalize();
    }

    // Vector perpendicular al eje de la carretera.
    const normal = new THREE.Vector2(-direction.y, direction.x);

    // Unión tipo miter para evitar huecos en las curvas.
    let scale = halfWidth;

    if (i > 0 && i < points.length - 1) {
      const incomingNormal = new THREE.Vector2(-incoming.y, incoming.x);

      const denominator = normal.dot(incomingNormal);

      if (Math.abs(denominator) > 0.1) {
        scale = Math.min(halfWidth / Math.abs(denominator), halfWidth * 2.5);
      }
    }

    offsets.push(normal.multiplyScalar(scale));
  }

  // Dos vértices por punto: borde izquierdo y derecho.
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const offset = offsets[i];

    vertices.push(point.x + offset.x, TERRAIN.roadCenterY, point.y + offset.y);

    vertices.push(point.x - offset.x, TERRAIN.roadCenterY, point.y - offset.y);
  }

  for (let i = 0; i < points.length - 1; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;

    indices.push(a, b, c);
    indices.push(b, d, c);
  }

  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );

  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

export function Roads({ features, underground }: RoadsProps) {
  const roads = useMemo(() => {
    const result: THREE.BufferGeometry[] = [];

    for (const feature of features) {
      const highway = feature.properties?.highway;

      if (typeof highway !== "string" || !feature.geometry) {
        continue;
      }

      const geometry = feature.geometry;

      const lines =
        geometry.type === "LineString"
          ? [geometry.coordinates]
          : geometry.type === "MultiLineString"
            ? geometry.coordinates
            : [];

      const width = roadWidth(highway);

      for (const line of lines) {
        const roadGeometry = createRoadGeometry(line, width);

        if (roadGeometry) {
          result.push(roadGeometry);
        }
      }
    }

    return result;
  }, [features]);

  useEffect(() => {
    return () => {
      roads.forEach((geometry) => geometry.dispose());
    };
  }, [roads]);

  return (
    <group name="Paiporta Roads">
      {roads.map((geometry, index) => (
        <mesh key={index} geometry={geometry} receiveShadow>
          <meshStandardMaterial
            color={underground ? "#668da5" : "#263746"}
            transparent={underground}
            opacity={underground ? 0.18 : 1}
            roughness={0.95}
            depthWrite={!underground}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}
