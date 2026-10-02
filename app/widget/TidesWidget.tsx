import { useCallback, useEffect, useRef, useState } from 'react'
import { NeapsProvider, TideConditions } from '@neaps/react'
import { connectExtension, type ExtensionClient } from 'signalk-plotterext-bus/extension'
import { useUnitPreferences } from '../hooks/useUnitPreferences'

const { VITE_SIGNALK_URL = window.location.toString() } = import.meta.env;
const API_BASE_URL = new URL("/signalk/v2/api", VITE_SIGNALK_URL).toString();

// The panel declared in the plugin's plotter extension manifest
// (src/plotter-extension.ts), which shows the full Tides app.
export const TIDES_PANEL = "tides";

// Opened on its own rather than inside a chart plotter, the page has no host
// to answer the handshake; give up on it after this long.
const HOST_HANDSHAKE_TIMEOUT_MS = 5000;

// TideConditions fetches its predictions for half a tide cycle either side of
// the time it mounts. Remount it this often so a widget left on the chart
// keeps the current time inside that window.
export const RECENTER_INTERVAL_MS = 60 * 60 * 1000;

/** A key that changes every RECENTER_INTERVAL_MS. */
function useRecenterKey(): number {
  const [key, setKey] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setKey((k) => k + 1), RECENTER_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);
  return key;
}

// Chart plotters open a widget's settings, where it can also be removed, on a
// press-and-hold of this length. Pointer events inside the widget's iframe
// never reach the host, so the widget detects the gesture itself.
const LONG_PRESS_MS = 1500;

/**
 * Asks the host for this widget's settings on a press-and-hold. Returns whether
 * the latest press was one, so the tap that ends it can be ignored.
 */
function useSettingsGesture(host: ExtensionClient | null): () => boolean {
  const longPressed = useRef(false);
  useEffect(() => {
    if (!host?.hasCapability("widgets")) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      longPressed.current = false;
      timer = setTimeout(() => {
        longPressed.current = true;
        host.call("ui.openConfigPanel").catch(() => {
          // The host could not show the settings; the widget stays as it is.
        });
      }, LONG_PRESS_MS);
    };
    const cancel = () => clearTimeout(timer);
    const ends = ["pointerup", "pointercancel", "pointerleave"] as const;
    window.addEventListener("pointerdown", start);
    ends.forEach((type) => window.addEventListener(type, cancel));
    return () => {
      cancel();
      window.removeEventListener("pointerdown", start);
      ends.forEach((type) => window.removeEventListener(type, cancel));
    };
  }, [host]);
  return useCallback(() => longPressed.current, []);
}

/** The chart plotter hosting this widget, once it has answered the handshake. */
function usePlotterHost(): ExtensionClient | null {
  const [host, setHost] = useState<ExtensionClient | null>(null);
  useEffect(() => {
    let cancelled = false;
    connectExtension({ timeoutMs: HOST_HANDSHAKE_TIMEOUT_MS })
      .then((client) => {
        if (!cancelled) setHost(client);
      })
      .catch(() => {
        // Not inside a chart plotter: the widget shows the tide without the
        // tap that opens the Tides panel.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return host;
}

/**
 * Chart plotter widget: the tide at the vessel's position, with the level now
 * and the next high or low water. Tapping it opens the full Tides app in a
 * plotter panel, where the host supports that.
 */
export function TidesWidget() {
  const { units, ready } = useUnitPreferences();
  const host = usePlotterHost();
  const longPressed = useSettingsGesture(host);
  const recenterKey = useRecenterKey();

  if (!ready) return null;

  const conditions = (
    <TideConditions
      key={recenterKey}
      id="vessel/default"
      fill
      className="h-full"
    />
  );

  return (
    <NeapsProvider baseUrl={API_BASE_URL} units={units}>
      {host?.hasCapability("ui") && host.hasCapability("panels.iframe") ? (
        <button
          type="button"
          aria-label="Open Tides"
          className="block h-full w-full cursor-pointer text-left"
          onClick={() => {
            if (longPressed()) return;
            host
              .call("ui.togglePanel", { panel: TIDES_PANEL })
              .catch(() => {
                // The host could not show the panel; the widget stays as it is.
              });
          }}
        >
          {conditions}
        </button>
      ) : (
        conditions
      )}
    </NeapsProvider>
  );
}
