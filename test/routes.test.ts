import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAdapterRoutes } from '../src/routes.js';
import type { TideForecastFunction } from '../src/types.js';

const mockProvider: TideForecastFunction = async ({ position }) => ({
  station: {
    name: "Test Station",
    position: { latitude: position.latitude, longitude: position.longitude },
  },
  extremes: [
    { type: "High", value: 1.5, time: "2025-01-01T06:00:00Z" },
    { type: "Low", value: 0.3, time: "2025-01-01T12:00:00Z" },
    { type: "High", value: 1.7, time: "2025-01-01T18:00:00Z" },
    { type: "Low", value: 0.2, time: "2025-01-02T00:00:00Z" },
  ],
});

describe('Adapter Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(createAdapterRoutes(mockProvider));
  });

  describe('GET /openapi.json', () => {
    it('returns OpenAPI spec', async () => {
      const response = await request(app)
        .get('/openapi.json')
        .expect(200);

      expect(response.body.openapi).toBeDefined();
    });
  });

  describe('GET /extremes', () => {
    it('requires latitude and longitude', async () => {
      await request(app)
        .get('/extremes')
        .expect(400)
        .expect({ message: 'latitude and longitude are required' });
    });

    it('returns extremes in @neaps/api format', async () => {
      const response = await request(app)
        .get('/extremes')
        .query({ latitude: 37.7749, longitude: -122.4194 })
        .expect(200);

      expect(response.body.station.name).toBe('Test Station');
      expect(response.body.extremes).toHaveLength(4);
      expect(response.body.extremes[0]).toMatchObject({
        time: '2025-01-01T06:00:00Z',
        level: 1.5,
        high: true,
        low: false,
        label: 'High',
      });
      expect(response.body.extremes[1]).toMatchObject({
        level: 0.3,
        high: false,
        low: true,
        label: 'Low',
      });
    });

    it('filters by start date', async () => {
      const response = await request(app)
        .get('/extremes')
        .query({ latitude: 37.7749, longitude: -122.4194, start: '2025-01-01T10:00:00Z' })
        .expect(200);

      expect(response.body.extremes).toHaveLength(3);
      expect(response.body.extremes[0].time).toBe('2025-01-01T12:00:00Z');
    });

    it('filters by end date', async () => {
      const response = await request(app)
        .get('/extremes')
        .query({ latitude: 37.7749, longitude: -122.4194, end: '2025-01-01T15:00:00Z' })
        .expect(200);

      expect(response.body.extremes).toHaveLength(2);
    });

    it('returns 500 on provider error', async () => {
      const failApp = express();
      failApp.use(createAdapterRoutes(async () => { throw new Error('API down'); }));

      await request(failApp)
        .get('/extremes')
        .query({ latitude: 37.7749, longitude: -122.4194 })
        .expect(500)
        .expect({ message: 'API down' });
    });
  });

  describe('GET /timeline', () => {
    it('requires latitude and longitude', async () => {
      await request(app)
        .get('/timeline')
        .expect(400)
        .expect({ message: 'latitude and longitude are required' });
    });

    it('generates interpolated timeline', async () => {
      const response = await request(app)
        .get('/timeline')
        .query({
          latitude: 37.7749,
          longitude: -122.4194,
          start: '2025-01-01T07:00:00Z',
          end: '2025-01-01T11:00:00Z',
        })
        .expect(200);

      expect(response.body.timeline).toBeDefined();
      expect(response.body.timeline.length).toBeGreaterThan(0);

      const point = response.body.timeline[0];
      expect(point).toHaveProperty('time');
      expect(point).toHaveProperty('level');
      expect(typeof point.level).toBe('number');
    });

    it('generates 10-minute intervals', async () => {
      const response = await request(app)
        .get('/timeline')
        .query({
          latitude: 37.7749,
          longitude: -122.4194,
          start: '2025-01-01T06:00:00Z',
          end: '2025-01-01T07:00:00Z',
        })
        .expect(200);

      // 1 hour at 10-minute intervals = 7 points (inclusive)
      expect(response.body.timeline.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe('Station endpoints (not supported)', () => {
    it('returns 501 for /stations', async () => {
      await request(app).get('/stations').expect(501);
    });

    it('returns 501 for /stations/:source/:id', async () => {
      await request(app).get('/stations/noaa/9414290').expect(501);
    });

    it('returns 501 for /stations/:source/:id/extremes', async () => {
      await request(app).get('/stations/noaa/9414290/extremes').expect(501);
    });

    it('returns 501 for /stations/:source/:id/timeline', async () => {
      await request(app).get('/stations/noaa/9414290/timeline').expect(501);
    });
  });
});
