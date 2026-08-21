// The 2x1 "Tide Cycle (Advanced)" widget: the same multi-day harmonic curve the
// webapp draws, but static — a widget is a guest on the chart, not an app, so
// there is no scrolling, no "Now" button, and no tooltip. We compose the
// low-level static pieces @neaps/react exports (the pure <TideGraphChart> SVG
// plus the timeline/extremes data hooks) instead of the interactive <TideGraph>
// wrapper. Data comes from the plugin's own Neaps API over same-origin REST —
// exactly the path app/App.tsx uses — so this is real harmonic fidelity.

import {
  NeapsProvider,
  TideGraphChart,
  useContainerSize,
  useCurrentLevel,
  useExtremes,
  useTimeline,
  type Extreme,
  type TimelineEntry,
  type Units,
  type UseTimelineParams,
} from "@neaps/react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  WINDOW_DAYS,
  useTideGraphHost,
  type GraphWindow,
  type LocationMode,
  type MapCenter,
} from "./host";

// The server-side `vessel/default` alias: the plugin's middleware resolves it
// (via a 303 redirect) to the configured station, or the one nearest the
// vessel's position. Same alias the webapp uses (app/hooks/useStationId.ts).
const VESSEL_STATION_ID = "vessel/default";
const { VITE_SIGNALK_URL = window.location.toString() } = import.meta.env;
const API_BASE_URL = new URL("/signalk/v2/api", VITE_SIGNALK_URL).toString();

const MIN_GRAPH_HEIGHT = 72;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// A little past-time so "now" isn't pinned hard against the left edge.
const LOOKBACK_MS = HOUR_MS;

// TideGraphChart draws the current time/level readout centred vertically
// (`labelY = innerH / 2`), which in a short 2x1 tile sits right on top of the
// curve. There is no prop for it, so we shift just that label down via CSS (see
// `--tide-readout-shift` in widgets.css) to sit near the bottom edge instead.
// These mirror the chart's own layout constants; if they drift, the readout is
// merely offset differently — nothing breaks.
const CHART_MARGIN_TOP = 65;
const CHART_MARGIN_BOTTOM = 40;
const READOUT_HALF_HEIGHT = 18;
const READOUT_BOTTOM_GAP = 3;

/** How far to push the readout down so it clears the bottom edge by 3px. */
function readoutShift(graphHeight: number): number {
  const innerH = Math.max(
    0,
    graphHeight - CHART_MARGIN_TOP - CHART_MARGIN_BOTTOM,
  );
  const target =
    innerH + CHART_MARGIN_BOTTOM - READOUT_BOTTOM_GAP - READOUT_HALF_HEIGHT;
  return Math.max(0, target - innerH / 2);
}

const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const EMPTY_TIMELINE: TimelineEntry[] = [];
const EMPTY_EXTREMES: Extreme[] = [];
const NOOP = () => {};

function hourBucketNow() {
  return Math.floor((Date.now() - LOOKBACK_MS) / HOUR_MS);
}

// Forecast range floored to the hour, so the query key (and cache) stays stable
// between renders — but it creeps forward as real time advances so a widget left
// running for days doesn't freeze at its mount time. A once-a-minute tick only
// bumps state when the hour bucket actually changes (i.e. at most hourly), so
// the range moves without churning the cache every minute. The "now" marker
// still tracks real time continuously via useCurrentLevel.
function useForecastRange(days: number) {
  const [bucket, setBucket] = useState(hourBucketNow);

  useEffect(() => {
    const id = setInterval(() => {
      const next = hourBucketNow();
      setBucket((prev) => (prev === next ? prev : next));
    }, 60 * 1000);
    return () => clearInterval(id);
  }, []);

  return useMemo(() => {
    const startMs = bucket * HOUR_MS;
    return {
      start: new Date(startMs).toISOString(),
      end: new Date(startMs + LOOKBACK_MS + days * DAY_MS).toISOString(),
    };
  }, [bucket, days]);
}

function StaticGraph({
  graphWindow,
  locationMode,
  mapCenter,
  units,
}: {
  graphWindow: GraphWindow;
  locationMode: LocationMode;
  mapCenter: MapCenter | null;
  units: Units;
}) {
  const { ref, width, height } = useContainerSize();
  const days = WINDOW_DAYS[graphWindow];
  const { start, end } = useForecastRange(days);

  // Follow the chart centre when asked and a centre is available; otherwise
  // (vessel mode, or chart mode before the first map read) query the vessel's
  // own station via the `vessel/default` alias.
  const params: UseTimelineParams =
    locationMode === "chart" && mapCenter
      ? {
          latitude: mapCenter.latitude,
          longitude: mapCenter.longitude,
          start,
          end,
        }
      : { id: VESSEL_STATION_ID, start, end };

  const timelineQuery = useTimeline(params);
  const extremesQuery = useExtremes(params);

  const timeline = timelineQuery.data?.timeline ?? EMPTY_TIMELINE;
  const extremes = extremesQuery.data?.extremes ?? EMPTY_EXTREMES;
  const station = timelineQuery.data?.station;
  const currentLevel = useCurrentLevel(timeline);

  const graphHeight = Math.max(MIN_GRAPH_HEIGHT, Math.round(height) || 0);
  // Both halves are required: the curve without its high/low markers is a
  // misleading partial chart, so a failed extremes query is "unavailable", not
  // a graph to draw.
  const hasData = width > 0 && timeline.length > 0 && extremes.length > 0;
  const failed = timelineQuery.isError || extremesQuery.isError;

  return (
    <div
      ref={ref}
      className="tide-graph-fill"
      style={
        {
          "--tide-readout-shift": `${readoutShift(graphHeight)}px`,
        } as CSSProperties
      }
    >
      {hasData ? (
        <>
          <TideGraphChart
            timeline={timeline}
            extremes={extremes}
            timezone={station?.timezone ?? LOCAL_TZ}
            units={units}
            svgWidth={width}
            height={graphHeight}
            latitude={station?.latitude}
            longitude={station?.longitude}
            activeEntry={currentLevel ?? undefined}
            onSelect={NOOP}
            className="tide-graph-svg"
          />
          {station?.name && (
            <div className="tide-graph-station">{station.name}</div>
          )}
        </>
      ) : (
        <div className="tide-graph-placeholder">
          {failed ? "Tide data unavailable" : "Loading tide graph…"}
        </div>
      )}
    </div>
  );
}

export function TideGraphWidget() {
  // `units` feeds the Neaps request, so wait until the host has answered before
  // mounting the provider — otherwise it fetches with the locale default and
  // then refetches (the chart flips units) once the real preference resolves.
  const { units, graphWindow, locationMode, mapCenter, ready } =
    useTideGraphHost();

  return (
    <div className="tide-graph-root">
      {ready ? (
        <NeapsProvider baseUrl={API_BASE_URL} units={units}>
          <StaticGraph
            graphWindow={graphWindow}
            locationMode={locationMode}
            mapCenter={mapCenter}
            units={units}
          />
        </NeapsProvider>
      ) : (
        <div className="tide-graph-placeholder">Loading tide graph…</div>
      )}
    </div>
  );
}
