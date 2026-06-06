import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, Router } from 'express';
import type { Position } from '@signalk/server-api';
import { withVesselPosition } from '../src/middleware.js';

// Mock neaps' nearestStation — the middleware only reads `.id` off the result.
vi.mock('neaps', () => ({ nearestStation: vi.fn() }));
const { nearestStation } = await import('neaps');

function mockNearest(id: string | null) {
  vi.mocked(nearestStation).mockReturnValue((id ? { id } : null) as never);
}

describe('withVesselPosition middleware', () => {
  let mockRouter: Router;

  beforeEach(() => {
    mockRouter = express.Router();
    mockRouter.use((req: Request, res: Response) => {
      res.json({ path: req.path, params: req.params, query: req.query });
    });
    vi.clearAllMocks();
  });

  function buildApp(getPosition: () => Position | null) {
    const app = express();
    app.use('/signalk/v2/api/tides', withVesselPosition(mockRouter, getPosition));
    return app;
  }

  const atSF = () => ({ latitude: 37.7749, longitude: -122.4194 } as Position);

  describe('vessel/current station requests', () => {
    it('returns 303 redirect to nearest station', async () => {
      mockNearest('noaa/9414290');
      const response = await request(buildApp(atSF))
        .get('/signalk/v2/api/tides/stations/vessel/current')
        .expect(303);

      expect(nearestStation).toHaveBeenCalledWith({
        latitude: 37.7749,
        longitude: -122.4194,
      });
      expect(response.headers.location).toBe('/signalk/v2/api/tides/stations/noaa/9414290');
    });

    it('preserves query parameters in redirect', async () => {
      mockNearest('noaa/9414290');
      const response = await request(buildApp(atSF))
        .get('/signalk/v2/api/tides/stations/vessel/current/extremes?start=2025-01-01&end=2025-01-08')
        .expect(303);

      expect(response.headers.location).toBe(
        '/signalk/v2/api/tides/stations/noaa/9414290/extremes?start=2025-01-01&end=2025-01-08',
      );
    });

    it('preserves path suffix in redirect', async () => {
      mockNearest('noaa/9414290');
      const response = await request(buildApp(atSF))
        .get('/signalk/v2/api/tides/stations/vessel/current/timeline')
        .expect(303);

      expect(response.headers.location).toBe('/signalk/v2/api/tides/stations/noaa/9414290/timeline');
    });

    it('handles compound station IDs', async () => {
      mockNearest('worldtides/US/San_Francisco');
      const response = await request(buildApp(atSF))
        .get('/signalk/v2/api/tides/stations/vessel/current')
        .expect(303);

      expect(response.headers.location).toBe('/signalk/v2/api/tides/stations/worldtides/US/San_Francisco');
    });

    it('returns 503 when vessel position unavailable', async () => {
      const response = await request(buildApp(() => null))
        .get('/signalk/v2/api/tides/stations/vessel/current')
        .expect(503);

      expect(nearestStation).not.toHaveBeenCalled();
      expect(response.body).toEqual({ message: 'Vessel position not available' });
    });

    it('returns 404 when no nearby stations found', async () => {
      mockNearest(null);
      const response = await request(buildApp(atSF))
        .get('/signalk/v2/api/tides/stations/vessel/current')
        .expect(404);

      expect(response.body).toEqual({ message: 'No nearby stations found' });
    });

    it('returns 500 when nearestStation throws', async () => {
      vi.mocked(nearestStation).mockImplementation(() => {
        throw new Error('boom');
      });
      const response = await request(buildApp(atSF))
        .get('/signalk/v2/api/tides/stations/vessel/current')
        .expect(500);

      expect(response.body).toEqual({ message: 'Failed to find nearest station' });
    });
  });

  describe('location-based queries', () => {
    it('injects vessel position for /extremes endpoint', async () => {
      const response = await request(buildApp(atSF))
        .get('/signalk/v2/api/tides/extremes')
        .expect(200);

      expect(response.body.query.latitude).toBe('37.7749');
      expect(response.body.query.longitude).toBe('-122.4194');
    });

    it('injects vessel position for /timeline endpoint', async () => {
      const response = await request(buildApp(atSF))
        .get('/signalk/v2/api/tides/timeline')
        .expect(200);

      expect(response.body.query.latitude).toBe('37.7749');
      expect(response.body.query.longitude).toBe('-122.4194');
    });

    it('does not override existing latitude/longitude', async () => {
      const response = await request(buildApp(atSF))
        .get('/signalk/v2/api/tides/extremes?latitude=40.7128&longitude=-74.0060')
        .expect(200);

      expect(response.body.query.latitude).toBe('40.7128');
      expect(response.body.query.longitude).toBe('-74.0060');
    });

    it('skips injection when position unavailable', async () => {
      const response = await request(buildApp(() => null))
        .get('/signalk/v2/api/tides/extremes')
        .expect(200);

      expect(response.body.query.latitude).toBeUndefined();
      expect(response.body.query.longitude).toBeUndefined();
    });

    it('does not inject position for non-location endpoints', async () => {
      const response = await request(buildApp(atSF))
        .get('/signalk/v2/api/tides/stations/noaa/9414290')
        .expect(200);

      expect(response.body.query.latitude).toBeUndefined();
      expect(response.body.query.longitude).toBeUndefined();
    });
  });

  describe('path detection', () => {
    it('detects vessel/current at the root', async () => {
      mockNearest('noaa/9414290');
      await request(buildApp(atSF))
        .get('/signalk/v2/api/tides/stations/vessel/current')
        .expect(303);
      expect(nearestStation).toHaveBeenCalledTimes(1);
    });

    it('detects vessel/current with trailing slash', async () => {
      mockNearest('noaa/9414290');
      await request(buildApp(atSF))
        .get('/signalk/v2/api/tides/stations/vessel/current/')
        .expect(303);
      expect(nearestStation).toHaveBeenCalledTimes(1);
    });

    it('does not match partial vessel/current paths', async () => {
      const response = await request(buildApp(atSF))
        .get('/signalk/v2/api/tides/stations/vessel/current-not-this')
        .expect(200);

      expect(nearestStation).not.toHaveBeenCalled();
      expect(response.body.path).toBe('/stations/vessel/current-not-this');
    });
  });
});
