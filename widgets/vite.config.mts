import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Self-contained build for the Plotter Extensions widget iframes (web/) →
// widgets/dist. Kept separate from the webapp's vite.config.mts so the root
// build, index.html, and the public/ mount stay untouched. The plugin serves
// widgets/dist at /plotterext/signalk-tides/, so assets are referenced with a
// relative base.

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(here, "web"),
  base: "./",
  plugins: [tailwindcss(), react()],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: resolve(here, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        graph: resolve(here, "web/graph.html"),
        config: resolve(here, "web/config.html"),
      },
    },
  },
});
