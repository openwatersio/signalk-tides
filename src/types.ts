import { ServerAPI } from "@signalk/server-api";

// Workaround pending an upstream type fix in @signalk/server-api: at runtime
// `app.debug` is a debug-module instance with an `.enabled` property, but
// ServerAPI types it as a bare function. Omit the upstream `debug` member
// before intersecting so the property doesn't collapse to `never`.
export type SignalKApp = Omit<ServerAPI, "debug"> & {
  debug: ServerAPI["debug"] & { enabled: boolean };
};
