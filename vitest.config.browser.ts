import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { playwright } from "@vitest/browser-playwright";
import { tidesDevServerPlugin } from './tides-dev-server.js';

export default defineConfig({
  plugins: [react(), tidesDevServerPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
  test: {
    globals: true,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      // Desktop-sized viewport so TideStation renders the stacked layout
      // (it switches to a tabbed layout in narrow containers)
      instances: [{ browser: 'chromium', viewport: { width: 1280, height: 800 } }],
    },
    include: ["app/**/*.test.{ts,tsx}"],
  },
});
