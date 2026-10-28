import { useEffect, useMemo } from "react";
import * as THREE from "three";

type GeoFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: {
    type: string;
    coordinates: any;
  } | null;
};

type Props = {
  features: GeoFeature[];
  underground: boolean;
};

const CENTER_LAT = 39.428;
const CENTER_LON = -0.4184;
const EARTH_RADIUS = 6378137;
const MAP_SIZE = 500;

function toWorld(coord: number[]): [number, number] {
  const [lon, lat] = coord;

  const x =
    EARTH_RADIUS *
    THREE.MathUtils.degToRad(lon - CENTER_LON) *
    Math.cos(THREE.MathUtils.degToRad(CENTER_LAT));

  const z = -EARTH_RADIUS * THREE.MathUtils.degToRad(lat - CENTER_LAT);

  return [x, z];
}

function getLandColor(properties: Record<string, unknown>): string | null {
  const leisure = properties.leisure;
  const landuse = properties.landuse;

  if (leisure === "garden" || leisure === "park") {
    return "#658f65";
  }

  if (leisure === "playground") {
    return "#c5a575";
  }

  if (leisure === "pitch") {
    return "#568b73";
  }

  if (landuse === "recreation_ground") {
    return "#7a9e70";
  }

  if (landuse === "greenfield" || landuse === "grass") {
    return "#87a77b";
  }

  // No dibujamos residential encima del terreno:
  // podría cubrir otras capas.
  return null;
}

function createSurface(polygon: number[][][]): THREE.BufferGeometry | null {
  const outer = polygon[0];
  if (!outer || outer.length < 4) return null;

  const makeRing = (ring: number[][]) => {
    const points = ring.map((coord) => {
      const [x, z] = toWorld(coord);
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

  const outerPoints = makeRing(outer);
  if (outerPoints.length < 3) return null;

  if (!THREE.ShapeUtils.isClockWise(outerPoints)) {
    outerPoints.reverse();
  }

  const shape = new THREE.Shape(outerPoints);

  for (const ring of polygon.slice(1)) {
    const holePoints = makeRing(ring);
    if (holePoints.length < 3) continue;

    if (THREE.ShapeUtils.isClockWise(holePoints)) {
      holePoints.reverse();
    }

    shape.holes.push(new THREE.Path(holePoints));
  }

  const geometry = new THREE.ShapeGeometry(shape);

  geometry.rotateX(-Math.PI / 2);

  // Base del terreno: superficie superior en Y = -0.05.
  // Colocamos la capa ligeramente por encima.
  geometry.translate(0, -0.035, 0);

  return geometry;
}

export function LandCover({ features, underground }: Props) {
  const surfaces = useMemo(() => {
    const result: {
      geometry: THREE.BufferGeometry;
      color: string;
    }[] = [];

    for (const feature of features) {
      if (!feature.geometry) continue;

      const color = getLandColor(feature.properties);
      if (!color) continue;

      const polygons: number[][][][] =
        feature.geometry.type === "Polygon"
          ? [feature.geometry.coordinates]
          : feature.geometry.type === "MultiPolygon"
            ? feature.geometry.coordinates
            : [];

      for (const polygon of polygons) {
        const outer = polygon[0];
        if (!outer?.length) continue;

        // Filtramos polígonos completamente fuera
        // del área de 500 x 500 m.
        const bounds = outer.map(toWorld);
        const xs = bounds.map((p) => p[0]);
        const zs = bounds.map((p) => p[1]);

        if (
          Math.max(...xs) < -MAP_SIZE / 2 ||
          Math.min(...xs) > MAP_SIZE / 2 ||
          Math.max(...zs) < -MAP_SIZE / 2 ||
          Math.min(...zs) > MAP_SIZE / 2
        ) {
          continue;
        }

        const geometry = createSurface(polygon);
        if (geometry) {
          result.push({ geometry, color });
        }
      }
    }

    return result;
  }, [features]);

  useEffect(() => {
    return () => {
      surfaces.forEach((surface) => {
        surface.geometry.dispose();
      });
    };
  }, [surfaces]);

  if (underground) return null;

  return (
    <group name="Paiporta Land Cover">
      {surfaces.map((surface, index) => (
        <mesh key={index} geometry={surface.geometry} receiveShadow>
          <meshStandardMaterial
            color={surface.color}
            side={THREE.DoubleSide}
            roughness={1}
            metalness={0}
          />
        </mesh>
      ))}
    </group>
  );
}
