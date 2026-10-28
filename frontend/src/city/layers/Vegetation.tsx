import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { GeoFeature, Position } from "../geo/geojsonTypes";

import { toWorld } from "../geo/projection";
import { CITY_CONFIG } from "../geo/constants";

interface VegetationProps {
  features: GeoFeature[];
  underground: boolean;
}

type Point2D = { x: number; z: number };

type Tree = Point2D & {
  height: number;
  crownRadius: number;
  color: number;
};

type PolygonArea = {
  outer: Point2D[];
  holes: Point2D[][];
};

const HALF_SIZE = CITY_CONFIG.sizeMeters / 2;
const MAX_TREES = 260;

function project(position: Position): Point2D {
  const [x, z] = toWorld(position);
  return { x, z };
}

function inBounds(p: Point2D): boolean {
  return Math.abs(p.x) <= HALF_SIZE - 3 && Math.abs(p.z) <= HALF_SIZE - 3;
}

function pointInRing(point: Point2D, ring: Point2D[]): boolean {
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];

    const intersects =
      a.z > point.z !== b.z > point.z &&
      point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x;

    if (intersects) inside = !inside;
  }

  return inside;
}

function pointInPolygon(point: Point2D, polygon: PolygonArea): boolean {
  if (!pointInRing(point, polygon.outer)) {
    return false;
  }

  return !polygon.holes.some((hole) => pointInRing(point, hole));
}

function getPolygons(feature: GeoFeature): PolygonArea[] {
  const geometry = feature.geometry;

  if (!geometry) return [];

  const coordinates =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];

  return coordinates
    .map((polygon) => ({
      outer: polygon[0]?.map(project) ?? [],
      holes: polygon.slice(1).map((ring) => ring.map(project)),
    }))
    .filter((polygon) => polygon.outer.length >= 3);
}

function isGreenArea(properties: Record<string, unknown>): boolean {
  return (
    properties.leisure === "park" ||
    properties.leisure === "garden" ||
    properties.landuse === "grass" ||
    properties.landuse === "forest" ||
    properties.natural === "wood"
  );
}

