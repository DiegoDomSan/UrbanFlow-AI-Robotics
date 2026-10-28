import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useCityStore } from "../stores/useCityStore";

type Properties = Record<string, unknown>;

type Feature = {
  type: "Feature";
  properties: Properties;
  geometry: {
    type: string;
    coordinates: any;
  } | null;
};

type FeatureCollection = {
  type: "FeatureCollection";
  features: Feature[];
};

const CENTER_LAT = 39.428;
const CENTER_LON = -0.4184;
const SIZE = 500;
const EARTH_RADIUS = 6378137;

function toWorld(coord: number[]): [number, number] {
  const [lon, lat] = coord;
  const latitude = THREE.MathUtils.degToRad(CENTER_LAT);

  const x =
    EARTH_RADIUS *
    THREE.MathUtils.degToRad(lon - CENTER_LON) *
    Math.cos(latitude);

  const z = -EARTH_RADIUS * THREE.MathUtils.degToRad(lat - CENTER_LAT);

  return [x, z];
}

function insideArea(x: number, z: number) {
  return Math.abs(x) <= SIZE / 2 && Math.abs(z) <= SIZE / 2;
}

function buildingHeight(props: Properties): number {
  const height = Number.parseFloat(String(props.height ?? ""));
  if (Number.isFinite(height) && height > 0) {
    return height;
  }

  const levels = Number.parseFloat(String(props["building:levels"] ?? ""));

  if (Number.isFinite(levels) && levels > 0) {
    return levels * 3.1;
  }

  // Estimación visual, no altura verificada
  return 10;
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

function createBuildingGeometry(
  polygon: number[][][],
  height: number,
): THREE.ExtrudeGeometry | null {
  const outer = polygon[0];

  if (!outer || outer.length < 4) return null;

  const toPoint = (coord: number[]) => {
    const [x, z] = toWorld(coord);

    // Coordenadas para extrusión vertical.
    return new THREE.Vector2(x, -z);
  };

  const cleanRing = (ring: number[][]) => {
    const points = ring.map(toPoint);

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

  // ShapeUtils espera contornos exteriores horarios
  // para generar correctamente las tapas.
  if (!THREE.ShapeUtils.isClockWise(outerPoints)) {
    outerPoints.reverse();
  }

  const shape = new THREE.Shape(outerPoints);

  for (const ring of polygon.slice(1)) {
    const holePoints = cleanRing(ring);

    if (holePoints.length < 3) continue;

    // Los agujeros deben ser antihorarios.
    if (THREE.ShapeUtils.isClockWise(holePoints)) {
      holePoints.reverse();
    }

    shape.holes.push(new THREE.Path(holePoints));
  }

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(height, 3),
    bevelEnabled: false,
    steps: 1,
    curveSegments: 1,
  });

  geometry.rotateX(-Math.PI / 2);

  return geometry;
}

