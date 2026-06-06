import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAdapterRoutes } from '../src/routes.js';
import type { TideProvider, ExtremesResponse, TimelineResponse, Station, StationSummary } from '../src/types.js';

const testStation: Station = {
  id: "test/1",
  name: "Test Station",
  latitude: 37.7749,
  longitude: -122.4194,
  source: { id: "test", name: "Test" },
};

const testExtremes: ExtremesResponse = {
  datum: "MSL",
  units: "meters",
  station: testStation,
  extremes: [
    { time: new Date("2025-01-01T06:00:00Z"), level: 1.5, high: true, low: false, label: "High" },
    { time: new Date("2025-01-01T12:00:00Z"), level: 0.3, high: false, low: true, label: "Low" },
    { time: new Date("2025-01-01T18:00:00Z"), level: 1.7, high: true, low: false, label: "High" },
    { time: new Date("2025-01-02T00:00:00Z"), level: 0.2, high: false, low: true, label: "Low" },
  ],
};

const testTimeline: TimelineResponse = {
  datum: "MSL",
  units: "meters",
  station: testStation,
  timeline: [
    { time: new Date("2025-01-01T06:00:00Z"), level: 1.5 },
    { time: new Date("2025-01-01T06:10:00Z"), level: 1.48 },
    { time: new Date("2025-01-01T06:20:00Z"), level: 1.43 },
    { time: new Date("2025-01-01T06:30:00Z"), level: 1.35 },
    { time: new Date("2025-01-01T06:40:00Z"), level: 1.25 },
    { time: new Date("2025-01-01T06:50:00Z"), level: 1.12 },
    { time: new Date("2025-01-01T07:00:00Z"), level: 0.97 },
  ],
};

const mockProvider: TideProvider = {
  async getExtremesPrediction() {
    return testExtremes;
  },
  async getTimelinePrediction() {
    return testTimeline;
  },
};

describe('Adapter Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(createAdapterRoutes(mockProvider));
  });

  describe('GET /', () => {
    it('returns API info', async () => {
      const response = await request(app).get('/').expect(200);
      expect(response.body.name).toBe('Tides API');
      expect(response.body.version).toBeDefined();
      expect(response.body.docs).toBe('/openapi.json');
    });
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
      expect(response.body.datum).toBe('MSL');
      expect(response.body.units).toBe('meters');
      expect(response.body.extremes).toHaveLength(4);
      expect(response.body.extremes[0]).toMatchObject({
        time: '2025-01-01T06:00:00.000Z',
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

    it('returns 500 on provider error', async () => {
      const failProvider: TideProvider = {
        async getExtremesPrediction() { throw new Error('API down'); },
        async getTimelinePrediction() { throw new Error('API down'); },
      };
      const failApp = express();
      failApp.use(createAdapterRoutes(failProvider));

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

    it('returns timeline from provider', async () => {
      const response = await request(app)
        .get('/timeline')
        .query({
          latitude: 37.7749,
          longitude: -122.4194,
          start: '2025-01-01T06:00:00Z',
          end: '2025-01-01T07:00:00Z',
        })
        .expect(200);

      expect(response.body.timeline).toBeDefined();
      expect(response.body.timeline.length).toBeGreaterThan(0);
      expect(response.body.datum).toBe('MSL');
      expect(response.body.units).toBe('meters');

      const point = response.body.timeline[0];
      expect(point).toHaveProperty('time');
      expect(point).toHaveProperty('level');
      expect(typeof point.level).toBe('number');
    });
  });

  describe('Station endpoints (no station methods)', () => {
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

  describe('Station endpoints (with station methods)', () => {
    let stationsApp: express.Application;
    const stationList: StationSummary[] = [
      { id: "test/1", name: "Station One", latitude: 37.7, longitude: -122.4 },
      { id: "test/2", name: "Station Two", latitude: 38.0, longitude: -122.5 },
    ];

    beforeEach(() => {
      const fullProvider: TideProvider = {
        ...mockProvider,
        findStation: async (id) => {
          const s = stationList.find(s => s.id === id);
          if (!s) throw new Error(`Station not found: ${id}`);
          return s;
        },
        searchStations: async (query) => {
          return stationList.filter(s => s.name.toLowerCase().includes(query.toLowerCase()));
        },
        stationsNear: async () => stationList.map(s => ({ ...s })),
        stations: async () => stationList,
        getStationExtremes: async () => testExtremes,
        getStationTimeline: async () => testTimeline,
      };
      stationsApp = express();
      stationsApp.use(createAdapterRoutes(fullProvider));
    });

    it('returns stations list', async () => {
      const response = await request(stationsApp)
        .get('/stations')
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body[0].name).toBe('Station One');
    });

    it('searches stations by query', async () => {
      const response = await request(stationsApp)
        .get('/stations')
        .query({ query: 'one' })
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].name).toBe('Station One');
    });

    it('finds stations near position', async () => {
      const response = await request(stationsApp)
        .get('/stations')
        .query({ latitude: 37.7, longitude: -122.4 })
        .expect(200);

      expect(response.body.length).toBeGreaterThan(0);
    });

    it('returns station by ID', async () => {
      const response = await request(stationsApp)
        .get('/stations/test/1')
        .expect(200);

      expect(response.body.name).toBe('Station One');
    });

    it('returns 404 for unknown station', async () => {
      await request(stationsApp)
        .get('/stations/test/999')
        .expect(404);
    });

    it('returns station extremes', async () => {
      const response = await request(stationsApp)
        .get('/stations/test/1/extremes')
        .expect(200);

      expect(response.body.extremes).toHaveLength(4);
      expect(response.body.datum).toBe('MSL');
    });

    it('returns station timeline', async () => {
      const response = await request(stationsApp)
        .get('/stations/test/1/timeline')
        .expect(200);

      expect(response.body.timeline).toBeDefined();
      expect(response.body.datum).toBe('MSL');
    });
  });
});
