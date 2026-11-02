import { useEffect, useMemo } from "react";
import * as THREE from "three";

import type { GeoFeature, Position } from "../geo/geojsonTypes";

import { toWorld } from "../geo/projection";
import { CITY_CONFIG, TERRAIN } from "../geo/constants";

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

// --------------------------------------------------
// 1. ROAD CLIPPING
// --------------------------------------------------

function getRoadClipLimit(width: number): number {
  const halfSize = CITY_CONFIG.sizeMeters / 2;

  // Maximum possible miter extension:
  // halfWidth * 2.5
  const safetyMargin = (width / 2) * 2.5 + 0.02;

  return halfSize - safetyMargin;
}

function clipSegment(
  a: THREE.Vector2,
  b: THREE.Vector2,
  limit: number,
): [THREE.Vector2, THREE.Vector2] | null {
  const dx = b.x - a.x;
  const dz = b.y - a.y;

  let t0 = 0;
  let t1 = 1;

  const p = [-dx, dx, -dz, dz];

  const q = [a.x + limit, limit - a.x, a.y + limit, limit - a.y];

  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-10) {
      if (q[i] < 0) return null;
      continue;
    }

    const t = q[i] / p[i];

    if (p[i] < 0) {
      t0 = Math.max(t0, t);
    } else {
      t1 = Math.min(t1, t);
    }

    if (t0 > t1) return null;
  }

  return [
    new THREE.Vector2(a.x + t0 * dx, a.y + t0 * dz),
    new THREE.Vector2(a.x + t1 * dx, a.y + t1 * dz),
  ];
}

function clipPolyline(
  points: THREE.Vector2[],
  width: number,
): THREE.Vector2[][] {
  if (points.length < 2) return [];

  const limit = getRoadClipLimit(width);
  const result: THREE.Vector2[][] = [];

  let current: THREE.Vector2[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const clipped = clipSegment(points[i], points[i + 1], limit);

    if (!clipped) {
      if (current.length >= 2) {
        result.push(current);
      }

      current = [];
      continue;
    }

    const [start, end] = clipped;
    const last = current[current.length - 1];

    if (last && last.distanceTo(start) < 0.001) {
      if (last.distanceTo(end) > 0.001) {
        current.push(end);
      }
    } else {
      if (current.length >= 2) {
        result.push(current);
      }

      current = [start, end];
    }
  }

  if (current.length >= 2) {
    result.push(current);
  }

  return result;
}

// --------------------------------------------------
// 2. ROAD MESH GENERATION
// --------------------------------------------------

function createRoadGeometryFromPoints(
  points: THREE.Vector2[],
  width: number,
): THREE.BufferGeometry | null {
  if (points.length < 2) return null;

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
      direction = outgoing.clone();
    } else if (i === points.length - 1) {
      direction = incoming.clone();
    } else {
      direction = incoming.clone().add(outgoing);

      if (direction.lengthSq() < 0.000001) {
        direction = outgoing.clone();
      }

      direction.normalize();
    }

    // Perpendicular direction.
    const normal = new THREE.Vector2(-direction.y, direction.x);

    // Miter joint for smoother road curves.
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

  // Two vertices per point.
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const offset = offsets[i];

    vertices.push(point.x + offset.x, TERRAIN.roadCenterY, point.y + offset.y);

    vertices.push(point.x - offset.x, TERRAIN.roadCenterY, point.y - offset.y);
  }

  // Road surface triangles.
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

// --------------------------------------------------
// 3. COMPLETE ROAD GEOMETRY
// --------------------------------------------------

function createRoadGeometry(
  coordinates: Position[],
  width: number,
): THREE.BufferGeometry[] {
  // Convert GPS coordinates into local meters.
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

  if (points.length < 2) return [];

  // Clip road centerline against city boundaries.
  const clippedLines = clipPolyline(points, width);

  const geometries: THREE.BufferGeometry[] = [];

  for (const line of clippedLines) {
    const geometry = createRoadGeometryFromPoints(line, width);

    if (geometry) {
      geometries.push(geometry);
    }
  }

  return geometries;
}

// --------------------------------------------------
// 4. ROADS COMPONENT
// --------------------------------------------------

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
        const roadGeometries = createRoadGeometry(line, width);

        result.push(...roadGeometries);
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
