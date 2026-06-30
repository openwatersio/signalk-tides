import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plugin, Position, ServerAPI } from "@signalk/server-api";
import { nearestStation, stationsNear } from "neaps";
import createPlugin from '../src/index.js';

const SF: Position = { latitude: 37.7749, longitude: -122.4194 };

interface StationOption {
  const: string;
  title: string;
}

function stationOptions(plugin: Plugin): StationOption[] {
  const schema = (plugin.schema as () => never)() as {
    properties: { defaultStation: { oneOf: StationOption[] } };
  };
  return schema.properties.defaultStation.oneOf;
}

function buildApp(configuration?: { defaultStation?: string }) {
  let onPositionDelta: (() => Promise<void>) | undefined;

  const app = {
    debug: Object.assign(vi.fn(), { enabled: false }),
    error: vi.fn(),
    setPluginStatus: vi.fn(),
    setPluginError: vi.fn(),
    selfId: 'urn:mrn:imo:mmsi:000000000',
    use: vi.fn(),
    getDataDirPath: () => mkdtempSync(join(tmpdir(), 'signalk-tides-test-')),
    readPluginOptions: vi.fn(() => ({ configuration })),
    registerResourceProvider: vi.fn(),
    handleMessage: vi.fn(),
    getSelfPath: vi.fn(),
    subscriptionmanager: {
      subscribe: vi.fn(
        (
          _subscription: unknown,
          _unsubscribes: unknown,
          _onError: unknown,
          onDelta: () => Promise<void>,
        ) => {
          onPositionDelta = onDelta;
        },
      ),
    },
  };

  return {
    app: app as unknown as ServerAPI,
    // Simulates a navigation.position delta arriving
    async sendPosition(position: Position) {
      app.getSelfPath.mockReturnValue(position);
      await onPositionDelta?.();
    },
  };
}

function publishedStationName(app: ServerAPI): unknown {
  const delta = vi.mocked(app.handleMessage).mock.calls.at(-1)![1];
  return (delta.updates ?? [])
    .flatMap((u) => ("values" in u ? u.values : []))
    .find((v) => v.path === "environment.tide.stationName")?.value;
}

describe('plugin', () => {
  let plugin: Plugin | undefined;

  afterEach(() => {
    plugin?.stop?.();
    plugin = undefined;
  });

  describe('schema', () => {
    it('offers only "auto" before a position is known', () => {
      const { app } = buildApp();
      plugin = createPlugin(app);

      expect(stationOptions(plugin)).toEqual([
        { const: 'auto', title: 'Closest station' },
      ]);
    });

    it('lists nearby stations once a position is known', async () => {
      const { app, sendPosition } = buildApp();
      plugin = createPlugin(app);
      await plugin.start({}, () => {});
      await sendPosition(SF);

      const options = stationOptions(plugin);
      const nearest = nearestStation(SF);

      expect(options[0].const).toBe('auto');
      expect(options.length).toBeGreaterThan(1);
      expect(options.map((o) => o.const)).toContain(nearest.id);
      const nearestOption = options.find((o) => o.const === nearest.id)!;
      expect(nearestOption.title).toContain(nearest.name);
      expect(nearestOption.title).toMatch(/km$/);
    });

    it('keeps a saved station selectable when it is not nearby', () => {
      const station = nearestStation({ latitude: 42.35, longitude: -71.05 }); // Boston, far from SF
      const { app } = buildApp({ defaultStation: station.id });
      plugin = createPlugin(app);

      const options = stationOptions(plugin);
      expect(options[0].const).toBe('auto');
      expect(options[1].const).toBe(station.id);
      expect(options[1].title).toContain(station.name);
    });

    it('keeps a saved station with an unknown id selectable', () => {
      const { app } = buildApp({ defaultStation: 'stale/id' });
      plugin = createPlugin(app);

      expect(stationOptions(plugin)[1]).toEqual({
        const: 'stale/id',
        title: 'stale/id',
      });
    });
  });

  describe('deltas', () => {
    it('publishes the nearest station by default', async () => {
      const { app, sendPosition } = buildApp();
      plugin = createPlugin(app);
      await plugin.start({}, () => {});
      await sendPosition(SF);

      expect(publishedStationName(app)).toBe(nearestStation(SF).name);
    });

    it('publishes the configured default station', async () => {
      // A real station near but not nearest to the SF position
      const station = stationsNear({ ...SF, maxResults: 5 }).at(-1)!;
      expect(station.id).not.toBe(nearestStation(SF).id);

      const { app, sendPosition } = buildApp();
      plugin = createPlugin(app);
      await plugin.start({ defaultStation: station.id }, () => {});
      await sendPosition(SF);

      expect(publishedStationName(app)).toBe(station.name);
    });

    it('publishes the configured default station without a position', async () => {
      const station = nearestStation(SF);
      const { app, sendPosition } = buildApp();
      plugin = createPlugin(app);
      await plugin.start({ defaultStation: station.id }, () => {});
      await sendPosition(null as unknown as Position);

      expect(publishedStationName(app)).toBe(station.name);
    });
  });
});
