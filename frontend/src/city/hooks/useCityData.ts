import { useEffect, useState } from "react";
import type { GeoFeatureCollection } from "../geo/geojsonTypes";

export function useCityData() {
  const [data, setData] = useState<GeoFeatureCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadCity() {
      try {
        const response = await fetch("/data/paiporta.geojson", {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Error HTTP: ${response.status}`);
        }

        const json: unknown = await response.json();

        if (
          typeof json !== "object" ||
          json === null ||
          !("type" in json) ||
          json.type !== "FeatureCollection" ||
          !("features" in json) ||
          !Array.isArray(json.features)
        ) {
          throw new Error(
            "El archivo no es un GeoJSON FeatureCollection válido",
          );
        }

        if (!controller.signal.aborted) {
          setData(json as GeoFeatureCollection);
          setError(null);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Error desconocido");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadCity();

    return () => controller.abort();
  }, []);

  return { data, loading, error };
}
