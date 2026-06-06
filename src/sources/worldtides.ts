import path from "path";
import makeFetchHappen from "make-fetch-happen";
import FileCache from "../cache.js";
import type {
  SignalKApp,
  TideSource,
  TideProvider,
  Station,
  StationSummary,
  Extreme,
  FetchFunction,
  PredictionOptions,
  PositionOptions,
} from "../types.js";
import type {
  WorldTidesApiResponse,
  WorldTidesStation,
  WorldTidesDatum,
} from "../types/worldtides.js";

const BASE_URL = "https://www.worldtides.info/api/v3";

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysBetween(start: Date, end: Date): number {
  return Math.min(7, Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))));
}

/**
 * WorldTides is purely position-based — it has no get-station-by-id API — so we
 * encode the station's coordinates into its ID. That lets the station-detail
 * endpoints (findStation/getStation*) resolve back to a position to query,
 * which is what the vessel/current redirect flow needs.
 */
function stationId(latitude: number, longitude: number): string {
  return `worldtides/${latitude},${longitude}`;
}

function parseStationId(id: string): PositionOptions {
  const parts = id.replace(/^worldtides\//, "").split(",");
  const [latitude, longitude] = parts.map(Number);
  if (parts.length !== 2 || Number.isNaN(latitude) || Number.isNaN(longitude)) {
    throw new Error(`Invalid WorldTides station ID: ${id}`);
  }
  return { latitude, longitude };
}

function toDatums(datums: WorldTidesDatum[] = []): Record<string, number> {
  return Object.fromEntries(datums.map((d) => [d.name, d.height]));
}

function toExtreme(e: { dt: number; height: number; type: string }): Extreme {
  const high = e.type === "High";
  return {
    time: new Date(e.dt * 1000),
    level: e.height,
    high,
    low: !high,
    label: high ? "High" : "Low",
  };
}

const source = {
  id: "worldtides",
  name: "WorldTides.info",
  url: "https://www.worldtides.info",
};

export default function (app: SignalKApp): TideSource {
  return {
    id: "worldtides",
    title: "WorldTides.info",
    properties: {
      worldtidesApiKey: {
        type: "string",
        title: "WorldTides.info API key",
      },
    },

    start(props = {}) {
      const { worldtidesApiKey = "" } = props;
      app.debug("Using WorldTides API");

      const fetch: FetchFunction = props._fetch ?? (makeFetchHappen.defaults({
        cachePath: path.join(app.getDataDirPath(), "worldtides", "http-cache"),
      }) as unknown as FetchFunction);

      // Datums are location-specific values but a fixed catalog of names; cache
      // them per station so we only spend an API credit on them once.
      const datumsCache = new FileCache(
        path.join(app.getDataDirPath(), "worldtides", "datums"),
      );
      const datumsInFlight = new Map<string, Promise<Record<string, number>>>();

      async function apiRequest(
        params: Record<string, string>,
      ): Promise<WorldTidesApiResponse> {
        const endpoint = new URL(BASE_URL);
        endpoint.search = new URLSearchParams({
          key: worldtidesApiKey,
          ...params,
        }).toString();

        app.debug("Fetching WorldTides: " + endpoint);

        const res = await fetch(endpoint.toString());
        if (!res.ok)
          throw new Error("Failed to fetch WorldTides: " + res.statusText);

        const data = (await res.json()) as WorldTidesApiResponse;
        if (data.status !== 200)
          throw new Error(data.error ?? "WorldTides API error");

        return data;
      }

      function fetchDatums(
        latitude: number,
        longitude: number,
      ): Promise<Record<string, number>> {
        const key = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
        let pending = datumsInFlight.get(key);
        if (!pending) {
          pending = loadDatums(latitude, longitude, key);
          datumsInFlight.set(key, pending);
        }
        return pending;
      }

      async function loadDatums(
        latitude: number,
        longitude: number,
        key: string,
      ): Promise<Record<string, number>> {
        const cached = (await datumsCache.get(key)) as
          | Record<string, number>
          | undefined;
        if (cached) return cached;

        try {
          const data = await apiRequest({
            datums: "",
            lat: String(latitude),
            lon: String(longitude),
          });
          const datums = toDatums(data.datums);
          await datumsCache.set(key, datums);
          return datums;
        } catch (e) {
          // Don't cache failures, so they're retried next time.
          app.debug(`WorldTides: failed to fetch datums for ${key}: ${e}`);
          return {};
        }
      }

      /**
       * Build a full Station from an API response. If the response already
       * carries datums (the datums endpoint returns them inline) they're used
       * directly; otherwise they're fetched (and cached) for the station.
       */
      async function buildStation(
        data: WorldTidesApiResponse,
      ): Promise<Station> {
        const datums = data.datums
          ? toDatums(data.datums)
          : await fetchDatums(data.responseLat, data.responseLon);

        return {
          id: stationId(data.responseLat, data.responseLon),
          name: `${data.station} (${data.atlas})`,
          latitude: data.responseLat,
          longitude: data.responseLon,
          timezone: data.timezone,
          source,
          datums,
          defaultDatum: data.responseDatum,
        };
      }

      function toStationSummary(s: WorldTidesStation): StationSummary {
        return {
          id: stationId(s.lat, s.lon),
          name: s.name,
          latitude: s.lat,
          longitude: s.lon,
          timezone: s.timezone,
        };
      }

      function positionParams(options: PositionOptions) {
        return {
          lat: String(options.latitude),
          lon: String(options.longitude),
        };
      }

      function predictionParams(options: PredictionOptions) {
        const params: Record<string, string> = {
          date: formatDate(options.start),
          days: String(daysBetween(options.start, options.end)),
        };
        if (options.datum) params.datum = options.datum;
        return params;
      }

      const provider: TideProvider = {
        async getExtremesPrediction(options) {
          const data = await apiRequest({
            extremes: "",
            ...positionParams(options),
            ...predictionParams(options),
          });

          return {
            datum: data.responseDatum ?? options.datum,
            units: options.units ?? "meters",
            station: await buildStation(data),
            extremes: (data.extremes ?? []).map(toExtreme),
          };
        },

        async getTimelinePrediction(options) {
          const data = await apiRequest({
            heights: "",
            step: "600", // 10-minute intervals
            ...positionParams(options),
            ...predictionParams(options),
          });

          return {
            datum: data.responseDatum ?? options.datum,
            units: options.units ?? "meters",
            station: await buildStation(data),
            timeline: (data.heights ?? []).map((h) => ({
              time: new Date(h.dt * 1000),
              level: h.height,
            })),
          };
        },

        async stationsNear(
          options: PositionOptions & {
            maxResults?: number;
            maxDistance?: number;
          },
        ) {
          const distKm = options.maxDistance
            ? Math.ceil(options.maxDistance / 1000)
            : 50;
          const data = await apiRequest({
            stations: "",
            ...positionParams(options),
            stationDistance: String(distKm),
          });

          return (data.stations ?? [])
            .slice(0, options.maxResults ?? 10)
            .map((s) => ({ ...toStationSummary(s), source }));
        },

        async findStation(id) {
          // Resolve the station's coordinates back to a position and fetch its
          // datums (which the response returns inline).
          const { latitude, longitude } = parseStationId(id);
          const data = await apiRequest({
            datums: "",
            lat: String(latitude),
            lon: String(longitude),
          });
          return buildStation(data);
        },

        getStationExtremes(id, options) {
          return provider.getExtremesPrediction({
            ...parseStationId(id),
            ...options,
          });
        },

        getStationTimeline(id, options) {
          return provider.getTimelinePrediction({
            ...parseStationId(id),
            ...options,
          });
        },
      };

      return provider;
    },
  };
}
