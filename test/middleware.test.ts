import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, Router } from 'express';
import type { Position } from '@signalk/server-api';
import { withVesselPosition } from '../src/middleware.js';

// Mock nearestStation
vi.mock('neaps', () => ({
  nearestStation: vi.fn()
}));

const { nearestStation } = await import('neaps');

type NearestStation = ReturnType<typeof nearestStation>;
type StationOverrides = Omit<Partial<NearestStation>, 'source' | 'license'> & {
  source?: Partial<NearestStation['source']>;
  license?: Partial<NearestStation['license']>;
};

function createMockStation(
  overrides: StationOverrides = {},
): NearestStation {
  const base: NearestStation = {
    distance: 0,
    datums: {},
    harmonic_constituents: [],
    defaultDatum: undefined,
    getExtremesPrediction: () => {
      throw new Error("not used in tests");
    },
    getTimelinePrediction: () => {
      throw new Error("not used in tests");
    },
    getWaterLevelAtTime: () => {
      throw new Error("not used in tests");
    },
    id: "noaa/9414290",
    name: "San Francisco",
    continent: "North America",
    country: "US",
    timezone: "America/Los_Angeles",
    disclaimers: "",
    type: "reference",
    latitude: 37.7749,
    longitude: -122.4194,
    source: {
      name: "NOAA",
      id: "noaa",
      published_harmonics: true,
      url: "https://example.com",
    },
    license: {
      type: "public-domain",
      commercial_use: true,
      url: "https://example.com/license",
    },
    chart_datum: "MLLW",
  };

  return {
    ...base,
    ...overrides,
    source: {
      ...base.source,
      ...(overrides.source ?? {}),
    },
    license: {
      ...base.license,
      ...(overrides.license ?? {}),
    },
  };
}

