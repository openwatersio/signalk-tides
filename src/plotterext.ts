/*
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

// Plotter Extensions provider: contributes a single 2x1 "Tide Graph" widget to
// chart-plotter web apps (Freeboard-SK and any other Plotter Extensions host).
// The widget is a sandboxed iframe served from a public static route; it reuses
// the plugin's own Neaps API for the full multi-day harmonic curve. This is a
// read-only provider whose one resource is the extension manifest — no user
// data, purely additive, and it touches none of the existing deltas, the Neaps
// API, or the `tides` resource.
//
// Registration lives here (compiled into the plugin's `dist/`) rather than
// under `widgets/` because the plugin's flat `dist/` output layout depends on
// `src/` being the sole TypeScript rootDir; the browser widget source and its
// build live under `widgets/`.

import express from "express";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerAPI } from "@signalk/server-api";

const require = createRequire(import.meta.url);

// Manifest key = package name; the Signal K plugin id is `tides`.
export const PACKAGE_NAME = "signalk-tides";
const ASSET_BASE = `/plotterext/${PACKAGE_NAME}`;
const CONFIG_PANEL_ID = "graph-config";

// Built widget iframe assets. From dist/plotterext.js this resolves to the
// package's widgets/dist directory (built by `vite --config widgets/vite.config.mts`).
const WIDGET_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "widgets",
  "dist",
);

function packageVersion(): string | undefined {
  try {
    return (require("../package.json") as { version?: string }).version;
  } catch {
    return undefined;
  }
}

/**
 * The extension manifest advertised to hosts. Pure and side-effect free so it
 * can be unit-tested directly. `requires: ["widgets"]` only — the widget's data
 * is fetched over same-origin REST (the Neaps API), so it is offered even on
 * hosts that do not relay the Signal K stream. `units` and `panels.iframe` are
 * optional refinements (display-unit preference and the config panel).
 */
export function buildManifest() {
  return {
    name: "Tides",
    description:
      "Tide-curve widget for the vessel's position, powered by Neaps.",
    version: packageVersion(),
    apiVersion: "1",
    requires: ["widgets"],
    // `map` lets the widget optionally follow the charted area instead of the
    // vessel (map.getView); hosts without it just show vessel tides.
    optional: ["units", "panels.iframe", "map"],
    widgets: [
      {
        id: "graph",
        title: "Tide Cycle (Advanced)",
        type: "iframe",
        url: `${ASSET_BASE}/graph.html`,
        size: "2x1",
        configPanel: CONFIG_PANEL_ID,
        lifecycle: "whileEnabled",
      },
    ],
    panels: [
      {
        id: CONFIG_PANEL_ID,
        title: "Tide Cycle Settings",
        type: "iframe",
        url: `${ASSET_BASE}/config.html`,
        lifecycle: "onOpen",
      },
    ],
  };
}

// Express cannot unmount middleware, so guard the static route against a
// second start() (e.g. a disable/enable cycle) mounting it twice.
let assetsMounted = false;

/**
 * Serve the widget assets on a public, non-admin route and register the
 * read-only `plotterExtensions` provider. Call once from the plugin's start().
 */
export function registerTideGraphWidget(app: ServerAPI): void {
  if (!assetsMounted) {
    // @ts-expect-error: app is an Express app at runtime
    if (typeof app.use === "function") {
      // @ts-expect-error: app is an Express app at runtime
      app.use(ASSET_BASE, express.static(WIDGET_DIR));
      assetsMounted = true;
      app.debug(`Serving tide-graph widget assets at ${ASSET_BASE}`);
    }
  }

  app.registerResourceProvider({
    type: "plotterExtensions",
    methods: {
      async listResources() {
        return { [PACKAGE_NAME]: buildManifest() } as unknown as Record<
          string,
          unknown
        >;
      },
      async getResource(id: string) {
        if (id !== PACKAGE_NAME) {
          throw new Error(`No such plotterExtensions resource: ${id}`);
        }
        return buildManifest() as unknown as object;
      },
      setResource(): never {
        throw new Error("signalk-tides plotterExtensions is read-only");
      },
      deleteResource(): never {
        throw new Error("signalk-tides plotterExtensions is read-only");
      },
    },
  });
}
