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

import { Context, Delta, Path, Plugin, Position, Timestamp } from "@signalk/server-api";
import { RequestHandler } from "express";
import { createRoutes } from "@neaps/api";
import { getExtremesPrediction, getWaterLevelAtTime } from "neaps";
import type { SignalKApp } from "./types.js";
import { tideStateAt, timeToNextExtreme } from "./calculations.js";
import FileCache from "./cache.js";
import { withVesselPosition } from "./middleware.js";

type Forecast = ReturnType<typeof getExtremesPrediction>;

// Recompute and republish on a fixed interval. Predictions are computed locally
// by neaps, so this is cheap and needs no configuration.
const UPDATE_INTERVAL = 60 * 1000; // 1 minute
const API_PATH = "/signalk/v2/api/tides";

export default function (app: SignalKApp): Plugin {
  let unsubscribes: (() => void)[] = [];
  let activeRouter: RequestHandler | null = null;

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
      properties: {},
    }),
    start,
    stop() {
      unsubscribes.forEach((f) => f());
      unsubscribes = [];
      activeRouter = null;
    },
  };

  async function start() {
    app.debug("Starting tides");

    let lastForecast: Forecast | null = null;
    let lastPosition: Position | null = null;
    const cache = new FileCache(app.getDataDirPath());

    // Mount the Neaps API, with vessel/current resolved to the nearest station.
    activeRouter = withVesselPosition(
      createRoutes({ prefix: API_PATH }),
      () => lastPosition,
    );

    // Register tide predictions as a resource provider
    app.registerResourceProvider({
      type: "tides",
      methods: {
        async listResources() {
          if (!lastPosition) throw new Error("No position available");
          return forecastFor(lastPosition) as unknown as Record<
            string,
            unknown
          >;
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

    function forecastFor(position: Position): Forecast {
      const now = new Date();
      return getExtremesPrediction({
        latitude: position.latitude,
        longitude: position.longitude,
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

      if (lastPosition) updateForecast();
    }

    function updateForecast() {
      if (!lastPosition) {
        app.debug("No position available, cannot compute tide data");
        return;
      }

      try {
        lastForecast = forecastFor(lastPosition);
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
      if (!lastForecast || !lastPosition) return;
      // Get the next two upcoming extremes
      const nextTides = lastForecast.extremes
        .filter(({ time }) => time >= now)
        .slice(0, 2);

      const heightNow = getWaterLevelAtTime({
        latitude: lastPosition.latitude,
        longitude: lastPosition.longitude,
        time: now,
      }).level;

      const state = tideStateAt(lastForecast.extremes, now);
      const secondsToNextExtreme = timeToNextExtreme(lastForecast.extremes, now);

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
                ? [{ path: "environment.tide.timeToNextExtreme" as Path, value: secondsToNextExtreme }]
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
                value: { description: "Tide trend at the current position: rising or falling" },
              },
              {
                path: "environment.tide.timeToNextExtreme" as Path,
                value: { units: "s", description: "Seconds until the next tide extreme (high or low water)" },
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
