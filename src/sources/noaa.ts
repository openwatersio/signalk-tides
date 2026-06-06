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
  FetchFunction,
  PredictionOptions,
  PositionOptions,
} from "../types.js";
import FileCache from "../cache.js";
import type {
  NoaaStation,
  NoaaStationsApiResponse,
  NoaaTidePrediction,
  NoaaDatumsApiResponse,
} from "../types/noaa.js";

const mdapiUrl = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi";
const stationsUrl = `${mdapiUrl}/stations.json?type=tidepredictions`;
const dataGetterUrl =
  "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

// Datum names NOAA's datagetter accepts as a `datum` parameter for predictions.
// The MDAPI datums endpoint also returns ranges/inequalities/intervals
// (GT, MN, DHQ, DLQ, HWI, LWI) that are not valid prediction datums, so we
// filter to this allowlist before offering them as options.
const PREDICTION_DATUMS = new Set([
  "STND",
  "MHHW",
  "MHW",
  "MTL",
  "MSL",
  "MLW",
  "MLLW",
  "NAVD",
  "CRD",
  "IGLD",
  "LWD",
]);

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function toStation(s: NoaaStation): Station {
  return {
    id: `noaa/${s.id}`,
    name: s.name,
    latitude: s.lat,
    longitude: s.lng,
    region: s.state,
    country: "US",
    continent: "North America",
    // We request predictions with time_zone=gmt and return UTC timestamps.
    timezone: "UTC",
    type: s.type === "R" ? "reference" : "subordinate",
    source: {
      id: "noaa",
      name: "NOAA CO-OPS",
      url: "https://tidesandcurrents.noaa.gov",
    },
    license: {
      type: "public-domain",
      commercial_use: true,
      url: "https://tidesandcurrents.noaa.gov/disclaimers.html",
    },
    // NOAA's station list doesn't expose datum offsets or harmonics; we only
    // serve MLLW predictions, so there's nothing to populate here.
    datums: {},
    defaultDatum: "MLLW",
    harmonic_constituents: [],
  };
}

function toStationSummary(s: NoaaStation): StationSummary {
  return {
    id: `noaa/${s.id}`,
    name: s.name,
    latitude: s.lat,
    longitude: s.lng,
    region: s.state,
    country: "US",
    type: s.type === "R" ? "reference" : "subordinate",
  };
}

function toExtreme(p: NoaaTidePrediction): Extreme {
  const high = p.type === "H";
  return {
    time: new Date(`${p.t}Z`),
    level: Number(p.v),
    high,
    low: !high,
    label: high ? "High" : "Low",
  };
}

