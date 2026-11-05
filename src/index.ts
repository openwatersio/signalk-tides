/*
 * Copyright 2017 Scott Bender <scott@scottbender.net> and Joachim Bakke
 * Copyright 2025 Brandon Keepers <brandon@opensoul.org>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Context, Delta, MetaValue, Path, Plugin, Position, ServerAPI, Timestamp } from "@signalk/server-api";
import { RequestHandler } from "express";
import { createRoutes } from "@slackwater/api";
import { findStation, nearestStation, stationsNear } from "slackwater";
import {
  MAX_STATION_KM,
  hasTideModel,
  isNoStationNearby,
  isStationNotFound,
  tideStateAt,
  timeToNextExtreme,
} from "./calculations.js";
import FileCache from "./cache.js";
import { withVesselPosition } from "./middleware.js";
import {
  PLOTTER_EXTENSION_ID,
  plotterExtensionManifest,
} from "./plotter-extension.js";

type Predictor = Awaited<ReturnType<typeof findStation>>;
type Forecast = ReturnType<Predictor["getExtremesPrediction"]>;

interface Config {
  defaultStation?: string;
}

// Recompute and republish on a fixed interval. Predictions are computed locally
// by slackwater, so this is cheap and needs no configuration.
const UPDATE_INTERVAL = 60 * 1000; // 1 minute
const API_PATH = "/signalk/v2/api/tides";
const COMPENSATED_DEPTH_PATH = "environment.depth.belowChartDatum" as Path;

const TIDE_PATHS = [
  "environment.tide.stationName",
  "environment.tide.stationDistance",
  "environment.tide.datum",
  "environment.tide.heightNow",
  "environment.tide.state",
  "environment.tide.timeToNextExtreme",
  "environment.tide.heightHigh",
  "environment.tide.timeHigh",
  "environment.tide.heightLow",
  "environment.tide.timeLow",
] as Path[];

// Tide heights are water levels, so clients should show them in the user's
// depth unit. Without a category the server picks one from the unit alone, and
// for meters that is distance: kilometers or miles, depending on the preset.
const DEPTH_UNIT_PATHS = [
  "environment.tide.heightHigh",
  "environment.tide.heightNow",
  "environment.tide.heightLow",
  COMPENSATED_DEPTH_PATH,
];

export default function (app: ServerAPI): Plugin {
  let unsubscribes: (() => void)[] = [];
  let activeRouter: RequestHandler | null = null;
  let lastPosition: Position | null = null;
  let config: Config = {};

  // Mount forwarding middleware once (Express doesn't support unmounting)
  // @ts-expect-error: app is an Express app at runtime
  app.use(API_PATH, (req, res, next) => {
    if (activeRouter) {
      activeRouter(req, res, next);
    } else {
      next();
    }
  });

  const plugin: Plugin = {
    id: "tides",
    name: "Tides",
    description:
      "Offline tidal predictions for the vessel's position, powered by Slackwater.",
    // signalk-server awaits this, but a rejection would fail its whole plugin list
    schema: async () => ({
      title: "Tides",
      type: "object",
      properties: {
        defaultStation: {
          type: "string",
          title: "Default tide station",
          description:
            "Use the closest station to the vessel's current position, or pick a default nearby station.",
          default: "auto",
          oneOf: await defaultStationOptions(),
        },
      },
    }),
    start,
    stop() {
      unsubscribes.forEach((f) => f());
      unsubscribes = [];
      activeRouter = null;
    },
  };

  async function defaultStationOptions(): Promise<
    { const: string; title: string }[]
  > {
    const options = [{ const: "auto", title: "Closest station" }];

    if (lastPosition) {
      try {
        const nearby = await stationsNear({
          ...lastPosition,
          maxResults: 10,
        });
        for (const station of nearby) {
          options.push({ const: station.id, title: stationTitle(station) });
        }
      } catch (e: unknown) {
        app.error(`Could not list nearby tide stations: ${errorMessage(e)}`);
      }
    }

    // Keep the saved station selectable even when it is not in the nearby
    // list, so opening the settings far from it (or before a position fix)
    // cannot clobber it on save.
    const saved = savedDefaultStation();
    if (saved && saved !== "auto" && !options.some((o) => o.const === saved)) {
      let title = saved;
      try {
        const station = await findStation(saved);
        title = hasTideModel(station)
          ? stationTitle(station)
          : `${stationTitle(station)} (no tide predictions)`;
      } catch (e: unknown) {
        // Unknown id: keep the raw value as the label
        if (!isStationNotFound(e)) {
          app.error(`Could not load saved tide station: ${errorMessage(e)}`);
        }
      }
      options.splice(1, 0, { const: saved, title });
    }

    return options;
  }

  // The server keeps display units the user chose for a path, and stores the
  // suggestion, so later starts leave a path alone while it has display units.
  async function suggestDepthUnits() {
    // Signal K server 2.30 added setDefaultMetadata
    if (typeof app.setDefaultMetadata !== "function") return;
    for (const path of DEPTH_UNIT_PATHS) {
      try {
        // MetaValue types displayUnits as the server resolves it; a suggestion
        // needs only the category.
        await app.setDefaultMetadata(path, {
          displayUnits: { category: "depth" } as MetaValue["displayUnits"],
        });
      } catch (e: unknown) {
        app.error(`Could not suggest display units for ${path}: ${e}`);
      }
    }
  }

  function savedDefaultStation(): string | undefined {
    try {
      const saved = app.readPluginOptions() as {
        configuration?: Config | null;
      };
      return saved?.configuration?.defaultStation;
    } catch {
      return undefined;
    }
  }

  // Not async: signalk-server only rolls back a start() that throws synchronously,
  // and that rollback does not call stop().
  function start(options?: object) {
    try {
      startPublishing(options);
    } catch (e: unknown) {
      plugin.stop();
      throw e;
    }
  }

  function startPublishing(options?: object) {
    app.debug("Starting tides");
    config = (options ?? {}) as Config;
    void suggestDepthUnits();

    // Keep the forecast and the predictor that produced it together, so the
    // extremes and the current height are always read from the same station.
    let lastForecast: Forecast | null = null;
    let lastPredictor: Predictor | null = null;
    let latestUpdate = 0;
    let stopped = false;
    let tidesCleared = false;
    let positionWrite: Promise<unknown> = Promise.resolve();
    // Keep the latest depth reading so it can be published once a predictor
    // becomes available, even if the depth tick arrived first.
    let lastDepth: { value: number; time: Date } | null = null;
    unsubscribes.push(() => {
      stopped = true;
    });
    const cache = new FileCache(app.getDataDirPath());

    // Mount the Slackwater API, with vessel/default resolved to the configured
    // default station (or the nearest one).
    activeRouter = withVesselPosition(
      // @slackwater/api bundles its own Express declarations, so its Router is
      // callable at runtime but not structurally compatible with ours.
      // The OpenAPI server URL comes from req.baseUrl, set by the
      // app.use(API_PATH, ...) mount above.
      createRoutes() as unknown as RequestHandler,
      () => lastPosition,
      () => config.defaultStation ?? null,
    );

    // Register tide predictions as a resource provider
    app.registerResourceProvider({
      type: "tides",
      methods: {
        async listResources() {
          const predictor = await resolvePredictor();
          if (!predictor) {
            throw new Error("No position or default station available");
          }
          return forecastFor(predictor) as unknown as Record<string, unknown>;
        },
        getResource(): never {
          throw new Error("Not implemented");
        },
        setResource(): never {
          throw new Error("Not implemented");
        },
        deleteResource(): never {
          throw new Error("Not implemented");
        },
      },
    });

    // Offer the tide widget to chart plotters (src/plotter-extension.ts)
    app.registerResourceProvider({
      type: "plotterExtensions",
      methods: {
        async listResources() {
          return { [PLOTTER_EXTENSION_ID]: plotterExtensionManifest };
        },
        async getResource(id: string) {
          if (id !== PLOTTER_EXTENSION_ID) {
            throw new Error(`No such plotterExtensions resource: ${id}`);
          }
          return plotterExtensionManifest;
        },
        setResource(): never {
          throw new Error("Read-only resource");
        },
        deleteResource(): never {
          throw new Error("Read-only resource");
        },
      },
    });

    app.subscriptionmanager.subscribe(
      {
        context: ("vessels." + app.selfId) as Context,
        subscribe: [
          {
            path: "navigation.position" as Path,
            period: UPDATE_INTERVAL,
            policy: "fixed",
          },
        ],
      },
      unsubscribes,
      (subscriptionError) => {
        app.error("Error:" + subscriptionError);
      },
      updatePosition,
    );

    // Compensate every depth reading as it arrives, rather than waiting for the
    // next tide update. Tide predictions change slowly, so computing the water
    // level for each depth tick is cheap enough.
    app.subscriptionmanager.subscribe(
      {
        context: ("vessels." + app.selfId) as Context,
        subscribe: [
          {
            path: "environment.depth.belowSurface" as Path,
            policy: "instant",
          },
        ],
      },
      unsubscribes,
      (subscriptionError) => {
        app.error("Error:" + subscriptionError);
      },
      updateDepth,
    );

    async function resolvePredictor(
      report = reportLookupFailure,
    ): Promise<Predictor | null> {
      let failed = false;
      if (config.defaultStation && config.defaultStation !== "auto") {
        try {
          const station = await findStation(config.defaultStation);
          if (hasTideModel(station)) return station;
          throw new Error("Station has no tide predictions");
        } catch (e: unknown) {
          failed = true;
          report(
            `Could not load tide station ${config.defaultStation}: ${errorMessage(e)}`,
          );
        }
      }
      if (lastPosition) {
        try {
          return await nearestStation({
            ...lastPosition,
            maxDistance: MAX_STATION_KM,
          });
        } catch (e: unknown) {
          if (isNoStationNearby(e)) {
            // A status would replace the error about the saved station
            if (!stopped && !failed) {
              app.setPluginStatus(
                `No tide station within ${MAX_STATION_KM} km of the vessel`,
              );
            }
            return null;
          }
          report(
            `Could not find a tide station near vessel position: ${errorMessage(e)}`,
          );
        }
      }
      return null;
    }

    function reportLookupFailure(message: string) {
      if (stopped) return;
      app.error(message);
      app.setPluginError(message);
    }

    function forecastStatus({ station, distance }: Forecast) {
      return distance === undefined
        ? "Updated tide forecast"
        : `Updated tide forecast from ${station.name}, ${Math.round(distance)} km away`;
    }

    function forecastFor(predictor: Predictor): Forecast {
      const now = new Date();
      return predictor.getExtremesPrediction({
        start: now,
        end: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      });
    }

    // Runs from a timer and a delta callback, which both drop its promise, so
    // it must never reject.
    async function updatePosition() {
      try {
        const newPosition = app.getSelfPath("navigation.position.value");

        // New position received, save it to the cache
        if (newPosition) {
          lastPosition = newPosition as Position | null;
          // Writes run in turn and each saves the newest position, so an older
          // one can't land last
          positionWrite = positionWrite
            .catch(() => {})
            .then(() => cache.set("position", lastPosition));
          await positionWrite;
        }

        // No last known position, try to load from cache.
        if (!lastPosition) {
          const cached = (await cache.get("position")) as Position | undefined;
          // A delta may have set a newer position during the read
          lastPosition ??= cached ?? null;
        }
      } catch (e: unknown) {
        app.error(`Could not update cached position: ${errorMessage(e)}`);
      }

      // A configured default station predicts without a position
      await updateForecast();
    }

    function updateDepth() {
      const depth = app.getSelfPath("environment.depth.belowSurface.value");
      if (typeof depth !== "number" || !Number.isFinite(depth)) return;

      lastDepth = { value: depth, time: new Date() };
      publishCompensatedDepth(lastDepth.value, lastDepth.time);
    }

    function publishCompensatedDepth(depth: number, time: Date) {
      if (!lastPredictor) return;

      // Without a chart datum Slackwater measures from MSL, which sits above chart
      // datum, so the depth would read deeper than the chart.
      const level = lastForecast?.datum ? waterLevelAt(time) : null;

      const delta: Delta = {
        context: ("vessels." + app.selfId) as Context,
        updates: [
          {
            timestamp: time.toISOString() as Timestamp,
            values: [
              {
                path: COMPENSATED_DEPTH_PATH,
                value: level === null ? null : depth - level,
              },
            ],
          },
        ],
      };

      if (app.debug.enabled) {
        app.debug("Sending delta: " + JSON.stringify(delta));
      }
      app.handleMessage(plugin.id, delta);
    }

    function waterLevelAt(time: Date): number | null {
      if (!lastPredictor) return null;

      try {
        return lastPredictor.getWaterLevelAtTime({ time }).level;
      } catch {
        return null;
      }
    }

    async function updateForecast() {
      const update = ++latestUpdate;

      try {
        let lookupFailed = false;
        const predictor = await resolvePredictor((message) => {
          lookupFailed = true;
          reportLookupFailure(message);
        });

        // The first lookup waits for the database, so a newer update or stop()
        // can overtake this one.
        if (stopped || update !== latestUpdate) return;

        if (!predictor) {
          app.debug(
            "No position or default station available, cannot compute tide data",
          );
          // Once per loss, and once after a restart, which can't tell what the
          // run before it published
          if (!tidesCleared) clearTides();
          tidesCleared = true;
          lastForecast = null;
          lastPredictor = null;
          return;
        }

        lastForecast = forecastFor(predictor);
        lastPredictor = predictor;
        tidesCleared = false;
        // A fallback keeps the lookup's error showing
        if (!lookupFailed) app.setPluginStatus(forecastStatus(lastForecast));
        updateTides();

        // Replay a depth reading received before the predictor was ready.
        if (lastDepth) {
          publishCompensatedDepth(lastDepth.value, lastDepth.time);
        }
      } catch (e: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app.setPluginError((e as any).message);
        // @ts-expect-error: TODO[TS] this accepts more than just a string: https://github.com/bkeepers/signalk-server/blob/d6845ee1f915e6b729d66d2b08b15dc2e0da8e51/src/interfaces/plugins.ts#L517-L519
        app.error(e);
      }
    }

    // Signal K keeps a path's last value, so a tide that no longer applies has
    // to be cleared or it stays on displays, frozen.
    function clearTides() {
      app.handleMessage(plugin.id, {
        context: ("vessels." + app.selfId) as Context,
        updates: [
          {
            timestamp: new Date().toISOString() as Timestamp,
            values: [...TIDE_PATHS, COMPENSATED_DEPTH_PATH].map((path) => ({
              path,
              value: null,
            })),
          },
        ],
      });
    }

    function updateTides(now = new Date()) {
      if (!lastForecast || !lastPredictor) return;

      // Get the next two upcoming extremes
      const nextTides = lastForecast.extremes
        .filter(({ time }) => time >= now)
        .slice(0, 2);

      const heightNow = lastPredictor.getWaterLevelAtTime({ time: now }).level;

      const state = tideStateAt(lastForecast.extremes, now);
      const secondsToNextExtreme = timeToNextExtreme(
        lastForecast.extremes,
        now,
      );

      const delta: Delta = {
        context: ("vessels." + app.selfId) as Context,
        updates: [
          {
            timestamp: now.toISOString() as Timestamp,
            values: [
              {
                path: "environment.tide.stationName" as Path,
                value: lastForecast.station.name,
              },
              // Null for a configured station, which isn't chosen by distance
              {
                path: "environment.tide.stationDistance" as Path,
                value:
                  lastForecast.distance === undefined
                    ? null
                    : lastForecast.distance * 1000,
              },
              // Slackwater gives heights above MSL for a station with no chart datum
              {
                path: "environment.tide.datum" as Path,
                value: lastForecast.datum ?? "MSL",
              },
              {
                path: "environment.tide.heightNow" as Path,
                value: heightNow,
              },
              // Omitted (not null) when the forecast has no upcoming extreme,
              // matching how the nextTides flatMap below goes empty.
              ...(state !== null
                ? [{ path: "environment.tide.state" as Path, value: state }]
                : []),
              ...(secondsToNextExtreme !== null
                ? [
                    {
                      path: "environment.tide.timeToNextExtreme" as Path,
                      value: secondsToNextExtreme,
                    },
                  ]
                : []),
              ...nextTides.flatMap(({ label, time, level }) => {
                return [
                  {
                    path: `environment.tide.height${label}` as Path,
                    value: level,
                  },
                  {
                    path: `environment.tide.time${label}` as Path,
                    value: time.toISOString(),
                  },
                ];
              }),
            ],
          },
          {
            timestamp: now.toISOString() as Timestamp,
            meta: [
              {
                path: "environment.tide.state" as Path,
                value: {
                  description:
                    "Tide trend at the current position: rising or falling",
                },
              },
              {
                path: "environment.tide.datum" as Path,
                value: {
                  description:
                    "Vertical datum of the tide heights and environment.depth.belowChartDatum: the station's chart datum, such as MLLW, LAT or CD. MSL when the station has none, and then only the heights use it.",
                },
              },
              {
                path: COMPENSATED_DEPTH_PATH,
                value: {
                  units: "m",
                  description:
                    "Depth below the chart datum named in environment.tide.datum, or null when the station has no chart datum",
                },
              },
              {
                path: "environment.tide.stationDistance" as Path,
                value: {
                  units: "m",
                  description:
                    "Distance from the vessel to the station it was given",
                },
              },
              {
                path: "environment.tide.timeToNextExtreme" as Path,
                value: {
                  units: "s",
                  description:
                    "Seconds until the next tide extreme (high or low water)",
                },
              },
            ],
          },
        ],
      };

      if (app.debug.enabled) {
        app.debug("Sending delta: " + JSON.stringify(delta));
      }
      app.handleMessage(plugin.id, delta);
    }

    // Perform initial update on startup after short delay to allow gnss position to be populated
    const startupTimer = setTimeout(updatePosition, 4000);
    unsubscribes.push(() => clearTimeout(startupTimer));
    // Recompute the current height and next tides every minute
    const updateTimer = setInterval(updateTides, UPDATE_INTERVAL);
    unsubscribes.push(() => clearInterval(updateTimer));
  }

  return plugin;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function stationTitle(station: Predictor): string {
  const where = [station.region, station.country].filter(Boolean).join(", ");
  const distance =
    station.distance != null ? ` — ${station.distance.toFixed(1)} km` : "";
  return `${station.name}${where ? ` (${where})` : ""}${distance}`;
}
