import { Position, ServerAPI } from "@signalk/server-api";

// Workaround pending an upstream type fix in @signalk/server-api: at runtime
// `app.debug` is a debug-module instance with an `.enabled` property, but
// ServerAPI types it as a bare function. Omit the upstream `debug` member
// before intersecting so the property doesn't collapse to `never`.
export type SignalKApp = Omit<ServerAPI, "debug"> & {
  debug: ServerAPI["debug"] & { enabled: boolean };
};

export type OptionalPromise<T> = T | Promise<T>;

export type TideExtremeType = "High" | "Low";

export interface TideForecastParams {
  position: Omit<Position, "altitude">;
  date?: string;
}

export interface TideExtreme {
  time: string;
  value: number;
  type: TideExtremeType;
}

export interface TideForecastResult {
  station: {
    name: string;
    position: {
      latitude: number;
      longitude: number;
    };
  }
  extremes: TideExtreme[];
}

export type TideForecastFunction = (params: TideForecastParams) => OptionalPromise<TideForecastResult>;

export interface TideSource {
  id: string;
  title: string;
  start: (props: Config) => OptionalPromise<TideForecastFunction>;
  properties?: unknown; // TODO: use schema?
}

export type Config = {
  source?: string;
  period?: number;
  worldtidesApiKey?: string;
  stormglassApiKey?: string;
};
