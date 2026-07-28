// Configuration panel for the tide-graph widget: choose the graph's time
// window and — on a host that exposes its chart view (`map` capability) —
// whether the tides track the vessel or the charted area. Settings persist to
// the target widget instance's host-side state; each save emits `state.changed`,
// which the live widget follows to re-render. Opened by the host on long-press;
// the same host dialog also carries the remove affordance.

import { useEffect, useState } from "react";
import {
  connectHost,
  hasCapability,
  readConfig,
  DEFAULT_LOCATION_MODE,
  DEFAULT_WINDOW,
  LOCATION_OPTIONS,
  WINDOW_OPTIONS,
  type GraphWindow,
  type LocationMode,
} from "./host";
import type { ExtensionClient } from "signalk-plotterext-bus/extension";

export function GraphConfig() {
  const [client, setClient] = useState<ExtensionClient | null>(null);
  const [graphWindow, setGraphWindow] = useState<GraphWindow>(DEFAULT_WINDOW);
  const [locationMode, setLocationMode] = useState<LocationMode>(
    DEFAULT_LOCATION_MODE,
  );
  const [mapSupported, setMapSupported] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let established: ExtensionClient | null = null;
    (async () => {
      const c = await connectHost();
      if (cancelled) {
        c?.close();
        return;
      }
      established = c;
      setClient(c);
      setMapSupported(!!c && hasCapability(c, "map"));
      const config = await readConfig(c);
      if (cancelled) return;
      setGraphWindow(config.graphWindow);
      setLocationMode(config.locationMode);
      setReady(true);
    })();
    return () => {
      cancelled = true;
      // The panel is opened and dismissed repeatedly; close its connection so
      // bus ports don't accumulate across openings.
      established?.close();
    };
  }, []);

  // Persist the whole config each time (safe whether the host merges or
  // replaces state), so window and location mode never clobber each other.
  const persist = (next: { window?: GraphWindow; locationMode?: LocationMode }) => {
    const values = { window: graphWindow, locationMode, ...next };
    client?.state
      .set(values)
      .catch((err) => console.warn("tide-graph config: state.set failed", err));
  };

  return (
    <div className="tide-config">
      <label className="tide-config-label" htmlFor="tide-graph-window">
        Time window
      </label>
      <select
        id="tide-graph-window"
        className="tide-config-select"
        value={graphWindow}
        disabled={!ready}
        onChange={(e) => {
          const value = e.target.value as GraphWindow;
          setGraphWindow(value);
          persist({ window: value });
        }}
      >
        {WINDOW_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <p className="tide-config-hint">
        How many days of the tide forecast the graph shows.
      </p>

      {mapSupported && (
        <>
          <label className="tide-config-label" htmlFor="tide-graph-location">
            Tides for
          </label>
          <select
            id="tide-graph-location"
            className="tide-config-select"
            value={locationMode}
            disabled={!ready}
            onChange={(e) => {
              const value = e.target.value as LocationMode;
              setLocationMode(value);
              persist({ locationMode: value });
            }}
          >
            {LOCATION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="tide-config-hint">
            Show tides for the vessel, or for wherever the chart is centred.
          </p>
        </>
      )}
    </div>
  );
}