export default function (app: SignalKApp): TideSource {
  return {
    id: "noaa",
    title: "NOAA (US only)",

    async start(props) {
      const fetch: FetchFunction =
        props?._fetch ?? (makeFetchHappen.defaults({
          cachePath: path.join(app.getDataDirPath(), "noaa", "http-cache"),
        }) as unknown as FetchFunction);

      const allStations = await loadStations(fetch, app);

      // Datums rarely change, so persist them per-station across restarts
      // (NOAA sends no cache headers, so make-fetch-happen won't cache them).
      // The in-memory promise map also de-dupes concurrent/repeat lookups.
      const datumsCache = new FileCache(
        path.join(app.getDataDirPath(), "noaa", "datums"),
      );
      const datumsInFlight = new Map<string, Promise<Record<string, number>>>();

      function fetchDatums(stationId: string): Promise<Record<string, number>> {
        let pending = datumsInFlight.get(stationId);
        if (!pending) {
          pending = loadDatums(stationId);
          datumsInFlight.set(stationId, pending);
        }
        return pending;
      }

      async function loadDatums(
        stationId: string,
      ): Promise<Record<string, number>> {
        const cached = (await datumsCache.get(stationId)) as
          | Record<string, number>
          | undefined;
        if (cached) return cached;

        let res: Awaited<ReturnType<FetchFunction>>;
        try {
          res = await fetch(`${mdapiUrl}/stations/${stationId}/datums.json`);
        } catch (e) {
          // Network error — don't cache, so it's retried next time.
          app.debug(`NOAA: failed to fetch datums for ${stationId}: ${e}`);
          return {};
        }
        if (!res.ok) return {};

        const body = (await res.json()) as NoaaDatumsApiResponse;
        const datums: Record<string, number> = {};
        for (const d of body.datums ?? []) {
          if (PREDICTION_DATUMS.has(d.name)) datums[d.name] = d.value;
        }

        // Cache the parsed result (including a legitimately empty set) so we
        // don't re-request stations that have no published datums.
        await datumsCache.set(stationId, datums);
        return datums;
      }

      // Build a full Station, including the datums that power the datum
      // selector in the UI. Used by the station-detail endpoints; the
      // position-based predictions reuse it so the embedded station is
      // consistent. Repeat lookups are served from cache.
      async function buildStation(
        s: NoaaStation,
        distance?: number,
      ): Promise<Station> {
        const station = toStation(s);
        station.datums = await fetchDatums(s.id);
        if (distance !== undefined) station.distance = distance;
        return station;
      }

      async function fetchPredictions(
        stationId: string,
        options: PredictionOptions,
        interval: string,
      ): Promise<NoaaTidePrediction[]> {
        const endpoint = new URL(dataGetterUrl);
        endpoint.search = new URLSearchParams({
          product: "predictions",
          application: "signalk.org/node-server",
          begin_date: formatDate(options.start),
          end_date: formatDate(options.end),
          datum: options.datum ?? "MLLW",
          station: stationId,
          time_zone: "gmt",
          units: options.units === "feet" ? "english" : "metric",
          interval,
          format: "json",
        }).toString();

        app.debug(`Fetching tides from NOAA: ${endpoint}`);

        const res = await fetch(endpoint.toString());
        if (!res.ok)
          throw new Error("Failed to fetch NOAA tides: " + res.statusText);

        const body = (await res.json()) as {
          predictions: NoaaTidePrediction[];
          error?: { message: string };
        };

        if (body.error) throw new Error(body.error.message);
        return body.predictions;
      }

      function closestStation(position: PositionOptions) {
        return nearStations(position, 1)[0];
      }

      function nearStations(
        position: PositionOptions,
        limit = 10,
        maxDistance?: number,
      ) {
        const withDist = allStations.map((s) => ({
          ...s,
          distance: getDistance(position, {
            latitude: s.lat,
            longitude: s.lng,
          }),
        }));

        let sorted = withDist.sort((a, b) => a.distance - b.distance);
        if (maxDistance) {
          sorted = sorted.filter((s) => s.distance <= maxDistance);
        }
        return sorted.slice(0, limit);
      }

      function findNoaaStation(id: string): NoaaStation {
        const rawId = id.replace(/^noaa\//, "");
        const found = allStations.find((s) => s.id === rawId);
        if (!found) throw new Error(`Station not found: ${id}`);
        return found;
      }

      const provider: TideProvider = {
        async getExtremesPrediction(options) {
          const nearest = closestStation(options);
          const predictions = await fetchPredictions(
            nearest.id,
            options,
            "hilo",
          );

          return {
            datum: options.datum ?? "MLLW",
            units: options.units ?? "meters",
            station: await buildStation(nearest, nearest.distance),
            distance: nearest.distance,
            extremes: predictions.map(toExtreme),
          };
        },

        async getTimelinePrediction(options) {
          const nearest = closestStation(options);
          const predictions = await fetchPredictions(
            nearest.id,
            options,
            "10",
          );

          return {
            datum: options.datum ?? "MLLW",
            units: options.units ?? "meters",
            station: await buildStation(nearest, nearest.distance),
            distance: nearest.distance,
            timeline: predictions.map((p) => ({
              time: new Date(`${p.t}Z`),
              level: Number(p.v),
            })),
          };
        },

        findStation(id) {
          return buildStation(findNoaaStation(id));
        },

        searchStations(query, options) {
          const q = query.toLowerCase();
          const limit = options?.maxResults ?? 10;
          return allStations
            .filter(
              (s) =>
                s.name.toLowerCase().includes(q) || s.id.includes(q),
            )
            .slice(0, limit)
            .map(toStationSummary);
        },

        stationsNear(options) {
          return nearStations(
            options,
            options.maxResults,
            options.maxDistance,
          ).map((s) => ({
            ...toStation(s),
            distance: s.distance,
          }));
        },

        stations() {
          return allStations.map(toStationSummary);
        },

        async getStationExtremes(id, options) {
          const noaaStation = findNoaaStation(id);
          const predictions = await fetchPredictions(
            noaaStation.id,
            options,
            "hilo",
          );

          return {
            datum: options.datum ?? "MLLW",
            units: options.units ?? "meters",
            station: await buildStation(noaaStation),
            extremes: predictions.map(toExtreme),
          };
        },

        async getStationTimeline(id, options) {
          const noaaStation = findNoaaStation(id);
          const predictions = await fetchPredictions(
            noaaStation.id,
            options,
            "10",
          );

          return {
            datum: options.datum ?? "MLLW",
            units: options.units ?? "meters",
            station: await buildStation(noaaStation),
            timeline: predictions.map((p) => ({
              time: new Date(`${p.t}Z`),
              level: Number(p.v),
            })),
          };
        },
      };

      return provider;
    },
  };
}

async function loadStations(
  fetch: FetchFunction,
  app: SignalKApp,
): Promise<NoaaStation[]> {
  app.debug("NOAA: Loading tide stations");
  const res = await fetch(stationsUrl);
  if (!res.ok)
    throw new Error(`Failed to download stations: ${res.statusText}`);
  const data = (await res.json()) as NoaaStationsApiResponse;
  app.debug(`NOAA: Loaded ${data.stations.length} stations`);
  return data.stations;
}
