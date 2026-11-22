import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { TerrainModel } from "../terrain/terrainHeight";
import polygonClipping from "polygon-clipping";

import type { GeoFeature, Position } from "../geo/geojsonTypes";

import { toWorld } from "../geo/projection";
import { CITY_CONFIG, TERRAIN } from "../geo/constants";

// ============================================================
// URBANFLOW AI — LAND COVER V3
// OSM-based terrain surfaces with geometric clipping.
// ============================================================

interface LandCoverProps {
  features: GeoFeature[];
  underground: boolean;
  terrain: TerrainModel;
}

type LandType =
  | "park"
  | "garden"
  | "playground"
  | "pitch"
  | "recreation"
  | "grass";

type Pair = [number, number];
type Ring = Pair[];
type Polygon = Ring[];

interface LandSurface {
  geometry: THREE.BufferGeometry;
  type: LandType;
}

// Keep the original, proven land-cover classification.
const LAND_COLORS: Record<LandType, string> = {
  park: "#658f65",
  garden: "#54865b",
  playground: "#c5a575",
  pitch: "#568b73",
  recreation: "#7a9e70",
  grass: "#87a77b",
};

const HALF_SIZE = CITY_CONFIG.sizeMeters / 2;

// LandCover must remain below the road surfaces.
const SURFACE_Y = TERRAIN.landCoverY;

// Square representing our 500m x 500m digital twin.
const CLIP_BOUNDARY: Polygon = [
  [
    [-HALF_SIZE, -HALF_SIZE],
    [HALF_SIZE, -HALF_SIZE],
    [HALF_SIZE, HALF_SIZE],
    [-HALF_SIZE, HALF_SIZE],
    [-HALF_SIZE, -HALF_SIZE],
  ],
];

// ============================================================
// 1. OSM CLASSIFICATION
// ============================================================

function classifyLand(properties: Record<string, unknown>): LandType | null {
  const leisure = properties.leisure;
  const landuse = properties.landuse;
  const natural = properties.natural;

  // Water is handled by the terrain-clipped water layer.
  // Never interpret water features as land cover.
  if (
    natural === "water" ||
    properties.water !== undefined ||
    properties.waterway !== undefined
  ) {
    return null;
  }

  if (leisure === "park") return "park";
  if (leisure === "garden") return "garden";
  if (leisure === "playground") return "playground";
  if (leisure === "pitch") return "pitch";

  if (landuse === "recreation_ground") {
    return "recreation";
  }

  if (landuse === "grass" || landuse === "greenfield") {
    return "grass";
  }

  // IMPORTANT:
  // Residential, industrial and commercial land-use polygons
  // describe large geographic zones, not physical pavement.
  // Rendering them would visually cover streets and city blocks.
  return null;
}

// ============================================================
// 2. COORDINATE CONVERSION
// ============================================================

function toPlanarPoint(position: Position): Pair | null {
  const [x, z] = toWorld(position);

  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return null;
  }

  // ShapeGeometry uses XY.
  // rotateX(-PI/2) later converts Y into world Z.
  return [x, -z];
}

function convertRing(coordinates: Position[]): Ring {
  const result: Ring = [];

  for (const coordinate of coordinates) {
    const point = toPlanarPoint(coordinate);

    if (!point) continue;

    const previous = result[result.length - 1];

    // Remove consecutive duplicate coordinates.
    if (
      previous &&
      Math.abs(previous[0] - point[0]) < 0.000001 &&
      Math.abs(previous[1] - point[1]) < 0.000001
    ) {
      continue;
    }

    result.push(point);
  }

  return result;
}

function convertPolygon(coordinates: Position[][]): Polygon | null {
  const rings = coordinates.map(convertRing).filter((ring) => ring.length >= 3);

  if (rings.length === 0) return null;

  return rings;
}

// ============================================================
// 3. QUICK BOUNDING-BOX REJECTION
// ============================================================

function intersectsStudyArea(polygon: Polygon): boolean {
  const outer = polygon[0];

  if (!outer || outer.length < 3) return false;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const [x, y] of outer) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  return !(
    maxX < -HALF_SIZE ||
    minX > HALF_SIZE ||
    maxY < -HALF_SIZE ||
    minY > HALF_SIZE
  );
}

