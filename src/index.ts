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

import { Context, Delta, Path, Plugin, Position, ServerAPI, Timestamp } from "@signalk/server-api";
import { RequestHandler } from "express";
import { createRoutes } from "@neaps/api";
import { findStation, nearestStation, stationsNear } from "neaps";
import { tideStateAt, timeToNextExtreme } from "./calculations.js";
import FileCache from "./cache.js";
import { withVesselPosition } from "./middleware.js";
import { registerTideGraphWidget } from "./plotterext.js";

type Predictor = ReturnType<typeof findStation>;
type Forecast = ReturnType<Predictor["getExtremesPrediction"]>;

interface Config {
  defaultStation?: string;
}

// Recompute and republish on a fixed interval. Predictions are computed locally
// by neaps, so this is cheap and needs no configuration.
const UPDATE_INTERVAL = 60 * 1000; // 1 minute
const API_PATH = "/signalk/v2/api/tides";

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
      "Offline tidal predictions for the vessel's position, powered by Neaps.",
    schema: () => ({
      title: "Tides",
      type: "object",
      properties: {
        defaultStation: {
          type: "string",
          title: "Default tide station",
          description:
            "Use the closest station to the vessel's current position, or pick a default nearby station.",
          default: "auto",
          oneOf: defaultStationOptions(),
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

  function defaultStationOptions(): { const: string; title: string }[] {
    const options = [{ const: "auto", title: "Closest station" }];

    if (lastPosition) {
      for (const station of stationsNear({ ...lastPosition, maxResults: 10 })) {
        options.push({ const: station.id, title: stationTitle(station) });
      }
    }

    // Keep the saved station selectable even when it is not in the nearby
    // list, so opening the settings far from it (or before a position fix)
    // cannot clobber it on save.
    const saved = savedDefaultStation();
    if (saved && saved !== "auto" && !options.some((o) => o.const === saved)) {
      let title = saved;
      try {
        title = stationTitle(findStation(saved));
      } catch {
        // Unknown id: keep the raw value as the label
      }
      options.splice(1, 0, { const: saved, title });
    }

    return options;
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

  async function start(options?: object) {
    app.debug("Starting tides");
    config = (options ?? {}) as Config;

    // Contribute the 2x1 tide-graph widget to Plotter Extensions hosts.
    registerTideGraphWidget(app);

    // Keep the forecast and the predictor that produced it together, so the
    // extremes and the current height are always read from the same station.
    let lastForecast: Forecast | null = null;
    let lastPredictor: Predictor | null = null;
    const cache = new FileCache(app.getDataDirPath());

    // Mount the Neaps API, with vessel/default resolved to the configured
    // default station (or the nearest one).
    activeRouter = withVesselPosition(
      createRoutes({ prefix: API_PATH }),
      () => lastPosition,
      () => config.defaultStation ?? null,
    );

    // Register tide predictions as a resource provider
    app.registerResourceProvider({
      type: "tides",
      methods: {
        async listResources() {
          const predictor = resolvePredictor();
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

    function resolvePredictor(): Predictor | null {
      if (config.defaultStation && config.defaultStation !== "auto") {
        try {
          return findStation(config.defaultStation);
        } catch {
          app.error(
            `Configured tide station not found: ${config.defaultStation}`,
          );
        }
      }
      if (lastPosition) {
        try {
          return nearestStation(lastPosition);
        } catch {
          app.error("No tide station found near vessel position");
        }
      }
      return null;
    }

    function forecastFor(predictor: Predictor): Forecast {
      const now = new Date();
      return predictor.getExtremesPrediction({
        start: now,
        end: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      });
    }

    async function updatePosition() {
      const newPosition = app.getSelfPath("navigation.position.value");

      // New position received, save it to the cache
      if (newPosition) {
        lastPosition = newPosition as Position | null;
        await cache.set("position", lastPosition);
      }

      // No last known position, try to load from cache.
      if (!lastPosition) {
        lastPosition = (await cache.get("position")) as Position;
      }

      // A configured default station predicts without a position
      updateForecast();
    }

    function updateForecast() {
      const predictor = resolvePredictor();
      if (!predictor) {
        app.debug(
          "No position or default station available, cannot compute tide data",
        );
        lastForecast = null;
        lastPredictor = null;
        return;
      }

      try {
        lastForecast = forecastFor(predictor);
        lastPredictor = predictor;
        app.setPluginStatus("Updated tide forecast");
        updateTides();
      } catch (e: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app.setPluginError((e as any).message);
        // @ts-expect-error: TODO[TS] this accepts more than just a string: https://github.com/bkeepers/signalk-server/blob/d6845ee1f915e6b729d66d2b08b15dc2e0da8e51/src/interfaces/plugins.ts#L517-L519
        app.error(e);
      }
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

function stationTitle(station: Predictor): string {
  const where = [station.region, station.country].filter(Boolean).join(", ");
  const distance =
    station.distance != null ? ` — ${station.distance.toFixed(1)} km` : "";
  return `${station.name}${where ? ` (${where})` : ""}${distance}`;
}
