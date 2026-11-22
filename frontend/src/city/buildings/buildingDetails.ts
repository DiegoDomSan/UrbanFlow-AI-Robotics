import * as THREE from 'three';

export const FACADE_CONFIG = {
  edgeMargin: 0.65,
  floorHeight: 3.1,
  minimumWallLength: 3.3,
  minimumBuildingHeight: 3,
  preferredWindowSpacing: 2.6,
  windowWidth: 1.05,
  windowHeight: 1.35,
  frameWidth: 0.09,
} as const;

export interface FacadeLayout {
  wallLength: number;
  height: number;
  columns: number;
  floors: number;
  cellWidth: number;
  floorHeight: number;
}

/** Meter-based facade limits are reused by geometry attributes and the shader.
 * A partial top floor never creates a window above the existing roof. */
export function getFacadeLayout(wallLength: number, height: number): FacadeLayout {
  const usable = wallLength - FACADE_CONFIG.edgeMargin * 2;
  const columns = wallLength >= FACADE_CONFIG.minimumWallLength && height >= FACADE_CONFIG.minimumBuildingHeight
    ? Math.max(1, Math.floor(usable / FACADE_CONFIG.preferredWindowSpacing)) : 0;
  const floors = Math.max(0, Math.floor(height / FACADE_CONFIG.floorHeight));
  return {wallLength, height, columns, floors, cellWidth: columns ? usable / columns : 0, floorHeight: FACADE_CONFIG.floorHeight};
}

/** Extract the exact wall triangles from the existing extrusion. Each flat wall
 * face receives its own local horizontal coordinate; courtyards work identically.
 * Shader details are painted ON those triangles, never on floating geometry. */
export function createDetailedWallGeometry(extrusion: THREE.ExtrudeGeometry, color: THREE.Color, seed: number): THREE.BufferGeometry {
  const positions: number[] = [], normals: number[] = [], colors: number[] = [];
  const facadeUV: number[] = [], layouts: number[] = [], seeds: number[] = [];
  const p = extrusion.getAttribute('position'), n = extrusion.getAttribute('normal');
  for (const group of extrusion.groups) {
    if (group.materialIndex !== 1) continue;
    // ExtrudeGeometry steps=1 emits two triangles (six vertices) for each wall edge.
    for (let start = group.start; start < group.start + group.count; start += 6) {
      const end = Math.min(start + 6, group.start + group.count);
      const nx = n.getX(start), nz = n.getZ(start), tx = -nz, tz = nx;
      let minimum = Infinity, maximum = -Infinity, bottom = Infinity, top = -Infinity;
      for (let i = start; i < end; i++) {
        const u = p.getX(i) * tx + p.getZ(i) * tz;
        minimum = Math.min(minimum, u); maximum = Math.max(maximum, u);
        bottom = Math.min(bottom, p.getY(i)); top = Math.max(top, p.getY(i));
      }
      const layout = getFacadeLayout(maximum - minimum, top - bottom);
      for (let i = start; i < end; i++) {
        positions.push(p.getX(i), p.getY(i), p.getZ(i));
        normals.push(n.getX(i), n.getY(i), n.getZ(i));
        colors.push(color.r, color.g, color.b);
        facadeUV.push(p.getX(i) * tx + p.getZ(i) * tz - minimum, p.getY(i) - bottom);
        layouts.push(layout.wallLength, layout.height, layout.columns, layout.floors);
        seeds.push(seed);
      }
    }
  }
  const walls = new THREE.BufferGeometry();
  walls.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  walls.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  walls.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  walls.setAttribute('facadeUV', new THREE.Float32BufferAttribute(facadeUV, 2));
  walls.setAttribute('facadeLayout', new THREE.Float32BufferAttribute(layouts, 4));
  walls.setAttribute('facadeSeed', new THREE.Float32BufferAttribute(seeds, 1));
  return walls;
}

export function setGeometryColor(geometry: THREE.BufferGeometry, color: THREE.Color) {
  const values = new Float32Array(geometry.getAttribute('position').count * 3);
  for (let i = 0; i < values.length; i += 3) { values[i] = color.r; values[i + 1] = color.g; values[i + 2] = color.b; }
  geometry.setAttribute('color', new THREE.BufferAttribute(values, 3));
  return geometry;
}
