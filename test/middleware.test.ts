import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, Router } from 'express';
import type { Position } from '@signalk/server-api';
import { withVesselPosition } from '../src/middleware.js';

// Mock neaps' station lookups — the middleware only reads `.id` off the result.
vi.mock('neaps', () => ({ nearestStation: vi.fn(), findStation: vi.fn() }));
const { nearestStation, findStation } = await import('neaps');

function mockNearest(id: string | null) {
  vi.mocked(nearestStation).mockReturnValue((id ? { id } : null) as never);
}

function mockFind(id: string | null) {
  if (id) {
    vi.mocked(findStation).mockReturnValue({ id } as never);
  } else {
    vi.mocked(findStation).mockImplementation(() => {
      throw new Error(`Station not found`);
    });
  }
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

  function buildApp(
    getPosition: () => Position | null,
    getDefaultStationId?: () => string | null,
  ) {
    const app = express();
    app.use(
      '/signalk/v2/api/tides',
      withVesselPosition(mockRouter, getPosition, getDefaultStationId),
    );
    return app;
  }

  const atSF = () => ({ latitude: 37.7749, longitude: -122.4194 } as Position);

  describe('vessel/default station requests', () => {
    it('returns 303 redirect to nearest station', async () => {
      mockNearest('noaa/9414290');
      const response = await request(buildApp(atSF))
        .get('/signalk/v2/api/tides/stations/vessel/default')
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
        .get('/signalk/v2/api/tides/stations/vessel/default/extremes?start=2025-01-01&end=2025-01-08')
        .expect(303);

      expect(response.headers.location).toBe(
        '/signalk/v2/api/tides/stations/noaa/9414290/extremes?start=2025-01-01&end=2025-01-08',
      );
    });

    it('preserves path suffix in redirect', async () => {
      mockNearest('noaa/9414290');
      const response = await request(buildApp(atSF))
        .get('/signalk/v2/api/tides/stations/vessel/default/timeline')
        .expect(303);

      expect(response.headers.location).toBe('/signalk/v2/api/tides/stations/noaa/9414290/timeline');
    });

    it('handles compound station IDs', async () => {
      mockNearest('worldtides/US/San_Francisco');
      const response = await request(buildApp(atSF))
        .get('/signalk/v2/api/tides/stations/vessel/default')
        .expect(303);

      expect(response.headers.location).toBe('/signalk/v2/api/tides/stations/worldtides/US/San_Francisco');
    });

    it('returns 503 when vessel position unavailable', async () => {
      const response = await request(buildApp(() => null))
        .get('/signalk/v2/api/tides/stations/vessel/default')
        .expect(503);

      expect(nearestStation).not.toHaveBeenCalled();
      expect(response.body).toEqual({ message: 'Vessel position not available' });
    });

    it('returns 404 when no nearby stations found', async () => {
      mockNearest(null);
      const response = await request(buildApp(atSF))
        .get('/signalk/v2/api/tides/stations/vessel/default')
        .expect(404);

      expect(response.body).toEqual({ message: 'No nearby stations found' });
    });

    it('returns 500 when nearestStation throws', async () => {
      vi.mocked(nearestStation).mockImplementation(() => {
        throw new Error('boom');
      });
      const response = await request(buildApp(atSF))
        .get('/signalk/v2/api/tides/stations/vessel/default')
        .expect(500);

      expect(response.body).toEqual({ message: 'Failed to find nearest station' });
    });
  });

  describe('default station', () => {
    it('redirects vessel/default to the configured station', async () => {
      mockFind('noaa/9410230');
      const response = await request(buildApp(atSF, () => 'noaa/9410230'))
        .get('/signalk/v2/api/tides/stations/vessel/default')
        .expect(303);

      expect(findStation).toHaveBeenCalledWith('noaa/9410230');
      expect(nearestStation).not.toHaveBeenCalled();
      expect(response.headers.location).toBe('/signalk/v2/api/tides/stations/noaa/9410230');
    });

    it('preserves path suffix and query parameters in redirect', async () => {
      mockFind('noaa/9410230');
      const response = await request(buildApp(atSF, () => 'noaa/9410230'))
        .get('/signalk/v2/api/tides/stations/vessel/default/extremes?start=2025-01-01&end=2025-01-08')
        .expect(303);

      expect(response.headers.location).toBe(
        '/signalk/v2/api/tides/stations/noaa/9410230/extremes?start=2025-01-01&end=2025-01-08',
      );
    });

    it('resolves the configured station without a vessel position', async () => {
      mockFind('noaa/9410230');
      const response = await request(buildApp(() => null, () => 'noaa/9410230'))
        .get('/signalk/v2/api/tides/stations/vessel/default')
        .expect(303);

      expect(response.headers.location).toBe('/signalk/v2/api/tides/stations/noaa/9410230');
    });

    it('uses the nearest station when set to "auto"', async () => {
      mockNearest('noaa/9414290');
      const response = await request(buildApp(atSF, () => 'auto'))
        .get('/signalk/v2/api/tides/stations/vessel/default')
        .expect(303);

      expect(findStation).not.toHaveBeenCalled();
      expect(response.headers.location).toBe('/signalk/v2/api/tides/stations/noaa/9414290');
    });

    it('uses the nearest station when unset', async () => {
      mockNearest('noaa/9414290');
      const response = await request(buildApp(atSF, () => null))
        .get('/signalk/v2/api/tides/stations/vessel/default')
        .expect(303);

      expect(findStation).not.toHaveBeenCalled();
      expect(response.headers.location).toBe('/signalk/v2/api/tides/stations/noaa/9414290');
    });

    it('falls back to the nearest station when the configured station is not found', async () => {
      mockFind(null);
      mockNearest('noaa/9414290');
      const response = await request(buildApp(atSF, () => 'stale/id'))
        .get('/signalk/v2/api/tides/stations/vessel/default')
        .expect(303);

      expect(response.headers.location).toBe('/signalk/v2/api/tides/stations/noaa/9414290');
    });

    it('returns 503 when the configured station is not found and no position is available', async () => {
      mockFind(null);
      const response = await request(buildApp(() => null, () => 'stale/id'))
        .get('/signalk/v2/api/tides/stations/vessel/default')
        .expect(503);

      expect(response.body).toEqual({ message: 'Vessel position not available' });
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

    it('redirects /extremes to the configured station', async () => {
      mockFind('noaa/9410230');
      const response = await request(buildApp(atSF, () => 'noaa/9410230'))
        .get('/signalk/v2/api/tides/extremes?start=2025-01-01&end=2025-01-08')
        .expect(303);

      expect(nearestStation).not.toHaveBeenCalled();
      expect(response.headers.location).toBe(
        '/signalk/v2/api/tides/stations/noaa/9410230/extremes?start=2025-01-01&end=2025-01-08',
      );
    });

    it('redirects /timeline to the configured station', async () => {
      mockFind('noaa/9410230');
      const response = await request(buildApp(atSF, () => 'noaa/9410230'))
        .get('/signalk/v2/api/tides/timeline')
        .expect(303);

      expect(response.headers.location).toBe(
        '/signalk/v2/api/tides/stations/noaa/9410230/timeline',
      );
    });

    it('redirects /extremes to the configured station without a position', async () => {
      mockFind('noaa/9410230');
      const response = await request(buildApp(() => null, () => 'noaa/9410230'))
        .get('/signalk/v2/api/tides/extremes')
        .expect(303);

      expect(response.headers.location).toBe(
        '/signalk/v2/api/tides/stations/noaa/9410230/extremes',
      );
    });

    it('injects position for /extremes when set to "auto"', async () => {
      const response = await request(buildApp(atSF, () => 'auto'))
        .get('/signalk/v2/api/tides/extremes')
        .expect(200);

      expect(findStation).not.toHaveBeenCalled();
      expect(response.body.query.latitude).toBe('37.7749');
      expect(response.body.query.longitude).toBe('-122.4194');
    });

    it('injects position for /extremes when the configured station is stale', async () => {
      mockFind(null);
      const response = await request(buildApp(atSF, () => 'stale/id'))
        .get('/signalk/v2/api/tides/extremes')
        .expect(200);

      expect(response.body.query.latitude).toBe('37.7749');
      expect(response.body.query.longitude).toBe('-122.4194');
    });

    it('does not redirect /extremes when explicit coordinates are given', async () => {
      mockFind('noaa/9410230');
      const response = await request(buildApp(atSF, () => 'noaa/9410230'))
        .get('/signalk/v2/api/tides/extremes?latitude=40.7128&longitude=-74.0060')
        .expect(200);

      expect(findStation).not.toHaveBeenCalled();
      expect(response.body.query.latitude).toBe('40.7128');
      expect(response.body.query.longitude).toBe('-74.0060');
    });
  });

  describe('path detection', () => {
    it('detects vessel/default at the root', async () => {
      mockNearest('noaa/9414290');
      await request(buildApp(atSF))
        .get('/signalk/v2/api/tides/stations/vessel/default')
        .expect(303);
      expect(nearestStation).toHaveBeenCalledTimes(1);
    });

    it('detects vessel/default with trailing slash', async () => {
      mockNearest('noaa/9414290');
      await request(buildApp(atSF))
        .get('/signalk/v2/api/tides/stations/vessel/default/')
        .expect(303);
      expect(nearestStation).toHaveBeenCalledTimes(1);
    });

    it('does not match partial vessel/default paths', async () => {
      const response = await request(buildApp(atSF))
        .get('/signalk/v2/api/tides/stations/vessel/default-not-this')
        .expect(200);

      expect(nearestStation).not.toHaveBeenCalled();
      expect(response.body.path).toBe('/stations/vessel/default-not-this');
    });
  });
});
