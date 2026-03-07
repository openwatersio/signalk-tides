/**
 * Vite plugin that starts the @neaps/api dev server in the background
 * Provides a single dev experience without needing separate processes
 */
import { Plugin } from 'vite';
import express, { RequestHandler } from 'express';
import { createRoutes } from '@neaps/api';
import type { Position } from '@signalk/server-api';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { withVesselPosition } from './src/middleware.js';

const MOUNT_PATH = '/signalk/v2/api/tides';

// Mock vessel position (San Francisco Bay)
let mockPosition: Position = {
  latitude: 37.7749,
  longitude: -122.4194,
};

/**
 * Vite plugin for the tides dev server
 * Starts @neaps/api server on port 3001 and provides endpoints to change mock position
 */
export default function tideDevServerPlugin(): Plugin {
  let server: Server | null = null;
  let devServerPort: number | null = null;

  const closeApiServer = () => {
    if (!server) return;
    server.close();
    server = null;
    devServerPort = null;
  };

  const startApiServer = async () => {
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
        console.log(
          `Vessel position updated to: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
        );
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
    const router = withVesselPosition(
      neapsRoutes as unknown as RequestHandler,
      getPosition,
    );

    app.use(MOUNT_PATH, router);

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
    console.log(`Tides dev API ready at http://127.0.0.1:${port}`);
    return port;
  };

  return {
    name: 'vite-plugin-tides-dev-server',
    apply: 'serve',
    async config() {
      const port = await startApiServer();

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
      // Stop the embedded API server when Vite shuts down.
      viteServer.httpServer?.once('close', closeApiServer);
    },
    closeBundle() {
      closeApiServer();
    },
  };
}
