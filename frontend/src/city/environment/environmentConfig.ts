export const ENVIRONMENT_CONFIG = {
  day: {
    background: '#cbd9db', ambient: 0.7, hemisphere: 1.35,
    sky: '#e8f2f7', ground: '#887b68', sun: '#fff0d7', sunIntensity: 2.25, exposure: 1,
  },
  night: {
    background: '#102438', ambient: 0.32, hemisphere: 0.75,
    sky: '#8ca9df', ground: '#294154', sun: '#86a9df', sunIntensity: 0.45, exposure: 1.12,
  },
  underground: { dayBackground: '#263d4b', nightBackground: '#122533', ambientMinimum: 0.65, hemisphereMinimum: 1.05 },
} as const;
