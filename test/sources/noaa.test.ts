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
    const provider = await source.start({ _fetch: fetch });

    const now = new Date('2025-01-01');
    const result = await provider.getExtremesPrediction({
      latitude: 37.7749,
      longitude: -122.4194,
      start: now,
      end: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    expect(result.station.name).toBeTruthy();
    expect(result.station.latitude).toBeCloseTo(37.8, 0);
    expect(result.station.longitude).toBeCloseTo(-122.5, 0);

    // Datums are fetched from NOAA and filtered to valid prediction datums
    // (ranges/intervals like GT/MN/HWI and the NAVD88 alias are excluded).
    expect(Object.keys(result.station.datums ?? {})).toEqual(
      expect.arrayContaining(['MLLW', 'MSL', 'MHW']),
    );
    expect(result.station.datums).not.toHaveProperty('GT');
    expect(result.station.datums).not.toHaveProperty('NAVD88');

    expect(result.extremes.length).toBeGreaterThan(0);

    const extreme = result.extremes[0];
    expect(['High', 'Low']).toContain(extreme.label);
    expect(typeof extreme.level).toBe('number');
    expect(extreme.time).toBeInstanceOf(Date);
  });

  it('returns values in meters (reasonable range)', async () => {
    const app = createMockSignalKApp(tmpDir);
    const source = noaaSource(app);
    const provider = await source.start({ _fetch: fetch });

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

  it('returns 7 days of extremes', async () => {
    const app = createMockSignalKApp(tmpDir);
    const source = noaaSource(app);
    const provider = await source.start({ _fetch: fetch });

    const now = new Date('2025-01-01');
    const result = await provider.getExtremesPrediction({
      latitude: 37.7749,
      longitude: -122.4194,
      start: now,
      end: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    // 7 days ~= 14 extremes (2 per day)
    expect(result.extremes.length).toBeGreaterThan(10);
  });
});
