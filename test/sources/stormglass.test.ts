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
    const provider = await source.start({ stormglassApiKey: apiKey });

    const result = await provider({
      position: { latitude: 37.7749, longitude: -122.4194 },
      date: '2025-01-01',
    });

    expect(result.station.name).toBeTruthy();
    expect(result.station.name).toMatch(/\(.*\)/); // "Station (Source)" format
    expect(result.station.position.latitude).toBeDefined();
    expect(result.station.position.longitude).toBeDefined();

    expect(result.extremes.length).toBeGreaterThan(0);

    const extreme = result.extremes[0];
    expect(['High', 'Low']).toContain(extreme.type);
    expect(typeof extreme.value).toBe('number');
    expect(new Date(extreme.time).toString()).not.toBe('Invalid Date');
  });

  it('normalizes high/low type from lowercase', async () => {
    const app = createMockSignalKApp();
    const source = stormglassSource(app);
    const provider = await source.start({ stormglassApiKey: apiKey });

    const result = await provider({
      position: { latitude: 37.7749, longitude: -122.4194 },
      date: '2025-01-01',
    });

    result.extremes.forEach(extreme => {
      expect(['High', 'Low']).toContain(extreme.type);
    });
  });

  it('returns values in reasonable range', async () => {
    const app = createMockSignalKApp();
    const source = stormglassSource(app);
    const provider = await source.start({ stormglassApiKey: apiKey });

    const result = await provider({
      position: { latitude: 37.7749, longitude: -122.4194 },
      date: '2025-01-01',
    });

    result.extremes.forEach(extreme => {
      expect(extreme.value).toBeGreaterThan(-5);
      expect(extreme.value).toBeLessThan(10);
    });
  });
});
