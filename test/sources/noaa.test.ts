import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import noaaSource from '../../src/sources/noaa.js';
import { createMockSignalKApp } from '../test-helpers.js';
import { useVCR, saveVCR } from '../vcr-helper.js';

describe('NOAA Source', () => {
  let tmpDir: string;
  const cassette = 'noaa.json';

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'noaa-test-'));
    await useVCR({ cassettePath: cassette });
  });

  afterEach(async () => {
    await saveVCR(cassette);
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('loads stations and returns tide predictions for SF', async () => {
    const app = createMockSignalKApp(tmpDir);
    const source = noaaSource(app);
    const provider = await source.start({});

    const result = await provider({
      position: { latitude: 37.7749, longitude: -122.4194 },
      date: '2025-01-01',
    });

    expect(result.station.name).toBeTruthy();
    expect(result.station.position.latitude).toBeCloseTo(37.8, 0);
    expect(result.station.position.longitude).toBeCloseTo(-122.5, 0);

    expect(result.extremes.length).toBeGreaterThan(0);

    const extreme = result.extremes[0];
    expect(['High', 'Low']).toContain(extreme.type);
    expect(typeof extreme.value).toBe('number');
    expect(new Date(extreme.time).toString()).not.toBe('Invalid Date');
  });

  it('returns values in meters (reasonable range)', async () => {
    const app = createMockSignalKApp(tmpDir);
    const source = noaaSource(app);
    const provider = await source.start({});

    const result = await provider({
      position: { latitude: 37.7749, longitude: -122.4194 },
      date: '2025-01-01',
    });

    result.extremes.forEach(extreme => {
      expect(extreme.value).toBeGreaterThan(-5);
      expect(extreme.value).toBeLessThan(10);
    });
  });

  it('returns 7 days of extremes', async () => {
    const app = createMockSignalKApp(tmpDir);
    const source = noaaSource(app);
    const provider = await source.start({});

    const result = await provider({
      position: { latitude: 37.7749, longitude: -122.4194 },
      date: '2025-01-01',
    });

    // 7 days ~= 14 extremes (2 per day)
    expect(result.extremes.length).toBeGreaterThan(10);
  });
});
