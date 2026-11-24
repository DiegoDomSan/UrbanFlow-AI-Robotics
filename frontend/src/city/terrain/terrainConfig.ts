/** Demonstration dimensions in metres. No survey or DEM is supplied. */
export interface TerrainConfig {
  size: number;
  topY: number;
  thickness: number;
  resolution: number;
  ravineDepth: number;
  bottomWidth: number;
  upperWidth: number;
  bankVariation: number;
  foundationBuffer: number;
  roadBankBlend: number;
  basinRadius: number;
  basinExtraDepth: number;
}

export const terrainConfig: Readonly<TerrainConfig> = Object.freeze({
  size: 500,
  topY: -0.05,
  thickness: 12,
  resolution: 2,
  ravineDepth: 3.2,
  bottomWidth: 9,
  upperWidth: 25,
  bankVariation: 0.12,
  foundationBuffer: 4,
  roadBankBlend: 1.2,
  basinRadius: 7,
  basinExtraDepth: 1.1,
});

export const WATER_PRESETS = { dry: 0, normal: 0.8, storm: 3.05 } as const;
