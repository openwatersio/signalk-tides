import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import worldtidesSource from '../../src/sources/worldtides.js';
import { createMockSignalKApp } from '../test-helpers.js';
import { useVCR, saveVCR } from '../vcr-helper.js';

const apiKey = process.env.WORLDTIDES_API_KEY ?? 'test-key';

describe('WorldTides Source', () => {
  const cassette = 'worldtides.json';
  let tmpDir: string;

  const redact = ['key'];

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'worldtides-test-'));
    await useVCR({ cassettePath: cassette, redact });
  });

  afterEach(async () => {
    await saveVCR(cassette, redact);
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('has correct metadata', () => {
    const app = createMockSignalKApp(tmpDir);
    const source = worldtidesSource(app);

    expect(source.id).toBe('worldtides');
    expect(source.properties).toEqual({
      worldtidesApiKey: { type: 'string', title: 'WorldTides.info API key' },
    });
  });

  it('returns tide extremes for London', async () => {
    const app = createMockSignalKApp(tmpDir);
    const source = worldtidesSource(app);
    const provider = await source.start({ worldtidesApiKey: apiKey, _fetch: fetch });

    const now = new Date('2025-01-01');
    const result = await provider.getExtremesPrediction({
      latitude: 51.5074,
      longitude: -0.1278,
      start: now,
      end: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    expect(result.station.name).toBeTruthy();
    expect(result.station.latitude).toBeCloseTo(51.5, 0);

    // Datums are fetched (and cached) from WorldTides' datums endpoint
    expect(Object.keys(result.station.datums ?? {})).toEqual(
      expect.arrayContaining(['LAT', 'MLLW', 'MSL', 'MHW', 'HAT']),
    );

    expect(result.extremes.length).toBeGreaterThan(0);

    const extreme = result.extremes[0];
    expect(['High', 'Low']).toContain(extreme.label);
    expect(typeof extreme.level).toBe('number');
    expect(extreme.time).toBeInstanceOf(Date);
  });

  it('returns 7 days of extremes', async () => {
    const app = createMockSignalKApp(tmpDir);
    const source = worldtidesSource(app);
    const provider = await source.start({ worldtidesApiKey: apiKey, _fetch: fetch });

    const now = new Date('2025-01-01');
    const result = await provider.getExtremesPrediction({
      latitude: 51.5074,
      longitude: -0.1278,
      start: now,
      end: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    // 7 days ~= 14 extremes (2 per day)
    expect(result.extremes.length).toBeGreaterThan(10);
  });

  it('returns values in reasonable range', async () => {
    const app = createMockSignalKApp(tmpDir);
    const source = worldtidesSource(app);
    const provider = await source.start({ worldtidesApiKey: apiKey, _fetch: fetch });

    const now = new Date('2025-01-01');
    const result = await provider.getExtremesPrediction({
      latitude: 51.5074,
      longitude: -0.1278,
      start: now,
      end: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    result.extremes.forEach(extreme => {
      expect(extreme.level).toBeGreaterThan(-5);
      expect(extreme.level).toBeLessThan(15);
    });
  });
});
