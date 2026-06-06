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
import type {
  SignalKApp,
  Config,
  ExtremesResponse,
  PositionOptions,
} from "./types.js";
import { approximateTideHeightAt, tideStateAt, timeToNextExtreme } from "./calculations.js";
import FileCache from "./cache.js";
import createSources from "./sources/index.js";
import { createAdapterRoutes } from "./routes.js";
import { withVesselPosition } from "./middleware.js";

export default function (app: SignalKApp): Plugin {
  // Interval to update tide data
  const defaultPeriod = 60; // 1 hour
  let unsubscribes: (() => void)[] = [];
  let activeRouter: RequestHandler | null = null;

  const sources = createSources(app);

  const MOUNT_PATH = "/signalk/v2/api/tides";

  // Mount forwarding middleware once (Express doesn't support unmounting)
  // @ts-expect-error: app is an Express app at runtime
  app.use(MOUNT_PATH, (req, res, next) => {
    if (activeRouter) {
      activeRouter(req, res, next);
    } else {
      next();
    }
  });

  const plugin: Plugin = {
    id: "tides",
    name: "Tides",
    description: "Tidal predictions for the vessel's position from various online sources.",
    schema: () => ({
      title: "Tides API",
      type: "object",
      properties: {
        source: {
          title: "Data source",
          type: "string",
          anyOf: sources.map(({ id, title }) => ({
            const: id,
            title,
          })),
          default: sources[0].id,
        },
        // Update plugin schema with sources
        ...sources.reduce(
          (properties, source) => Object.assign(properties, source.properties ?? {}),
          {}
        ),
        period: {
          title: "Update frequency",
          type: "number",
          description: "How often to update tide forecast (minutes)",
          default: 60,
          minimum: 1,
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

  async function start(props: Config) {
    if (app.debug.enabled) {
      app.debug("Starting tides-api: " + JSON.stringify(props));
    }

    let lastForecast: ExtremesResponse | null = null;
    let lastPosition: Position | null = null;
    const cache = new FileCache(app.getDataDirPath());

    // Use the selected source, or the first one if not specified
    const source =
      sources.find((source) => source.id === props.source) || sources[0];

    // Load the selected source
    const provider = await source.start(props);

    const getDefaultPosition = () => lastPosition;

    // Resolve vessel/current to the nearest station the active source can
    // serve. Using the provider (rather than a fixed database) keeps the
    // redirect target valid for whichever source is selected.
    const findNearestStation = async (position: PositionOptions) => {
      if (!provider.stationsNear) return null;
      const [nearest] = await Promise.resolve(
        provider.stationsNear({ ...position, maxResults: 1 }),
      );
      return nearest ?? null;
    };

    // Set active router based on source
    if (source.id === "neaps") {
      const neapsRoutes = createRoutes({ prefix: MOUNT_PATH });
      // Cast needed: @neaps/api bundles its own Express types that conflict with local ones
      activeRouter = withVesselPosition(
        neapsRoutes as unknown as RequestHandler,
        getDefaultPosition,
        findNearestStation,
      );
    } else {
      activeRouter = withVesselPosition(
        createAdapterRoutes(provider),
        getDefaultPosition,
        findNearestStation,
      );
    }

    // Register the source as a resource provider
    app.registerResourceProvider({
      type: "tides",
      methods: {
        async listResources() {
          if (!lastPosition) throw new Error("No position available");
          const now = new Date();
          const result = await provider.getExtremesPrediction({
            latitude: lastPosition.latitude,
            longitude: lastPosition.longitude,
            start: now,
            end: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
          });
          return result as unknown as Record<string, unknown>;
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
            period: (props.period ?? defaultPeriod) * 60 * 1000,
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

    async function updatePosition() {
      lastPosition =
        (app.getSelfPath("navigation.position.value") as Position | undefined) ||
        ((await cache.get("position")) as Position | undefined) ||
        null;

      if (lastPosition) {
        await cache.set("position", lastPosition);
        await updateForecast();
      }
    }

    async function updateForecast() {
      if (!lastPosition) {
        app.debug("No position available, cannot fetch tide data");
        return;
      }

      try {
        const now = new Date();
        lastForecast = await provider.getExtremesPrediction({
          latitude: lastPosition.latitude,
          longitude: lastPosition.longitude,
          start: now,
          end: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        });
        app.setPluginStatus("Updated tide forecast from " + source.title);
        updateTides();
      } catch (e: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app.setPluginError((e as any).message);
        // @ts-expect-error: TODO[TS] this accepts more than just a string: https://github.com/bkeepers/signalk-server/blob/d6845ee1f915e6b729d66d2b08b15dc2e0da8e51/src/interfaces/plugins.ts#L517-L519
        app.error(e);
      }
    }

    async function updateTides(now = new Date()) {
      if (!lastForecast) return;
      // Get the next two upcoming extremes
      const nextTides = lastForecast.extremes
        .filter(({ time }) => time >= now)
        .slice(0, 2);

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
                value: approximateTideHeightAt(lastForecast.extremes, now),
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
                  { path: `environment.tide.height${label}` as Path, value: level },
                  { path: `environment.tide.time${label}` as Path, value: time.toISOString() },
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
    delay(4000).then(updatePosition);
    // Update every minute
    setInterval(updateTides, 60 * 1000);
  }

  function delay(time: number) {
    return new Promise((resolve) => setTimeout(resolve, time));
  }

  return plugin;
}
