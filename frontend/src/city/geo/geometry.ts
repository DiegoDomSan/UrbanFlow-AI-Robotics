import * as THREE from "three";
import { toWorld } from "./projection";
import type { Position } from "./geojsonTypes";

export type PolygonCoordinates = Position[][];

export function createPolygonShape(
  polygon: PolygonCoordinates,
): THREE.Shape | null {
  const outer = polygon[0];

  if (!outer || outer.length < 4) return null;

  const cleanRing = (ring: Position[]): THREE.Vector2[] => {
    const points = ring.map((coordinate) => {
      const [x, z] = toWorld(coordinate);
      return new THREE.Vector2(x, -z);
    });

    if (
      points.length > 1 &&
      points[0].distanceTo(points[points.length - 1]) < 0.001
    ) {
      points.pop();
    }

    return points;
  };

  const outerPoints = cleanRing(outer);

  if (outerPoints.length < 3) return null;

  if (!THREE.ShapeUtils.isClockWise(outerPoints)) {
    outerPoints.reverse();
  }

  const shape = new THREE.Shape(outerPoints);

  for (const ring of polygon.slice(1)) {
    const holePoints = cleanRing(ring);

    if (holePoints.length < 3) continue;

    if (THREE.ShapeUtils.isClockWise(holePoints)) {
      holePoints.reverse();
    }

    shape.holes.push(new THREE.Path(holePoints));
  }

  return shape;
}

export function createBuildingGeometry(
  polygon: PolygonCoordinates,
  height: number,
): THREE.ExtrudeGeometry | null {
  const shape = createPolygonShape(polygon);
  if (!shape) return null;

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(height, 3),
    bevelEnabled: false,
    steps: 1,
    curveSegments: 1,
  });

  geometry.rotateX(-Math.PI / 2);

  return geometry;
}

export function createRoofGeometry(
  polygon: PolygonCoordinates,
  height: number,
): THREE.BufferGeometry | null {
  const shape = createPolygonShape(polygon);
  if (!shape) return null;

  const geometry = new THREE.ShapeGeometry(shape);

  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, Math.max(height, 3) + 0.01, 0);

  return geometry;
}
