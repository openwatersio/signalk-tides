// Thin Plotter Extensions host helpers for the tide-graph widget and its config
// panel. The widget is a guest inside a host iframe: it connects to the host
// over the JSON-RPC bus for the display-unit preference (`units.get`), its
// per-instance config (the graph window, via `state`), and the press-and-hold
// gesture that opens the config panel. Every host interaction is optional and
// degrades quietly — a host missing a capability, or no host at all, leaves the
// widget running with sensible defaults, never a thrown error.

import { connectExtension, type ExtensionClient } from "signalk-plotterext-bus/extension";
import { getDefaultUnits, type Units } from "@neaps/react";
import { useEffect, useState } from "react";

// How much of the forecast the graph shows. Kept short (12h–3 days): the curve
// stays legible in a 2x1 tile, and more just crowds the extreme labels into an
// unreadable smear.
export type GraphWindow = "12h" | "24h" | "48h" | "72h";

export const DEFAULT_WINDOW: GraphWindow = "24h";

export const WINDOW_OPTIONS: { value: GraphWindow; label: string }[] = [
  { value: "12h", label: "12 hours" },
  { value: "24h", label: "1 day" },
  { value: "48h", label: "2 days" },
  { value: "72h", label: "3 days" },
];

export const WINDOW_DAYS: Record<GraphWindow, number> = {
  "12h": 0.5,
  "24h": 1,
  "48h": 2,
  "72h": 3,
};

const WINDOW_VALUES = new Set<string>(Object.keys(WINDOW_DAYS));

export function coerceWindow(value: unknown): GraphWindow {
  return typeof value === "string" && WINDOW_VALUES.has(value)
    ? (value as GraphWindow)
    : DEFAULT_WINDOW;
}

// Which location's tides the graph shows: the vessel's position (default), or
// whatever point is currently centred in the host's chart. Chart-follow needs
// the host's `map` capability; it degrades to vessel when unavailable.
export type LocationMode = "vessel" | "chart";

export const DEFAULT_LOCATION_MODE: LocationMode = "vessel";

export const LOCATION_OPTIONS: { value: LocationMode; label: string }[] = [
  { value: "vessel", label: "Vessel position" },
  { value: "chart", label: "Chart centre" },
];

export function coerceLocationMode(value: unknown): LocationMode {
  return value === "chart" ? "chart" : DEFAULT_LOCATION_MODE;
}

export interface MapCenter {
  latitude: number;
  longitude: number;
}

export interface WidgetConfig {
  graphWindow: GraphWindow;
  locationMode: LocationMode;
}

const LONG_PRESS_MS = 1500;
const CONNECT_TIMEOUT_MS = 4000;

/**
 * Connect to the host, tolerating the standalone case (opened outside a host,
 * or a host that never answers): resolves to null after a short timeout rather
 * than hanging. Recoverable — the caller falls back to defaults.
 */
export async function connectHost(): Promise<ExtensionClient | null> {
  try {
    // If the handshake resolves after the timeout, we've already returned null
    // to the caller — close that late client so it (and its listeners/ports)
    // doesn't leak for the life of the page.
    let settled = false;
    const connecting = connectExtension().then((client) => {
      if (settled) client?.close();
      return client;
    });
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), CONNECT_TIMEOUT_MS),
    );
    const result = await Promise.race([connecting, timeout]);
    settled = true;
    return result;
  } catch (err) {
    console.warn("tide-graph: host connect failed", err);
    return null;
  }
}

export function hasCapability(client: ExtensionClient, cap: string): boolean {
  return typeof client.hasCapability !== "function" || client.hasCapability(cap);
}

function mapDepthUnit(depth: unknown): Units | null {
  if (depth === "foot") return "feet";
  if (depth === "m") return "meters";
  return null;
}

/**
 * Resolve the depth unit the graph should display in. Prefers the host's
 * `units.get` (the host derives it from the server's Unit Preferences); falls
 * back to the server's active preset over same-origin REST — the same source
 * the webapp's useUnitPreferences hook reads — and finally the locale default.
 */
