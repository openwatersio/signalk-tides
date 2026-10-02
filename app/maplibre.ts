// MapLibre 6 locates its worker with `new URL("./maplibre-gl-worker.mjs", import.meta.url)`
// built at runtime, which no bundler can follow: Vite hashes the MapLibre chunk without
// emitting the sibling worker, the request 404s, and the map renders blank with no error.
// Bundle the worker here and hand MapLibre the URL it landed on.
// vite.config.mts resolves every import of maplibre-gl to this module.
import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

setWorkerUrl(workerUrl)

export * from 'maplibre-gl'
