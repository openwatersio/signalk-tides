/**
 * Shared @neaps/api dev server logic
 * Used by both the Vite dev plugin and Vitest browser tests
 */
import express, { RequestHandler } from 'express';
import { createRoutes } from '@neaps/api';
import type { Position } from '@signalk/server-api';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Plugin } from 'vite';
import { withVesselPosition } from './src/middleware.js';

const MOUNT_PATH = '/signalk/v2/api/tides';

// Mock vessel position (San Francisco Bay)
let mockPosition: Position = {
  latitude: 37.7749,
  longitude: -122.4194,
};

let server: Server | null = null;
let devServerPort: number | null = null;

export async function startTidesDevServer(): Promise<number> {
  if (server && devServerPort) {
    return devServerPort;
  }

  const app = express();

  // Middleware to update mock position
  app.post('/api/dev/position', express.json(), (req, res) => {
    const { latitude, longitude } = req.body;
    if (typeof latitude === 'number' && typeof longitude === 'number') {
      mockPosition = { latitude, longitude };
      res.json({ success: true, position: mockPosition });
    } else {
      res.status(400).json({ error: 'Invalid latitude/longitude' });
    }
  });

  // Get current mock position
  app.get('/api/dev/position', (_req, res) => {
    res.json(mockPosition);
  });

  // Health check endpoint
  app.get('/api/dev/health', (_req, res) => {
    res.json({ status: 'ok', position: mockPosition });
  });

  // Create and mount @neaps/api routes with vessel position middleware
  const neapsRoutes = createRoutes({ prefix: MOUNT_PATH });
  const getPosition = () => mockPosition;
  app.use(MOUNT_PATH, withVesselPosition(
    neapsRoutes as unknown as RequestHandler,
    getPosition,
  ));

  const port = await new Promise<number>((resolve, reject) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => {
      const address = listeningServer.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve dev API server port'));
        return;
      }
      resolve((address as AddressInfo).port);
    });

    listeningServer.on('error', (error) => {
      reject(error);
    });

    server = listeningServer;
  });

  devServerPort = port;
  return port;
}

export function stopTidesDevServer(): void {
  if (server) {
    server.close();
    server = null;
    devServerPort = null;
  }
}

export function tidesDevServerPlugin(): Plugin {
  return {
    name: 'vite-plugin-tides-dev-server',
    apply: 'serve',
    async config() {
      const port = await startTidesDevServer();
      console.log(`Tides dev API ready at http://127.0.0.1:${port}`);

      return {
        server: {
          proxy: {
            [MOUNT_PATH]: {
              target: `http://127.0.0.1:${port}`,
              changeOrigin: true,
            },
            '/api/dev': {
              target: `http://127.0.0.1:${port}`,
              changeOrigin: true,
            },
          },
        },
      };
    },
    configureServer(viteServer) {
      viteServer.httpServer?.once('close', stopTidesDevServer);
    },
    closeBundle() {
      stopTidesDevServer();
    },
  };
}
