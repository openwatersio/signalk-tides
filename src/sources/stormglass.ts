import path from "path";
import { getDistance } from "geolib";
import makeFetchHappen from "make-fetch-happen";
import type {
  SignalKApp,
  TideSource,
  TideProvider,
  Station,
  StationSummary,
  Extreme,
  PredictionOptions,
  PositionOptions,
  FetchFunction,
} from "../types.js";
import type {
  StormGlassExtremesResponse,
  StormGlassSeaLevelResponse,
  StormGlassStationsResponse,
  StormGlassStationData,
  StormGlassMetaStation,
} from "../types/stormglass.js";

const BASE_URL = "https://api.stormglass.io/v2/tide";

// StormGlass tide predictions accept only these two datums — its API rejects
// anything else (e.g. "LAT not valid. Should be one of: MLLW, MSL"). It exposes
// no datum offset table, so the values are placeholders; the @neaps UI only
// uses the keys to populate the datum selector. MSL is StormGlass's default.
const STORMGLASS_DEFAULT_DATUM = "MSL";
const STORMGLASS_DATUMS: Record<string, number> = { MSL: 0, MLLW: 0 };

function toStation(s: StormGlassStationData | StormGlassMetaStation): Station {
  return {
    id: `stormglass/${s.name}`,
    name: s.name,
    latitude: s.lat,
    longitude: s.lng,
    source: { id: "stormglass", name: s.source },
    datums: { ...STORMGLASS_DATUMS },
    defaultDatum: STORMGLASS_DEFAULT_DATUM,
    ...("distance" in s ? { distance: s.distance * 1000 } : {}), // km → meters
  };
}

function toStationSummary(s: StormGlassStationData): StationSummary {
  return {
    id: `stormglass/${s.name}`,
    name: s.name,
    latitude: s.lat,
    longitude: s.lng,
  };
}

function toExtreme(e: {
  height: number;
  time: string;
  type: "high" | "low";
}): Extreme {
  const high = e.type === "high";
  return {
    time: new Date(e.time),
    level: e.height,
    high,
    low: !high,
    label: high ? "High" : "Low",
  };
}