// ============================================================
// 4. GEOMETRIC CLIPPING
// ============================================================

function clipPolygon(polygon: Polygon): Polygon[] {
  if (!intersectsStudyArea(polygon)) {
    return [];
  }

  try {
    // True polygon intersection.
    // Unlike bounding-box filtering, this removes every part
    // outside the city and preserves holes and disconnected parts.
    return polygonClipping.intersection(polygon, CLIP_BOUNDARY);
  } catch (error) {
    // Skip malformed geometry rather than breaking the scene.
    console.warn("[UrbanFlow] Invalid land-cover polygon skipped:", error);

    return [];
  }
}

// ============================================================
// 5. THREE.JS GEOMETRY
// ============================================================

function makePathPoints(ring: Ring): THREE.Vector2[] {
  const points = ring.map(([x, y]) => new THREE.Vector2(x, y));

  // Remove final duplicate used to close GeoJSON rings.
  if (
    points.length > 1 &&
    points[0].distanceTo(points[points.length - 1]) < 0.000001
  ) {
    points.pop();
  }

  return points;
}

function createSurfaceGeometry(polygon: Polygon): THREE.ShapeGeometry | null {
  const outerPoints = makePathPoints(polygon[0]);

  if (outerPoints.length < 3) return null;

  // Three.js Shape orientation.
  if (!THREE.ShapeUtils.isClockWise(outerPoints)) {
    outerPoints.reverse();
  }

  const shape = new THREE.Shape(outerPoints);

  for (const ring of polygon.slice(1)) {
    const holePoints = makePathPoints(ring);

    if (holePoints.length < 3) continue;

    if (THREE.ShapeUtils.isClockWise(holePoints)) {
      holePoints.reverse();
    }

    shape.holes.push(new THREE.Path(holePoints));
  }

  const geometry = new THREE.ShapeGeometry(shape);

  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, SURFACE_Y, 0);

  geometry.computeBoundingBox();

  return geometry;
}