function createRoofGeometry(
  polygon: number[][][],
  height: number,
): THREE.BufferGeometry | null {
  const outer = polygon[0];

  if (!outer || outer.length < 4) return null;

  const toPoint = (coord: number[]) => {
    const [x, z] = toWorld(coord);
    return new THREE.Vector2(x, -z);
  };

  const cleanRing = (ring: number[][]) => {
    const points = ring.map(toPoint);

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

  const geometry = new THREE.ShapeGeometry(shape);

  // Convertir el plano XY a horizontal XZ.
  geometry.rotateX(-Math.PI / 2);

  // Colocar el tejado justo encima del edificio.
  geometry.translate(0, Math.max(height, 3) + 0.01, 0);

  return geometry;
}

function Buildings({
  features,
  underground,
}: {
  features: Feature[];
  underground: boolean;
}) {
  const buildings = useMemo(() => {
    const result: {
      geometry: THREE.ExtrudeGeometry;
      roofGeometry: THREE.BufferGeometry | null;
      height: number;
    }[] = [];

    for (const feature of features) {
      if (!feature.properties?.building || !feature.geometry) continue;

      const polygons: number[][][][] =
        feature.geometry.type === "Polygon"
          ? [feature.geometry.coordinates]
          : feature.geometry.type === "MultiPolygon"
            ? feature.geometry.coordinates
            : [];

      for (const polygon of polygons) {
        const outer = polygon[0];
        if (!outer?.length) continue;

        const points = outer.map(toWorld);
        const centerX =
          points.reduce((sum, p) => sum + p[0], 0) / points.length;
        const centerZ =
          points.reduce((sum, p) => sum + p[1], 0) / points.length;

        if (!insideArea(centerX, centerZ)) continue;

        const height = buildingHeight(feature.properties);

        const geometry = createBuildingGeometry(polygon, height);
        if (!geometry) continue;

        const roofGeometry = createRoofGeometry(polygon, height);

        result.push({
          geometry,
          roofGeometry,
          height,
        });
      }
    }

    return result;
  }, [features]);

  useEffect(() => {
    return () => {
      buildings.forEach((b) => {
        b.geometry.dispose();
        b.roofGeometry?.dispose();
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
            {/* Building body: walls only */}
            <mesh
              geometry={building.geometry}
              castShadow={!underground}
              receiveShadow={!underground}
              renderOrder={underground ? 2 : 0}
            >
              {/* ExtrudeGeometry material 0 = top/bottom caps.
                Hide them because we use a separate roof. */}
              <meshBasicMaterial attach="material-0" visible={false} />

              {/* ExtrudeGeometry material 1 = side walls */}
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

            {/* Roof: same transparency as the walls */}
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

function Roads({
  features,
  underground,
}: {
  features: Feature[];
  underground: boolean;
}) {
  const segments = useMemo(() => {
    const result: {
      x: number;
      z: number;
      length: number;
      width: number;
      angle: number;
    }[] = [];

    for (const feature of features) {
      const type = feature.properties?.highway;
      if (typeof type !== "string" || !feature.geometry) continue;

      const lines: number[][][] =
        feature.geometry.type === "LineString"
          ? [feature.geometry.coordinates]
          : feature.geometry.type === "MultiLineString"
            ? feature.geometry.coordinates
            : [];

      for (const line of lines) {
        for (let i = 0; i < line.length - 1; i++) {
          const [ax, az] = toWorld(line[i]);
          const [bx, bz] = toWorld(line[i + 1]);

          const x = (ax + bx) / 2;
          const z = (az + bz) / 2;

          if (!insideArea(x, z)) continue;

          const dx = bx - ax;
          const dz = bz - az;
          const length = Math.hypot(dx, dz);

          if (length < 0.05) continue;

          result.push({
            x,
            z,
            length,
            width: roadWidth(type),
            angle: Math.atan2(dx, dz),
          });
        }
      }
    }

    return result;
  }, [features]);

  return (
    <group name="Paiporta Roads">
      {segments.map((road, index) => (
        <mesh
          key={index}
          position={[road.x, 0.055, road.z]}
          rotation={[0, road.angle, 0]}
          receiveShadow
        >
          <boxGeometry args={[road.width, 0.08, road.length]} />
          <meshStandardMaterial
            color={underground ? "#668da5" : "#263746"}
            transparent={underground}
            opacity={underground ? 0.18 : 1}
            roughness={0.95}
            depthWrite={!underground}
          />
        </mesh>
      ))}
    </group>
  );
}

function UndergroundPreview({ visible }: { visible: boolean }) {
  if (!visible) return null;

  // Red demostrativa. NO representa el
  // alcantarillado real de Paiporta.
  return (
    <group name="Synthetic Drainage Preview">
      <mesh position={[0, -3.5, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[1.4, 1.4, 460, 12]} />
        <meshStandardMaterial color="#38bdf8" />
      </mesh>

      <mesh position={[0, -3.5, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[1.2, 1.2, 460, 12]} />
        <meshStandardMaterial color="#0284c7" />
      </mesh>
    </group>
  );
}

function CityContent({ data }: { data: FeatureCollection }) {
  const mode = useCityStore((s) => s.mode);
  const underground = mode === "underground";

  return (
    <>
      <ambientLight intensity={0.85} />

      <hemisphereLight args={["#dbeafe", "#475569", 1.1]} />

      <directionalLight
        position={[180, 260, 100]}
        intensity={1.25}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-300}
        shadow-camera-right={300}
        shadow-camera-top={300}
        shadow-camera-bottom={-300}
      />

      <mesh position={[0, -0.55, 0]} receiveShadow={!underground}>
        <boxGeometry args={[SIZE, 1, SIZE]} />

        <meshStandardMaterial
          color={underground ? "#8ca9b7" : "#607d8b"}
          transparent={underground}
          opacity={underground ? 0.1 : 1}
          roughness={1}
          depthWrite={!underground}
        />
      </mesh>

      <Roads features={data.features} underground={underground} />

      <Buildings features={data.features} underground={underground} />

      <UndergroundPreview visible={underground} />

      <OrbitControls
        makeDefault
        enableDamping
        enablePan
        minDistance={8}
        maxDistance={950}
        maxPolarAngle={Math.PI / 2.02}
        target={[0, 0, 0]}
      />
    </>
  );
}

export function CityScene() {
  const [data, setData] = useState<FeatureCollection | null>(null);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/data/paiporta.geojson")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`GeoJSON not found (HTTP ${response.status})`);
        }
        return response.json();
      })
      .then((json) => {
        if (
          json.type !== "FeatureCollection" ||
          !Array.isArray(json.features)
        ) {
          throw new Error("Invalid GeoJSON");
        }

        if (!cancelled) setData(json);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err.message ?? err));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div style={{ padding: 24, color: "#dc2626" }}>
        Error loading Paiporta: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 24 }}>Loading Paiporta geographical data...</div>
    );
  }

  return (
    <Canvas
      shadows
      camera={{
        position: [350, 320, 350],
        fov: 48,
        near: 0.1,
        far: 1800,
      }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#a9c4d4"]} />
      <CityContent data={data} />
    </Canvas>
  );
}