export default function (app: SignalKApp): TideSource {
  return {
    id: "stormglass",
    title: "StormGlass.io",
    properties: {
      stormglassApiKey: {
        type: "string",
        title: "StormGlass.io API key",
      },
    },

    start(props = {}) {
      const { stormglassApiKey } = props;
      app.debug("Using StormGlass.io API");

      const fetch: FetchFunction = props._fetch ?? (makeFetchHappen.defaults({
        cachePath: path.join(app.getDataDirPath(), "stormglass", "http-cache"),
        headers: { Authorization: stormglassApiKey ?? "" },
      }) as unknown as FetchFunction);

      let cachedStations: StormGlassStationData[] | null = null;

      async function loadStations(): Promise<StormGlassStationData[]> {
        if (cachedStations) return cachedStations;

        app.debug("StormGlass: Loading stations list");
        const res = await fetch(`${BASE_URL}/stations`);
        if (!res.ok)
          throw new Error(
            "Failed to fetch StormGlass stations: " + res.statusText,
          );
        const data = (await res.json()) as StormGlassStationsResponse;
        cachedStations = data.data;
        return cachedStations;
      }

      function predictionParams(options: PredictionOptions) {
        const params: Record<string, string> = {
          start: options.start.toISOString(),
          end: options.end.toISOString(),
        };
        if (options.datum) params.datum = options.datum;
        return params;
      }

      async function findStationByName(
        id: string,
      ): Promise<StormGlassStationData> {
        const stations = await loadStations();
        const rawName = id.replace(/^stormglass\//, "");
        const found = stations.find((s) => s.name === rawName);
        if (!found) throw new Error(`Station not found: ${id}`);
        return found;
      }

      const provider: TideProvider = {
        async getExtremesPrediction(options) {
          const endpoint = new URL(`${BASE_URL}/extremes/point`);
          endpoint.search = new URLSearchParams({
            lat: String(options.latitude),
            lng: String(options.longitude),
            ...predictionParams(options),
          }).toString();

          app.debug("Fetching StormGlass extremes: " + endpoint);

          const res = await fetch(endpoint.toString());
          if (!res.ok)
            throw new Error(
              "Failed to fetch StormGlass extremes: " + res.statusText,
            );

          const data = (await res.json()) as StormGlassExtremesResponse;
          const station = toStation(data.meta.station);

          return {
            datum: data.meta.datum ?? options.datum,
            units: options.units ?? "meters",
            station,
            distance: data.meta.station.distance * 1000,
            extremes: data.data.map(toExtreme),
          };
        },

        async getTimelinePrediction(options) {
          const endpoint = new URL(`${BASE_URL}/sea-level/point`);
          endpoint.search = new URLSearchParams({
            lat: String(options.latitude),
            lng: String(options.longitude),
            ...predictionParams(options),
          }).toString();

          app.debug("Fetching StormGlass sea level: " + endpoint);

          const res = await fetch(endpoint.toString());
          if (!res.ok)
            throw new Error(
              "Failed to fetch StormGlass sea level: " + res.statusText,
            );

          const data = (await res.json()) as StormGlassSeaLevelResponse;
          const station = toStation(data.meta.station);

          return {
            datum: data.meta.datum ?? options.datum,
            units: options.units ?? "meters",
            station,
            distance: data.meta.station.distance * 1000,
            timeline: data.data.map((e) => ({
              time: new Date(e.time),
              level: e.sg,
            })),
          };
        },

        async findStation(id) {
          return toStation(await findStationByName(id));
        },

        async searchStations(query, options) {
          const stations = await loadStations();
          const q = query.toLowerCase();
          const limit = options?.maxResults ?? 10;
          return stations
            .filter((s) => s.name.toLowerCase().includes(q))
            .slice(0, limit)
            .map(toStationSummary);
        },

        async stationsNear(options: PositionOptions & { maxResults?: number; maxDistance?: number }) {
          const stations = await loadStations();
          const withDist = stations.map((s) => ({
            ...s,
            distance: getDistance(options, {
              latitude: s.lat,
              longitude: s.lng,
            }),
          }));

          let sorted = withDist.sort((a, b) => a.distance - b.distance);
          if (options.maxDistance) {
            sorted = sorted.filter((s) => s.distance <= options.maxDistance!);
          }
          return sorted.slice(0, options.maxResults ?? 10).map((s) => ({
            ...toStation(s),
            distance: s.distance,
          }));
        },

        async stationsWithin(bbox) {
          const [minLon, minLat, maxLon, maxLat] = bbox;
          // StormGlass format: topRight:bottomLeft → maxLat,maxLon:minLat,minLon
          const box = `${maxLat},${maxLon}:${minLat},${minLon}`;

          const endpoint = new URL(`${BASE_URL}/stations/area`);
          endpoint.search = new URLSearchParams({ box }).toString();

          app.debug("Fetching StormGlass stations area: " + endpoint);

          const res = await fetch(endpoint.toString());
          if (!res.ok)
            throw new Error(
              "Failed to fetch StormGlass stations: " + res.statusText,
            );

          const data = (await res.json()) as StormGlassStationsResponse;
          return data.data.map(toStationSummary);
        },

        async stations() {
          return (await loadStations()).map(toStationSummary);
        },

        async getStationExtremes(id, options) {
          const station = await findStationByName(id);
          return provider.getExtremesPrediction({
            latitude: station.lat,
            longitude: station.lng,
            ...options,
          });
        },

        async getStationTimeline(id, options) {
          const station = await findStationByName(id);
          return provider.getTimelinePrediction({
            latitude: station.lat,
            longitude: station.lng,
            ...options,
          });
        },
      };

      return provider;
    },
  };
}
