import * as THREE from 'three';
import type { TerrainModel } from './terrainHeight';

/** Closed, indexed terrain block. Side-layer rings share vertices with the top. */
export function buildTerrainGeometry(terrain: TerrainModel): THREE.BufferGeometry {
  const { divisions: n, step, heights } = terrain.sampleGrid();
  const { size, topY, thickness, ravineDepth } = terrain.config;
  const half = size / 2, positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const ground = new THREE.Color('#98a69a'), bank = new THREE.Color('#b2a28b'), bed = new THREE.Color('#7b9289');
  const color = new THREE.Color();
  for (let z = 0; z <= n; z++) for (let x = 0; x <= n; x++) {
    const h = heights[z * (n + 1) + x];
    positions.push(-half + x * step, h, -half + z * step);
    const t = THREE.MathUtils.clamp((topY - h) / ravineDepth, 0, 1);
    color.copy(ground).lerp(bank, Math.min(1, t * 3)).lerp(bed, Math.max(0, (t - .45) / .55));
    colors.push(color.r, color.g, color.b);
  }
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const a = z * (n + 1) + x, b = a + 1, c = a + n + 1, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const topCount = indices.length;
  // Clockwise perimeter seen from above; shared corner vertices close every wall.
  const perimeter: number[] = [];
  for (let x = 0; x < n; x++) perimeter.push(x);
  for (let z = 0; z < n; z++) perimeter.push(z * (n + 1) + n);
  for (let x = n; x > 0; x--) perimeter.push(n * (n + 1) + x);
  for (let z = n; z > 0; z--) perimeter.push(z * (n + 1));
  let previous = perimeter;
  // Follow each boundary height down to the base: configurable thickness cannot fold layers.
  const layers = [{ fraction: 0.42, color: '#7b897a' }, { fraction: 0.7, color: '#9a8b78' }, { fraction: 1, color: '#626e69' }];
  for (const layer of layers) {
    const ring: number[] = [], c = new THREE.Color(layer.color);
    for (const index of perimeter) {
      ring.push(positions.length / 3);
      const edgeY = positions[index * 3 + 1];
      const y = edgeY + (topY - thickness - edgeY) * layer.fraction;
      positions.push(positions[index * 3], y, positions[index * 3 + 2]);
      colors.push(c.r, c.g, c.b);
    }
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      indices.push(previous[i], previous[j], ring[i], previous[j], ring[j], ring[i]);
    }
    previous = ring;
  }
  const center = positions.length / 3;
  positions.push(0, topY - thickness, 0);
  color.set('#626e69'); colors.push(color.r, color.g, color.b);
  for (let i = 0; i < previous.length; i++) indices.push(center, previous[i], previous[(i + 1) % previous.length]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.addGroup(0, topCount, 0);
  geometry.addGroup(topCount, indices.length - topCount, 1);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