function distanceToSegment(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;

  if (lengthSquared === 0) {
    return Math.hypot(p.x - a.x, p.z - a.z);
  }

  const t = THREE.MathUtils.clamp(
    ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSquared,
    0,
    1,
  );

  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function generateTrees(features: GeoFeature[]): Tree[] {
  const trees: Tree[] = [];
  const buildings: PolygonArea[] = [];
  const greenAreas: PolygonArea[] = [];

  const roadSegments: {
    a: Point2D;
    b: Point2D;
    clearance: number;
  }[] = [];

  // Collect buildings, roads and green areas first.
  for (const feature of features) {
    const properties = feature.properties ?? {};
    const geometry = feature.geometry;

    if (!geometry) continue;

    if (properties.building) {
      buildings.push(...getPolygons(feature));
    }

    if (isGreenArea(properties)) {
      greenAreas.push(...getPolygons(feature));
    }

    if (typeof properties.highway === "string") {
      const lines: Position[][] =
        geometry.type === "LineString"
          ? [geometry.coordinates]
          : geometry.type === "MultiLineString"
            ? geometry.coordinates
            : [];

      const clearance = ["primary", "secondary", "tertiary"].includes(
        properties.highway,
      )
        ? 7
        : 4;

      for (const line of lines) {
        for (let i = 1; i < line.length; i++) {
          roadSegments.push({
            a: project(line[i - 1]),
            b: project(line[i]),
            clearance,
          });
        }
      }
    }
  }

  const random = seededRandom(20261028);

  function addTree(point: Point2D): void {
    if (trees.length >= MAX_TREES) return;
    if (!inBounds(point)) return;

    if (buildings.some((polygon) => pointInPolygon(point, polygon))) {
      return;
    }

    if (
      roadSegments.some(
        (road) => distanceToSegment(point, road.a, road.b) < road.clearance,
      )
    ) {
      return;
    }

    if (
      trees.some((tree) => Math.hypot(tree.x - point.x, tree.z - point.z) < 6)
    ) {
      return;
    }

    const height = 7 + random() * 5;

    trees.push({
      ...point,
      height,
      crownRadius: 2.4 + random() * 1.4,
      color: Math.floor(random() * 4),
    });
  }

  // 1. Real OSM tree positions, where available.
  for (const feature of features) {
    const geometry = feature.geometry;
    if (!geometry) continue;

    if (feature.properties?.natural === "tree") {
      if (geometry.type === "Point") {
        addTree(project(geometry.coordinates));
      } else if (geometry.type === "MultiPoint") {
        for (const point of geometry.coordinates) {
          addTree(project(point));
        }
      }
    }

    // Trees spaced along mapped tree rows.
    if (feature.properties?.natural === "tree_row") {
      const lines: Position[][] =
        geometry.type === "LineString"
          ? [geometry.coordinates]
          : geometry.type === "MultiLineString"
            ? geometry.coordinates
            : [];

      for (const line of lines) {
        for (let i = 1; i < line.length; i++) {
          const a = project(line[i - 1]);
          const b = project(line[i]);

          const distance = Math.hypot(b.x - a.x, b.z - a.z);

          const count = Math.floor(distance / 11);

          for (let j = 0; j <= count; j++) {
            const t = count === 0 ? 0.5 : j / count;

            addTree({
              x: a.x + (b.x - a.x) * t,
              z: a.z + (b.z - a.z) * t,
            });
          }
        }
      }
    }
  }

  // 2. Decorative trees exclusively inside mapped green areas.
  // These positions are procedural, NOT surveyed tree locations.
  for (const area of greenAreas) {
    if (trees.length >= MAX_TREES) break;

    const xs = area.outer.map((p) => p.x);
    const zs = area.outer.map((p) => p.z);

    const minX = Math.max(-HALF_SIZE, Math.min(...xs));
    const maxX = Math.min(HALF_SIZE, Math.max(...xs));
    const minZ = Math.max(-HALF_SIZE, Math.min(...zs));
    const maxZ = Math.min(HALF_SIZE, Math.max(...zs));

    if (minX >= maxX || minZ >= maxZ) continue;

    const boxArea = (maxX - minX) * (maxZ - minZ);

    const targetCount = Math.min(35, Math.max(2, Math.floor(boxArea / 250)));

    let added = 0;

    for (
      let attempt = 0;
      attempt < targetCount * 50 && added < targetCount;
      attempt++
    ) {
      const point = {
        x: minX + random() * (maxX - minX),
        z: minZ + random() * (maxZ - minZ),
      };

      if (!pointInPolygon(point, area)) continue;

      const before = trees.length;
      addTree(point);

      if (trees.length > before) {
        added++;
      }
    }
  }

  return trees;
}

export function Vegetation({ features, underground }: VegetationProps) {
  const trees = useMemo(() => generateTrees(features), [features]);

  const trunksRef = useRef<THREE.InstancedMesh>(null);
  const crownsRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    const trunks = trunksRef.current;
    const crowns = crownsRef.current;

    if (!trunks || !crowns) return;

    const object = new THREE.Object3D();

    const colors = ["#407b4e", "#508b55", "#376b46", "#659666"];

    trees.forEach((tree, index) => {
      const trunkHeight = tree.height * 0.55;

      object.position.set(tree.x, trunkHeight / 2, tree.z);

      object.rotation.set(0, 0, 0);
      object.scale.set(1, trunkHeight, 1);
      object.updateMatrix();

      trunks.setMatrixAt(index, object.matrix);

      object.position.set(
        tree.x,
        trunkHeight + tree.crownRadius * 0.45,
        tree.z,
      );

      object.scale.set(
        tree.crownRadius,
        tree.crownRadius * 1.05,
        tree.crownRadius,
      );

      object.updateMatrix();

      crowns.setMatrixAt(index, object.matrix);

      crowns.setColorAt(index, new THREE.Color(colors[tree.color]));
    });

    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;

    if (crowns.instanceColor) {
      crowns.instanceColor.needsUpdate = true;
    }

    trunks.computeBoundingSphere();
    crowns.computeBoundingSphere();
  }, [trees]);

  if (underground || trees.length === 0) {
    return null;
  }

  return (
    <group name="Paiporta Vegetation">
      <instancedMesh
        ref={trunksRef}
        args={[undefined, undefined, trees.length]}
      >
        <cylinderGeometry args={[0.22, 0.32, 1, 6]} />
        <meshStandardMaterial color="#74543c" roughness={1} />
      </instancedMesh>

      <instancedMesh
        ref={crownsRef}
        args={[undefined, undefined, trees.length]}
      >
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color="#ffffff" roughness={0.95} flatShading />
      </instancedMesh>
    </group>
  );
}

/*
 * TODO — UrbanFlow AI: Vegetation
 *
 * Individual natural=tree locations are read from OSM.
 * Natural=tree_row lines are sampled approximately.
 * Additional decorative trees are generated only within
 * OSM-tagged green areas.
 *
 * Procedural tree positions, species and dimensions are
 * illustrative and must not be treated as surveyed data.
 *
 * Future improvements:
 * - Species-specific models.
 * - Accurate OSM tree attributes.
 * - Verified vegetation datasets.
 * - Terrain elevation support.
 */