describe('withVesselPosition middleware', () => {
  let mockRouter: Router;

  beforeEach(() => {
    mockRouter = express.Router();
    mockRouter.use((req: Request, res: Response) => {
      res.json({
        path: req.path,
        params: req.params,
        query: req.query,
      });
    });

    vi.clearAllMocks();
  });

  function buildApp(getPosition: () => Position | null) {
    const app = express();
    app.use('/signalk/v2/api/tides', withVesselPosition(mockRouter, getPosition));
    return app;
  }

  describe('vessel/current station requests', () => {
    it('returns 303 redirect to nearest station', async () => {
      const getPosition = () => ({ latitude: 37.7749, longitude: -122.4194 } as Position);
      const app = buildApp(getPosition);

      vi.mocked(nearestStation).mockReturnValue(
        createMockStation({
          id: 'noaa/9414290',
          source: { id: 'noaa' },
        }),
      );

      const response = await request(app)
        .get('/signalk/v2/api/tides/stations/vessel/current')
        .expect(303);

      expect(response.headers.location).toBe('/signalk/v2/api/tides/stations/noaa/9414290');
    });

    it('preserves query parameters in redirect', async () => {
      const getPosition = () => ({ latitude: 37.7749, longitude: -122.4194 } as Position);
      const app = buildApp(getPosition);

      vi.mocked(nearestStation).mockReturnValue(
        createMockStation({
          id: 'noaa/9414290',
          source: { id: 'noaa' },
        }),
      );

      const response = await request(app)
        .get('/signalk/v2/api/tides/stations/vessel/current/extremes?start=2025-01-01&end=2025-01-08')
        .expect(303);

      expect(response.headers.location).toBe(
        '/signalk/v2/api/tides/stations/noaa/9414290/extremes?start=2025-01-01&end=2025-01-08',
      );
    });

    it('preserves path suffix in redirect', async () => {
      const getPosition = () => ({ latitude: 37.7749, longitude: -122.4194 } as Position);
      const app = buildApp(getPosition);

      vi.mocked(nearestStation).mockReturnValue(
        createMockStation({
          id: 'noaa/9414290',
          source: { id: 'noaa' },
        }),
      );

      const response = await request(app)
        .get('/signalk/v2/api/tides/stations/vessel/current/timeline')
        .expect(303);

      expect(response.headers.location).toBe('/signalk/v2/api/tides/stations/noaa/9414290/timeline');
    });

    it('returns 503 when vessel position unavailable', async () => {
      const getPosition = () => null;
      const app = buildApp(getPosition);

      const response = await request(app)
        .get('/signalk/v2/api/tides/stations/vessel/current')
        .expect(503);

      expect(response.body).toEqual({
        message: 'Vessel position not available',
      });
    });

    it('returns 404 when no nearby stations found', async () => {
      const getPosition = () => ({ latitude: 90, longitude: 0 } as Position);
      const app = buildApp(getPosition);
      vi.mocked(nearestStation).mockImplementation(() => undefined as never);

      const response = await request(app)
        .get('/signalk/v2/api/tides/stations/vessel/current')
        .expect(404);

      expect(response.body).toEqual({
        message: 'No nearby stations found',
      });
    });

    it('returns 500 on nearestStation error', async () => {
      const getPosition = () => ({ latitude: 37.7749, longitude: -122.4194 } as Position);
      const app = buildApp(getPosition);
      vi.mocked(nearestStation).mockImplementation(() => {
        throw new Error('Database error');
      });

      const response = await request(app)
        .get('/signalk/v2/api/tides/stations/vessel/current')
        .expect(500);

      expect(response.body).toEqual({
        message: 'Failed to find nearest station',
      });
    });
  });

  describe('location-based queries', () => {
    it('injects vessel position for /extremes endpoint', async () => {
      const getPosition = () => ({ latitude: 37.7749, longitude: -122.4194 } as Position);
      const app = buildApp(getPosition);

      const response = await request(app)
        .get('/signalk/v2/api/tides/extremes')
        .expect(200);

      expect(response.body.query.latitude).toBe('37.7749');
      expect(response.body.query.longitude).toBe('-122.4194');
    });

    it('injects vessel position for /timeline endpoint', async () => {
      const getPosition = () => ({ latitude: 37.7749, longitude: -122.4194 } as Position);
      const app = buildApp(getPosition);

      const response = await request(app)
        .get('/signalk/v2/api/tides/timeline')
        .expect(200);

      expect(response.body.query.latitude).toBe('37.7749');
      expect(response.body.query.longitude).toBe('-122.4194');
    });

    it('does not override existing latitude/longitude', async () => {
      const getPosition = () => ({ latitude: 37.7749, longitude: -122.4194 } as Position);
      const app = buildApp(getPosition);

      const response = await request(app)
        .get('/signalk/v2/api/tides/extremes?latitude=40.7128&longitude=-74.0060')
        .expect(200);

      expect(response.body.query.latitude).toBe('40.7128');
      expect(response.body.query.longitude).toBe('-74.0060');
    });

    it('skips injection when position unavailable', async () => {
      const getPosition = () => null;
      const app = buildApp(getPosition);

      const response = await request(app)
        .get('/signalk/v2/api/tides/extremes')
        .expect(200);

      expect(response.body.query.latitude).toBeUndefined();
      expect(response.body.query.longitude).toBeUndefined();
    });

    it('does not inject position for non-location endpoints', async () => {
      const getPosition = () => ({ latitude: 37.7749, longitude: -122.4194 } as Position);
      const app = buildApp(getPosition);

      const response = await request(app)
        .get('/signalk/v2/api/tides/stations/noaa/9414290')
        .expect(200);

      expect(response.body.query.latitude).toBeUndefined();
      expect(response.body.query.longitude).toBeUndefined();
    });
  });

  describe('station ID handling', () => {
    it('correctly handles station ID with slash', async () => {
      const getPosition = () => ({ latitude: 37.7749, longitude: -122.4194 } as Position);
      const app = buildApp(getPosition);

      vi.mocked(nearestStation).mockReturnValue(
        createMockStation({
          id: 'noaa/9414290',
          source: { id: 'noaa' },
        }),
      );

      const response = await request(app)
        .get('/signalk/v2/api/tides/stations/vessel/current')
        .expect(303);

      expect(response.headers.location).toBe('/signalk/v2/api/tides/stations/noaa/9414290');
    });

    it('handles compound station IDs', async () => {
      const getPosition = () => ({ latitude: 37.7749, longitude: -122.4194 } as Position);
      const app = buildApp(getPosition);

      vi.mocked(nearestStation).mockReturnValue(
        createMockStation({
          id: 'worldtides/US/San_Francisco',
          source: { id: 'worldtides' },
        }),
      );

      const response = await request(app)
        .get('/signalk/v2/api/tides/stations/vessel/current')
        .expect(303);

      expect(response.headers.location).toBe('/signalk/v2/api/tides/stations/worldtides/US/San_Francisco');
    });
  });

  describe('path detection', () => {
    it('detects vessel/current at the root', async () => {
      const getPosition = () => ({ latitude: 37.7749, longitude: -122.4194 } as Position);
      const app = buildApp(getPosition);
      vi.mocked(nearestStation).mockReturnValue(
        createMockStation({ id: 'noaa/9414290', source: { id: 'noaa' } }),
      );

      await request(app)
        .get('/signalk/v2/api/tides/stations/vessel/current')
        .expect(303);

      expect(nearestStation).toHaveBeenCalledTimes(1);
    });

    it('detects vessel/current with trailing slash', async () => {
      const getPosition = () => ({ latitude: 37.7749, longitude: -122.4194 } as Position);
      const app = buildApp(getPosition);
      vi.mocked(nearestStation).mockReturnValue(
        createMockStation({ id: 'noaa/9414290', source: { id: 'noaa' } }),
      );

      await request(app)
        .get('/signalk/v2/api/tides/stations/vessel/current/')
        .expect(303);

      expect(nearestStation).toHaveBeenCalledTimes(1);
    });

    it('does not match partial vessel/current paths', async () => {
      const getPosition = () => ({ latitude: 37.7749, longitude: -122.4194 } as Position);
      const app = buildApp(getPosition);

      const response = await request(app)
        .get('/signalk/v2/api/tides/stations/vessel/current-not-this')
        .expect(200);

      expect(nearestStation).not.toHaveBeenCalled();
      expect(response.body.path).toBe('/stations/vessel/current-not-this');
    });
  });
});
