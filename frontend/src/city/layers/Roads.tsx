import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { TerrainModel } from "../terrain/terrainHeight";

import type { GeoFeature } from "../geo/geojsonTypes";
import { getRoadLines, roadSideOffsets, getRoadHeight } from "../geo/roadGeometry";

import { TERRAIN } from "../geo/constants";

interface RoadsProps {
  features: GeoFeature[];
  underground: boolean;
  terrain: TerrainModel;
}

export function createRoadGeometryFromPoints(
  points: THREE.Vector2[],
  width: number,
  terrain: TerrainModel,
  crossing: boolean,
): THREE.BufferGeometry | null {
  if (points.length < 2) return null;

  const vertices: number[] = [];
  const indices: number[] = [];
  const offsets = roadSideOffsets(points.map(p => [p.x, p.y]), width).map(p => new THREE.Vector2(...p));

  // Keep the original miter envelope; densify its interior so tracks follow banks.
  // Paved crossings keep the original deck elevation instead of diving into water.
  const columns = Math.max(1, Math.ceil(width / 2));
  let row = 0;
  for (let segment = 0; segment < points.length - 1; segment++) {
    const steps = Math.max(1, Math.ceil(points[segment].distanceTo(points[segment + 1]) / 2));
    for (let step = segment === 0 ? 0 : 1; step <= steps; step++) {
      const t = step / steps;
      const p = points[segment].clone().lerp(points[segment + 1], t);
      const offset = offsets[segment].clone().lerp(offsets[segment + 1], t);
      for (let column = 0; column <= columns; column++) {
        const across = 1 - 2 * column / columns;
        const x = p.x + offset.x * across, z = p.y + offset.y * across;
        const y = getRoadHeight(terrain, x, z, { bridge: crossing });
        vertices.push(x, y, z);
      }
      if (row > 0) {
        for (let column = 0; column < columns; column++) {
          const a = (row - 1) * (columns + 1) + column;
          const b = a + 1, c = a + columns + 1, d = c + 1;
          indices.push(a, c, b, b, c, d); // Y-up winding.
        }
      }
      row++;
    }
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

function mergeAndRelease(parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts);
  parts.forEach((geometry) => geometry.dispose());
  return merged;
}

function crossingDetails(points: THREE.Vector2[], width: number, terrain: TerrainModel): THREE.BufferGeometry[] {
  const result: THREE.BufferGeometry[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const count = Math.max(1, Math.ceil(a.distanceTo(b) / 2));
    for (let j = 0; j < count; j++) {
      const start = a.clone().lerp(b, j / count), end = a.clone().lerp(b, (j + 1) / count);
      const center = start.clone().add(end).multiplyScalar(0.5);
      if (terrain.getTerrainHeight(center.x, center.y) >= -0.22) continue;
      const length = start.distanceTo(end), dx = end.x - start.x, dz = end.y - start.y;
      const angle = -Math.atan2(dz, dx);
      // A solid deck + continuous low parapets, without pillars obstructing the channel.
      const deck = new THREE.BoxGeometry(length + 0.01, 0.32, width);
      deck.rotateY(angle);
      deck.translate(center.x, TERRAIN.roadCenterY - 0.18, center.y);
      result.push(deck);
      for (const side of [-1, 1]) {
        const rail = new THREE.BoxGeometry(length + 0.01, 0.65, 0.15);
        rail.rotateY(angle);
        rail.translate(center.x - dz / length * width / 2 * side,
          TERRAIN.roadCenterY + 0.325, center.y + dx / length * width / 2 * side);
        result.push(rail);
      }
    }
  }
  return result;
}

export function Roads({ features, underground, terrain }: RoadsProps) {
  const roads = useMemo(() => {
    const surfaces: THREE.BufferGeometry[] = [], paths: THREE.BufferGeometry[] = [], crossings: THREE.BufferGeometry[] = [];
    for (const road of getRoadLines(features)) {
      const points = road.points.map(p => new THREE.Vector2(...p));
      const surface = createRoadGeometryFromPoints(points, road.width, terrain, road.bridge);
      if (surface) (['track', 'path'].includes(road.highway) ? paths : surfaces).push(surface);
      if (road.bridge) crossings.push(...crossingDetails(points, road.width, terrain));
    }
    return { surface: mergeAndRelease(surfaces), paths: mergeAndRelease(paths), crossing: mergeAndRelease(crossings) };
  }, [features, terrain]);

  useEffect(() => () => {
    roads.surface?.dispose(); roads.paths?.dispose(); roads.crossing?.dispose();
  }, [roads]);

  return (
    <group name="Paiporta Roads">
      {roads.surface && <mesh geometry={roads.surface} receiveShadow={!underground}>
        <meshStandardMaterial key={underground ? "xray" : "solid"} color={underground ? "#668da5" : "#344654"}
          transparent={underground} opacity={underground ? 0.15 : 1}
          roughness={0.95} depthWrite={!underground} side={THREE.DoubleSide} />
      </mesh>}
      {roads.paths && <mesh geometry={roads.paths} receiveShadow={!underground}>
        <meshStandardMaterial key={underground ? "path-xray" : "path-solid"} color="#998b70" transparent={underground}
          opacity={underground ? 0.1 : 1} roughness={1} depthWrite={!underground} side={THREE.DoubleSide} />
      </mesh>}
      {roads.crossing && <mesh geometry={roads.crossing} castShadow={!underground} receiveShadow={!underground}>
        <meshStandardMaterial key={underground ? "xray" : "solid"} color="#a7b3b6" transparent={underground}
          opacity={underground ? 0.12 : 1} depthWrite={!underground} roughness={0.92} />
      </mesh>}
    </group>
  );
}
