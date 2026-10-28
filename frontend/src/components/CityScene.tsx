import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

import { useCityStore } from "../stores/useCityStore";
import { LandCover } from "../city/LandCover";

import { Buildings } from "../city/layers/Buildings";
import type {
  GeoFeature,
  GeoFeatureCollection,
} from "../city/geo/geojsonTypes";

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

function Roads({
  features,
  underground,
}: {
  features: GeoFeature[];
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

      const lines =
        feature.geometry.type === "LineString"
          ? [feature.geometry.coordinates]
          : feature.geometry.type === "MultiLineString"
            ? feature.geometry.coordinates
            : [];

      for (const line of lines) {
        for (let i = 0; i < line.length - 1; i++) {
          const [ax, az] = toWorld([line[i][0], line[i][1]]);
          const [bx, bz] = toWorld([line[i + 1][0], line[i + 1][1]]);

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

function CityContent({ data }: { data: GeoFeatureCollection }) {
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
          color={underground ? "#8ca9b7" : "#a3b2b9"}
          transparent={underground}
          opacity={underground ? 0.1 : 1}
          roughness={1}
          depthWrite={!underground}
        />
      </mesh>

      <LandCover features={data.features} underground={underground} />

      <Roads features={data.features} underground={underground} />

      <Buildings features={data.features} underground={underground} />

      <UndergroundPreview visible={underground} />

      <OrbitControls
        makeDefault
        enableRotate
        enableZoom
        enablePan
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.7}
        zoomSpeed={1.0}
        panSpeed={0.8}
        screenSpacePanning
        minDistance={5}
        maxDistance={1100}
        minPolarAngle={0}
        maxPolarAngle={Math.PI}
        target={[0, 0, 0]}
      />
    </>
  );
}

export function CityScene() {
  const [data, setData] = useState<GeoFeatureCollection | null>(null);

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