export async function resolveUnits(client: ExtensionClient | null): Promise<Units> {
  const fallback = getDefaultUnits(navigator.language);

  if (client && hasCapability(client, "units")) {
    try {
      const res = (await client.call("units.get")) as {
        units?: { depth?: unknown };
      };
      const mapped = mapDepthUnit(res?.units?.depth);
      if (mapped) return mapped;
    } catch (err) {
      console.warn("tide-graph: units.get failed", err);
    }
  }

  // Bounded: the widget blocks on this before it can render, so a server that
  // accepts the connection but never answers must not wedge it on "Loading".
  // An abort is just another failure — fall through to the locale default.
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
  try {
    const res = await fetch("/signalk/v1/unitpreferences/active", {
      credentials: "include",
      signal: controller.signal,
    });
    if (res.ok) {
      const body = (await res.json()) as {
        categories?: { depth?: { targetUnit?: unknown } };
      };
      const mapped = mapDepthUnit(body?.categories?.depth?.targetUnit);
      if (mapped) return mapped;
    }
  } catch (err) {
    console.warn("tide-graph: unit preferences fetch failed", err);
  } finally {
    clearTimeout(abortTimer);
  }

  return fallback;
}

/** Read this widget instance's persisted config (window + location mode). */
export async function readConfig(
  client: ExtensionClient | null,
): Promise<WidgetConfig> {
  const defaults: WidgetConfig = {
    graphWindow: DEFAULT_WINDOW,
    locationMode: DEFAULT_LOCATION_MODE,
  };
  if (!client) return defaults;
  try {
    const stored = await client.state.get(["window", "locationMode"]);
    return {
      graphWindow: coerceWindow(stored?.window),
      locationMode: coerceLocationMode(stored?.locationMode),
    };
  } catch (err) {
    console.warn("tide-graph: state.get failed", err);
    return defaults;
  }
}

// Rounded to ~0.01° (~1 km) so tiny pans don't churn the tide query key; the
// nearest-station resolution is coarser than that anyway.
const CENTER_PRECISION = 100;

function roundCenter(c: MapCenter): MapCenter {
  return {
    latitude: Math.round(c.latitude * CENTER_PRECISION) / CENTER_PRECISION,
    longitude: Math.round(c.longitude * CENTER_PRECISION) / CENTER_PRECISION,
  };
}

/**
 * Extract the chart centre from a map view payload (`map.getView` result or a
 * `map.view` event — both carry the same `{ center, zoom, bounds }` shape). FSK
 * gives `center` as `[lon, lat]`. Returns null on any unexpected shape.
 */
export function parseCenter(view: unknown): MapCenter | null {
  const c = (view as { center?: unknown } | null)?.center;
  if (
    Array.isArray(c) &&
    c.length >= 2 &&
    typeof c[0] === "number" &&
    typeof c[1] === "number"
  ) {
    return roundCenter({ longitude: c[0], latitude: c[1] });
  }
  return null;
}

/**
 * Read the host chart's current centre via `map.getView` — used for the initial
 * view and as the poll fallback on hosts without the `map.view` event. Returns
 * null (and warns) on failure so the widget falls back to the vessel.
 */
export async function readMapCenter(
  client: ExtensionClient,
): Promise<MapCenter | null> {
  try {
    return parseCenter(await client.call("map.getView"));
  } catch (err) {
    console.warn("tide-graph: map.getView failed", err);
    return null;
  }
}

/**
 * Detect a press-and-hold anywhere in the widget iframe and ask the host to
 * open the config panel. Pointer events inside a sandboxed iframe are invisible
 * to the host, so the gesture is recognised here. Returns a cleanup function.
 */
export function installLongPress(client: ExtensionClient): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const start = () => {
    cancel();
    timer = setTimeout(() => {
      client.call("ui.openConfigPanel").catch(() => {});
    }, LONG_PRESS_MS);
  };
  window.addEventListener("pointerdown", start);
  window.addEventListener("pointerup", cancel);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("pointerleave", cancel);
  return () => {
    cancel();
    window.removeEventListener("pointerdown", start);
    window.removeEventListener("pointerup", cancel);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("pointerleave", cancel);
  };
}

export interface HostState {
  units: Units;
  graphWindow: GraphWindow;
  locationMode: LocationMode;
  /** Chart centre while following the map (location mode `chart`); else null. */
  mapCenter: MapCenter | null;
  ready: boolean;
}

