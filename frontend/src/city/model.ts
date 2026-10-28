import type { CityModel } from "../types/city";
export const city: CityModel = {
  id: "urbanflow-demo-01",
  widthMeters: 240,
  depthMeters: 240,
  buildings: [
    {
      id: "b01",
      position: [-70, 0, -70],
      dimensions: [30, 35, 25],
      kind: "residential",
    },
    {
      id: "b02",
      position: [70, 0, -70],
      dimensions: [28, 45, 30],
      kind: "office",
    },
    {
      id: "b03",
      position: [-70, 0, 70],
      dimensions: [35, 24, 30],
      kind: "commercial",
    },
    {
      id: "b04",
      position: [70, 0, 70],
      dimensions: [28, 38, 25],
      kind: "residential",
    },
  ],
};