// Clip a convex surface fragment to a terrain triangle. Unlike simply elevating
// polygon corners, this preserves the real excavation even under large parks.
function clipConvex(subject: Pair[], boundary: Pair[]): Pair[] {
  let output = subject;
  for (let edge = 0; edge < boundary.length; edge++) {
    const a = boundary[edge], b = boundary[(edge + 1) % boundary.length];
    const input = output;
    output = [];
    if (!input.length) break;
    const side = (p: Pair) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    for (let i = 0; i < input.length; i++) {
      const p = input[i], q = input[(i + 1) % input.length];
      const sp = side(p), sq = side(q), ip = sp >= -1e-9, iq = sq >= -1e-9;
      if (ip) output.push(p);
      if (ip !== iq) {
        const t = sp / (sp - sq);
        output.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return output;
}

export function conformSurfaceGeometry(source: THREE.BufferGeometry, terrain: TerrainModel): THREE.BufferGeometry {
  const { divisions, step } = terrain.sampleGrid();
  const p = source.getAttribute("position"), index = source.index;
  const vertices: number[] = [];
  const point = (i: number): Pair => [p.getX(i), p.getZ(i)];
  function emit(triangle: Pair[]) {
    // Bound each candidate region before grid clipping to avoid N² work on large triangles.
    const lengths = triangle.map((a, i) => Math.hypot(a[0] - triangle[(i + 1) % 3][0], a[1] - triangle[(i + 1) % 3][1]));
    const longest = Math.max(...lengths), edge = lengths.indexOf(longest);
    if (longest > 8) {
      const a = triangle[edge], b = triangle[(edge + 1) % 3], c = triangle[(edge + 2) % 3];
      const m: Pair = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      emit([a, m, c]); emit([m, b, c]); return;
    }
    const xs = triangle.map((v) => v[0]), zs = triangle.map((v) => v[1]);
    const minX = Math.max(0, Math.floor((Math.min(...xs) + HALF_SIZE) / step));
    const maxX = Math.min(divisions - 1, Math.floor((Math.max(...xs) + HALF_SIZE) / step));
    const minZ = Math.max(0, Math.floor((Math.min(...zs) + HALF_SIZE) / step));
    const maxZ = Math.min(divisions - 1, Math.floor((Math.max(...zs) + HALF_SIZE) / step));
    for (let iz = minZ; iz <= maxZ; iz++) for (let ix = minX; ix <= maxX; ix++) {
      const x = -HALF_SIZE + ix * step, z = -HALF_SIZE + iz * step;
      const a: Pair = [x, z], b: Pair = [x + step, z], c: Pair = [x, z + step], d: Pair = [x + step, z + step];
      for (const cell of [[a, b, c], [b, d, c]]) {
        const clipped = clipConvex(triangle, cell);
        for (let j = 1; j < clipped.length - 1; j++) {
          const points = [clipped[0], clipped[j], clipped[j + 1]];
          const area = (points[1][0] - points[0][0]) * (points[2][1] - points[0][1]) - (points[1][1] - points[0][1]) * (points[2][0] - points[0][0]);
          if (Math.abs(area) < 1e-9) continue;
          if (area > 0) points.reverse(); // XZ winding has upward normals when clockwise.
          for (const [vx, vz] of points) vertices.push(vx, terrain.getTerrainHeight(vx, vz) + 0.025, vz);
        }
      }
    }
  }
  for (let i = 0; i < (index?.count ?? p.count); i += 3) {
    emit([point(index ? index.getX(i) : i), point(index ? index.getX(i + 1) : i + 1), point(index ? index.getX(i + 2) : i + 2)]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// ============================================================
// 6. REACT COMPONENT
// ============================================================

export function LandCover({ features, underground, terrain }: LandCoverProps) {
  const surfaces = useMemo<LandSurface[]>(() => {
    const result: LandSurface[] = [];

    for (const feature of features) {
      const geometry = feature.geometry;
      if (!geometry) continue;

      const type = classifyLand(feature.properties ?? {});

      if (!type) continue;

      if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
        continue;
      }

      const polygons =
        geometry.type === "Polygon"
          ? [geometry.coordinates]
          : geometry.coordinates;

      for (const coordinates of polygons) {
        const polygon = convertPolygon(coordinates);

        if (!polygon) continue;

        const clippedPolygons = clipPolygon(polygon);

        for (const clipped of clippedPolygons) {
          const surfaceGeometry = createSurfaceGeometry(clipped);

          if (!surfaceGeometry) continue;

          const conformed = conformSurfaceGeometry(surfaceGeometry, terrain);
          surfaceGeometry.dispose();
          result.push({ geometry: conformed, type });
        }
      }
    }

    const merged: LandSurface[] = [];
    for (const type of Object.keys(LAND_COLORS) as LandType[]) {
      const parts = result.filter((surface) => surface.type === type).map((surface) => surface.geometry);
      if (!parts.length) continue;
      const geometry = mergeGeometries(parts);
      parts.forEach((part) => part.dispose());
      if (geometry) merged.push({ type, geometry });
    }
    return merged;
  }, [features, terrain]);

  useEffect(() => {
    return () => {
      for (const surface of surfaces) {
        surface.geometry.dispose();
      }
    };
  }, [surfaces]);

  return (
    <group name="Paiporta Land Cover V3">
      {surfaces.map((surface, index) => (
        <mesh key={index} geometry={surface.geometry} receiveShadow>
          <meshStandardMaterial
            color={LAND_COLORS[surface.type]}
            roughness={1}
            metalness={0}
            side={THREE.DoubleSide}
            transparent={underground}
            opacity={underground ? 0.12 : 1}
            depthWrite={!underground}
          />
        </mesh>
      ))}
    </group>
  );
}

/*
 * TODO — URBANFLOW AI: LAND COVER
 *
 * Source:
 * OpenStreetMap GeoJSON, projected to local metric coordinates.
 *
 * Implemented:
 * - Physical surface classification.
 * - Polygon and MultiPolygon support.
 * - Real geometric clipping to the 500m study area.
 * - Preservation of polygon holes.
 * - Explicit exclusion of water and broad urban land-use zones.
 *
 * Future work:
 * - Resolve overlapping OSM surface polygons where necessary.
 * - Add surface textures and pedestrian details.
 * - Render verified OSM vegetation separately.
 * - Replace synthetic terrain with a surveyed elevation model.
 *
 * No land-cover geometry is invented by this component.
 */