// Fallback poll interval for older hosts that expose `map` but don't emit the
// `map.view` event. Kept slow (the spec's guidance) — event-capable hosts stop
// it after the first event.
const MAP_FALLBACK_POLL_MS = 15000;

/**
 * React hook wiring the widget to its host: resolves units + config once
 * connected, follows `state.changed` (config-panel saves) to re-read window and
 * location mode live, installs the long-press gesture, and — while in
 * chart-follow mode on a host with the `map` capability — tracks the charted
 * area. Renders immediately with defaults and refines as the host answers.
 */
export function useTideGraphHost(): HostState {
  const [client, setClient] = useState<ExtensionClient | null>(null);
  const [core, setCore] = useState({
    units: getDefaultUnits(navigator.language),
    graphWindow: DEFAULT_WINDOW,
    locationMode: DEFAULT_LOCATION_MODE,
    ready: false,
  });
  const [mapCenter, setMapCenter] = useState<MapCenter | null>(null);

  useEffect(() => {
    let cancelled = false;
    let removeLongPress: (() => void) | null = null;
    let unsubscribe: (() => Promise<void>) | null = null;
    let established: ExtensionClient | null = null;

    (async () => {
      const connected = await connectHost();
      if (cancelled) {
        connected?.close();
        return;
      }
      established = connected;

      const [units, config] = await Promise.all([
        resolveUnits(connected),
        readConfig(connected),
      ]);
      if (cancelled) {
        connected?.close();
        return;
      }
      setCore({ units, ...config, ready: true });
      setClient(connected);

      if (!connected) return;
      removeLongPress = installLongPress(connected);

      try {
        unsubscribe = await connected.subscribe(["state.changed"], () => {
          readConfig(connected)
            .then((next) => {
              if (!cancelled) setCore((prev) => ({ ...prev, ...next }));
            })
            .catch(() => {});
        });
      } catch (err) {
        console.warn("tide-graph: state.changed subscribe failed", err);
      }
    })();

    return () => {
      cancelled = true;
      removeLongPress?.();
      // Close the connection too, not just its listeners: a remounted widget
      // would otherwise accumulate bus ports for the life of the page.
      Promise.resolve(unsubscribe?.())
        .catch(() => {})
        .finally(() => established?.close());
    };
  }, []);

  // Track the chart centre while following the map on a capable host. Primary
  // path is the `map.view` viewport event (FSK 3.1+): responsive, fires once per
  // settled pan/zoom. The first event proves the host emits them, so the slow
  // `map.getView` fallback poll — kept only for older hosts that expose `map`
  // but not the event — is stopped.
  useEffect(() => {
    if (!client || core.locationMode !== "chart" || !hasCapability(client, "map")) {
      setMapCenter(null);
      return;
    }
    let cancelled = false;
    let unsubscribe: (() => Promise<void>) | null = null;
    let fallbackId: ReturnType<typeof setInterval> | null = null;

    const apply = (c: MapCenter | null) => {
      if (cancelled || !c) return;
      setMapCenter((prev) =>
        prev && prev.latitude === c.latitude && prev.longitude === c.longitude
          ? prev
          : c,
      );
    };
    const stopFallback = () => {
      if (fallbackId !== null) {
        clearInterval(fallbackId);
        fallbackId = null;
      }
    };

    // Initial view.
    readMapCenter(client).then(apply);

    // Primary: follow viewport events.
    client
      .subscribe(["map.view"], (_name, params) => {
        stopFallback();
        apply(parseCenter(params));
      })
      .then((unsub) => {
        if (cancelled) unsub().catch(() => {});
        else unsubscribe = unsub;
      })
      .catch((err) =>
        console.warn("tide-graph: map.view subscribe failed", err),
      );

    // Fallback poll for hosts without `map.view`; cancelled on the first event.
    fallbackId = setInterval(() => {
      readMapCenter(client).then(apply);
    }, MAP_FALLBACK_POLL_MS);

    return () => {
      cancelled = true;
      stopFallback();
      unsubscribe?.().catch(() => {});
    };
  }, [client, core.locationMode]);

  return { ...core, mapCenter };
}
