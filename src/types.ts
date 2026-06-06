import { ServerAPI } from "@signalk/server-api";

// Workaround pending an upstream type fix in @signalk/server-api: at runtime
// `app.debug` is a debug-module instance with an `.enabled` property, but
// ServerAPI types it as a bare function. Omit the upstream `debug` member
// before intersecting so the property doesn't collapse to `never`.
export type SignalKApp = Omit<ServerAPI, "debug"> & {
  debug: ServerAPI["debug"] & { enabled: boolean };
};

export type OptionalPromise<T> = T | Promise<T>;

/** Station summary for list/search results */
export interface StationSummary {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  region?: string;
  country?: string;
  continent?: string;
  timezone?: string;
  type?: "reference" | "subordinate";
}

/** Full station detail */
export interface Station extends StationSummary {
  source?: { id: string; name: string; url?: string };
  license?: {
    type: string;
    commercial_use: boolean;
    url?: string;
    notes?: string;
  };
  disclaimers?: string;
  distance?: number;
  datums?: Record<string, number>;
  harmonic_constituents?: {
    name: string;
    amplitude: number;
    phase: number;
  }[];
  defaultDatum?: string;
  offsets?: {
    reference: string;
    height?: { high: number; low: number; type: "ratio" | "fixed" };
    time?: { high: number; low: number };
  };
}

/** A single tide extreme (high or low) */
export interface Extreme {
  time: Date;
  level: number;
  high: boolean;
  low: boolean;
  label: string;
}

export interface PredictionOptions {
  start: Date;
  end: Date;
  datum?: string;
  units?: "meters" | "feet";
}

export interface PositionOptions {
  latitude: number;
  longitude: number;
}

export interface ExtremesResponse {
  datum?: string;
  units?: string;
  station: Station;
  distance?: number;
  extremes: Extreme[];
}

export interface TimelineEntry {
  time: Date;
  level: number;
}

export interface TimelineResponse {
  datum?: string;
  units?: string;
  station: Station;
  distance?: number;
  timeline: TimelineEntry[];
}

/**
 * A pluggable tide data source. Modeled after the contract that @neaps/api
 * routes consume, so it can later be extracted there.
 *
 * Only `getExtremesPrediction` and `getTimelinePrediction` are required.
 * Station-related methods are optional — routes return 501 when not implemented.
 */
export interface TideSource {
  id: string;
  title: string;
  properties?: unknown;

  /** Initialize the source, returning a provider */
  start(props: Config): OptionalPromise<TideProvider>;
}

export interface TideProvider {
  /** Get extremes for nearest station to position */
  getExtremesPrediction(
    options: PositionOptions & PredictionOptions,
  ): OptionalPromise<ExtremesResponse>;

  /** Get timeline for nearest station to position */
  getTimelinePrediction(
    options: PositionOptions & PredictionOptions,
  ): OptionalPromise<TimelineResponse>;

  /** Find a station by its composite ID (e.g. "noaa/9414290") */
  findStation?(id: string): OptionalPromise<Station>;

  /** Search stations by text query */
  searchStations?(
    query: string,
    options?: { maxResults?: number },
  ): OptionalPromise<StationSummary[]>;

  /** Find stations near a position */
  stationsNear?(
    options: PositionOptions & { maxResults?: number; maxDistance?: number },
  ): OptionalPromise<Station[]>;

  /** Find stations within a bounding box [minLon, minLat, maxLon, maxLat] */
  stationsWithin?(
    bbox: [number, number, number, number],
  ): OptionalPromise<StationSummary[]>;

  /** List all available stations */
  stations?(): OptionalPromise<StationSummary[]>;

  /** Get extremes for a specific station by ID */
  getStationExtremes?(
    id: string,
    options: PredictionOptions,
  ): OptionalPromise<ExtremesResponse>;

  /** Get timeline for a specific station by ID */
  getStationTimeline?(
    id: string,
    options: PredictionOptions,
  ): OptionalPromise<TimelineResponse>;
}

export type FetchFunction = typeof globalThis.fetch;

export type Config = {
  source?: string;
  period?: number;
  worldtidesApiKey?: string;
  stormglassApiKey?: string;
  /** @internal Override fetch for testing */
  _fetch?: FetchFunction;
};
