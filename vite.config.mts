import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { tidesDevServerPlugin } from './tides-dev-server.ts'

const maplibreSetup = fileURLToPath(new URL('./app/maplibre.ts', import.meta.url))

// Keeps the import dynamic, so MapLibre stays a lazy chunk the tide table never downloads.
const maplibreWorkerUrl = {
  name: 'signalk-tides:maplibre-worker-url',
  enforce: 'pre' as const,
  resolveId(source: string, importer?: string) {
    if (source === 'maplibre-gl' && importer !== maplibreSetup) return maplibreSetup
  },
}

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  publicDir: "app/public",
  build: {
    outDir: "public",
  },
  resolve: {
    dedupe: ['react', 'react-dom']
  },
  optimizeDeps: {
    // Pre-bundling separates MapLibre from the worker it loads relative to itself,
    // so the dev map would request a worker that isn't there and never draw a tile.
    exclude: ['maplibre-gl']
  },
  plugins: [tailwindcss(), react(), tidesDevServerPlugin(), maplibreWorkerUrl],
});
