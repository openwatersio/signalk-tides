import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import worldtidesSource from '../../src/sources/worldtides.js';
import { createMockSignalKApp } from '../test-helpers.js';
import { useVCR, saveVCR } from '../vcr-helper.js';

const apiKey = process.env.WORLDTIDES_API_KEY ?? 'test-key';

describe('WorldTides Source', () => {
  const cassette = 'worldtides.json';

  const redact = ['key'];

  beforeEach(async () => {
    await useVCR({ cassettePath: cassette, redact });
  });

  afterEach(async () => {
    await saveVCR(cassette, redact);
  });

  it('has correct metadata', () => {
    const app = createMockSignalKApp();
    const source = worldtidesSource(app);

    expect(source.id).toBe('WorldTides.info');
    expect(source.properties).toEqual({
      worldtidesApiKey: { type: 'string', title: 'worldtides.info API key' },
    });
  });

  it('returns tide extremes for London', async () => {
    const app = createMockSignalKApp();
    const source = worldtidesSource(app);
    const provider = await source.start({ worldtidesApiKey: apiKey });

    const result = await provider({
      position: { latitude: 51.5074, longitude: -0.1278 },
      date: '2025-01-01',
    });

    expect(result.station.name).toBeTruthy();
    expect(result.station.name).toMatch(/\(.*\)/); // "Station (Atlas)" format
    expect(result.station.position.latitude).toBeCloseTo(51.5, 0);

    expect(result.extremes.length).toBeGreaterThan(0);

    const extreme = result.extremes[0];
    expect(['High', 'Low']).toContain(extreme.type);
    expect(typeof extreme.value).toBe('number');
    expect(extreme.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(new Date(extreme.time).toString()).not.toBe('Invalid Date');
  });

  it('returns 7 days of extremes', async () => {
    const app = createMockSignalKApp();
    const source = worldtidesSource(app);
    const provider = await source.start({ worldtidesApiKey: apiKey });

    const result = await provider({
      position: { latitude: 51.5074, longitude: -0.1278 },
      date: '2025-01-01',
    });

    // 7 days ~= 14 extremes (2 per day)
    expect(result.extremes.length).toBeGreaterThan(10);
  });

  it('returns values in reasonable range', async () => {
    const app = createMockSignalKApp();
    const source = worldtidesSource(app);
    const provider = await source.start({ worldtidesApiKey: apiKey });

    const result = await provider({
      position: { latitude: 51.5074, longitude: -0.1278 },
      date: '2025-01-01',
    });

    result.extremes.forEach(extreme => {
      expect(extreme.value).toBeGreaterThan(-5);
      expect(extreme.value).toBeLessThan(15);
    });
  });
});
