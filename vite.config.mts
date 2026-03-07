import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tideDevServerPlugin from "./vite-plugin-tides-dev.js";

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
  plugins: [tailwindcss(), react(), tideDevServerPlugin()],
});
