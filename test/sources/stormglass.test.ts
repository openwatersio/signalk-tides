import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import stormglassSource from '../../src/sources/stormglass.js';
import { createMockSignalKApp } from '../test-helpers.js';
import { useVCR, saveVCR } from '../vcr-helper.js';

const apiKey = process.env.STORMGLASS_API_KEY ?? 'test-key';

describe('StormGlass Source', () => {
  const cassette = 'stormglass.json';

  beforeEach(async () => {
    await useVCR({ cassettePath: cassette });
  });

  afterEach(async () => {
    await saveVCR(cassette);
  });

  it('has correct metadata', () => {
    const app = createMockSignalKApp();
    const source = stormglassSource(app);

    expect(source.id).toBe('stormglass');
    expect(source.properties).toEqual({
      stormglassApiKey: { type: 'string', title: 'StormGlass.io API key' },
    });
  });

  it('returns tide extremes', async () => {
    const app = createMockSignalKApp();
    const source = stormglassSource(app);
    const provider = await source.start({ stormglassApiKey: apiKey, _fetch: fetch });

    const now = new Date('2025-01-01');
    const result = await provider.getExtremesPrediction({
      latitude: 37.7749,
      longitude: -122.4194,
      start: now,
      end: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    expect(result.station.name).toBeTruthy();
    expect(result.station.latitude).toBeDefined();
    expect(result.station.longitude).toBeDefined();

    expect(result.extremes.length).toBeGreaterThan(0);

    const extreme = result.extremes[0];
    expect(['High', 'Low']).toContain(extreme.label);
    expect(typeof extreme.level).toBe('number');
    expect(extreme.time).toBeInstanceOf(Date);
  });

  it('normalizes high/low type from lowercase', async () => {
    const app = createMockSignalKApp();
    const source = stormglassSource(app);
    const provider = await source.start({ stormglassApiKey: apiKey, _fetch: fetch });

    const now = new Date('2025-01-01');
    const result = await provider.getExtremesPrediction({
      latitude: 37.7749,
      longitude: -122.4194,
      start: now,
      end: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    result.extremes.forEach(extreme => {
      expect(['High', 'Low']).toContain(extreme.label);
    });
  });

  it('returns values in reasonable range', async () => {
    const app = createMockSignalKApp();
    const source = stormglassSource(app);
    const provider = await source.start({ stormglassApiKey: apiKey, _fetch: fetch });

    const now = new Date('2025-01-01');
    const result = await provider.getExtremesPrediction({
      latitude: 37.7749,
      longitude: -122.4194,
      start: now,
      end: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    result.extremes.forEach(extreme => {
      expect(extreme.level).toBeGreaterThan(-5);
      expect(extreme.level).toBeLessThan(10);
    });
  });
});
