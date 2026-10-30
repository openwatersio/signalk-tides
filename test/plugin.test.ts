import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plugin, Position, ServerAPI } from "@signalk/server-api";
import { findStation, nearestStation, stationsNear } from "slackwater";
import createPlugin from '../src/index.js';

// Real lookups by default, so a test can make one reject or wait
vi.mock('slackwater', async (importOriginal) => {
  const actual = await importOriginal<typeof import('slackwater')>();
  return {
    ...actual,
    findStation: vi.fn(actual.findStation),
    nearestStation: vi.fn(actual.nearestStation),
    stationsNear: vi.fn(actual.stationsNear),
  };
});

const SF: Position = { latitude: 37.7749, longitude: -122.4194 };
// The nearest station here is a CHS record with no constituents, which predicts a flat zero tide
const HALIFAX: Position = { latitude: 44.65, longitude: -63.57 };
const HALIFAX_CHS_ID = 'chs-halifax';

interface StationOption {
  const: string;
  title: string;
}

async function stationOptions(plugin: Plugin): Promise<StationOption[]> {
  const schema = (await (plugin.schema as () => Promise<unknown>)()) as {
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
    getDataDirPath: vi.fn(() => mkdtempSync(join(tmpdir(), 'signalk-tides-test-'))),
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

// Keeps the next nearestStation call pending until the test releases it
function holdNextLookup() {
  type Station = Awaited<ReturnType<typeof nearestStation>>;
  let release!: (station: Station) => void;
  const result = new Promise<Station>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    vi.mocked(nearestStation).mockImplementationOnce(() => {
      resolve();
      return result;
    });
  });
  return { started, release };
}

function publishedStationNames(app: ServerAPI): unknown[] {
  return vi.mocked(app.handleMessage).mock.calls.flatMap(([, delta]) =>
    (delta.updates ?? [])
      .flatMap((u) => ("values" in u ? u.values : []))
      .filter((v) => v.path === "environment.tide.stationName")
      .map((v) => v.value),
  );
}

function publishedValue(app: ServerAPI, path: string): unknown {
  const delta = vi.mocked(app.handleMessage).mock.calls.at(-1)![1];
  return (delta.updates ?? [])
    .flatMap((u) => ("values" in u ? u.values : []))
    .find((v) => v.path === path)?.value;
}

function publishedStationName(app: ServerAPI): unknown {
  return publishedValue(app, "environment.tide.stationName");
}

describe('plugin', () => {
  let plugin: Plugin | undefined;

  afterEach(() => {
    plugin?.stop?.();
    plugin = undefined;
    vi.clearAllMocks();
  });

  describe('schema', () => {
    it('offers only "auto" before a position is known', async () => {
      const { app } = buildApp();
      plugin = createPlugin(app);

      expect(await stationOptions(plugin)).toEqual([
        { const: 'auto', title: 'Closest station' },
      ]);
    });

    it('lists nearby stations once a position is known', async () => {
      const { app, sendPosition } = buildApp();
      plugin = createPlugin(app);
      await plugin.start({}, () => {});
      await sendPosition(SF);

      const options = await stationOptions(plugin);
      const nearest = await nearestStation(SF);

      expect(options[0].const).toBe('auto');
      expect(options.length).toBeGreaterThan(1);
      expect(options.map((o) => o.const)).toContain(nearest.id);
      const nearestOption = options.find((o) => o.const === nearest.id)!;
      expect(nearestOption.title).toContain(nearest.name);
      expect(nearestOption.title).toMatch(/km$/);
    });

    it('keeps a saved station selectable when it is not nearby', async () => {
      const station = await nearestStation({ latitude: 42.35, longitude: -71.05 }); // Boston, far from SF
      const { app } = buildApp({ defaultStation: station.id });
      plugin = createPlugin(app);

      const options = await stationOptions(plugin);
      expect(options[0].const).toBe('auto');
      expect(options[1].const).toBe(station.id);
      expect(options[1].title).toContain(station.name);
    });

    it('omits stations with no tide model', async () => {
      const { app, sendPosition } = buildApp();
      plugin = createPlugin(app);
      await plugin.start({}, () => {});
      await sendPosition(HALIFAX);

      const unfiltered = await stationsNear({ ...HALIFAX, maxResults: 10 });
      expect(unfiltered.map((s) => s.id)).toContain(HALIFAX_CHS_ID);

      const options = await stationOptions(plugin);
      expect(options.length).toBeGreaterThan(1);
      expect(options.map((o) => o.const)).not.toContain(HALIFAX_CHS_ID);
    });

    it('keeps a saved station with an unknown id selectable', async () => {
      const { app } = buildApp({ defaultStation: 'stale/id' });
      plugin = createPlugin(app);

      expect((await stationOptions(plugin))[1]).toEqual({
        const: 'stale/id',
        title: 'stale/id',
      });
    });

    it('still resolves when the nearby lookup rejects', async () => {
      const { app, sendPosition } = buildApp({ defaultStation: 'stale/id' });
      plugin = createPlugin(app);
      await plugin.start({}, () => {});
      await sendPosition(SF);

      vi.mocked(stationsNear).mockRejectedValueOnce(new Error('database failed to load'));

      expect(await stationOptions(plugin)).toEqual([
        { const: 'auto', title: 'Closest station' },
        { const: 'stale/id', title: 'stale/id' },
      ]);
      expect(app.error).toHaveBeenCalledWith(expect.stringContaining('database failed to load'));
    });
  });

  describe('deltas', () => {
    it('publishes the nearest station by default', async () => {
      const { app, sendPosition } = buildApp();
      plugin = createPlugin(app);
      await plugin.start({}, () => {});
      await sendPosition(SF);

      expect(publishedStationName(app)).toBe((await nearestStation(SF)).name);
    });

    it('publishes the configured default station', async () => {
      // A real station near but not nearest to the SF position
      const station = (await stationsNear({ ...SF, maxResults: 5 })).at(-1)!;
      expect(station.id).not.toBe((await nearestStation(SF)).id);

      const { app, sendPosition } = buildApp();
      plugin = createPlugin(app);
      await plugin.start({ defaultStation: station.id }, () => {});
      await sendPosition(SF);

      expect(publishedStationName(app)).toBe(station.name);
    });

    it('publishes the configured default station without a position', async () => {
      const station = await nearestStation(SF);
      const { app, sendPosition } = buildApp();
      plugin = createPlugin(app);
      await plugin.start({ defaultStation: station.id }, () => {});
      await sendPosition(null as unknown as Position);

      expect(publishedStationName(app)).toBe(station.name);
    });

    it('skips a nearer station with no tide model', async () => {
      const unfiltered = await nearestStation(HALIFAX);
      expect(unfiltered.id).toBe(HALIFAX_CHS_ID);
      expect(unfiltered.harmonic_constituents).toHaveLength(0);

      const { app, sendPosition } = buildApp();
      plugin = createPlugin(app);
      await plugin.start({}, () => {});
      await sendPosition(HALIFAX);

      expect(publishedValue(app, 'environment.tide.heightNow')).not.toBe(0);
    });

    it('falls back to the nearest station when the configured one has no tide model', async () => {
      const { app, sendPosition } = buildApp();
      plugin = createPlugin(app);
      await plugin.start({ defaultStation: HALIFAX_CHS_ID }, () => {});
      await sendPosition(SF);

      expect(publishedStationName(app)).toBe((await nearestStation(SF)).name);
      expect(app.error).toHaveBeenCalledWith(expect.stringContaining('no tide predictions'));
    });

    it('does not reject when station lookups reject', async () => {
      const { app, sendPosition } = buildApp();
      plugin = createPlugin(app);
      await plugin.start({ defaultStation: 'noaa/9414290' }, () => {});

      vi.mocked(findStation).mockRejectedValueOnce(new Error('database failed to load'));
      vi.mocked(nearestStation).mockRejectedValueOnce(new Error('database failed to load'));
      await expect(sendPosition(SF)).resolves.toBeUndefined();

      expect(app.error).toHaveBeenCalledTimes(2);
      expect(app.setPluginError).toHaveBeenCalledWith(expect.stringContaining('database failed to load'));
      expect(app.handleMessage).not.toHaveBeenCalled();
    });

    it('still publishes when the position cannot be cached', async () => {
      const { app, sendPosition } = buildApp();
      vi.mocked(app.getDataDirPath).mockReturnValue('/dev/null/unwritable');
      plugin = createPlugin(app);
      await plugin.start({}, () => {});
      await sendPosition(SF);

      expect(app.error).toHaveBeenCalledWith(expect.stringContaining('cached position'));
      expect(publishedStationName(app)).toBe((await nearestStation(SF)).name);
    });

    it('does not let an older position overwrite a newer one', async () => {
      const older = await nearestStation({ latitude: 42.35, longitude: -71.05 }); // Boston
      const newer = await nearestStation(SF);
      const { app, sendPosition } = buildApp();
      plugin = createPlugin(app);
      await plugin.start({}, () => {});

      // Answer the older lookup only after the newer update has finished
      const lookup = holdNextLookup();
      const olderUpdate = sendPosition({ latitude: 42.35, longitude: -71.05 });
      await lookup.started;
      await sendPosition(SF);
      lookup.release(older);
      await olderUpdate;

      expect(publishedStationNames(app)).toEqual([newer.name]);
    });

    it('does not publish a lookup that finishes after stop', async () => {
      const station = await nearestStation(SF);
      const { app, sendPosition } = buildApp();
      plugin = createPlugin(app);
      await plugin.start({}, () => {});

      const lookup = holdNextLookup();
      const update = sendPosition(SF);
      await lookup.started;
      plugin.stop();
      lookup.release(station);
      await update;

      expect(app.handleMessage).not.toHaveBeenCalled();
    });
  });

  describe('start', () => {
    it('throws synchronously so the server can roll back', () => {
      const { app } = buildApp();
      vi.mocked(app.registerResourceProvider).mockImplementation(() => {
        throw new Error('already registered');
      });
      plugin = createPlugin(app);

      expect(() => plugin!.start({}, () => {})).toThrow('already registered');
    });

    it('stops serving the API after a failed start', () => {
      const { app } = buildApp();
      vi.mocked(app.registerResourceProvider).mockImplementation(() => {
        throw new Error('already registered');
      });
      plugin = createPlugin(app);
      expect(() => plugin!.start({}, () => {})).toThrow();

      const forward = (app as unknown as { use: Mock }).use.mock.calls[0][1];
      const next = vi.fn();
      forward({}, {}, next);

      expect(next).toHaveBeenCalledOnce();
    });
  });

  describe('plotter extension', () => {
    type ProviderMethods = {
      listResources: () => Promise<Record<string, unknown>>;
      getResource: (id: string) => Promise<unknown>;
    };

    function plotterExtensionProvider(app: ServerAPI): ProviderMethods {
      const registration = vi
        .mocked(app.registerResourceProvider)
        .mock.calls.find(([provider]) => provider.type === 'plotterExtensions');
      expect(registration, 'plotterExtensions provider registered').toBeDefined();
      return registration![0].methods as unknown as ProviderMethods;
    }

    it('offers the tide widget, whose tap opens the Tides app in a panel', async () => {
      const { app } = buildApp();
      plugin = createPlugin(app);
      await plugin.start({}, () => {});

      const manifests = await plotterExtensionProvider(app).listResources();
      const manifest = manifests['signalk-tides'] as {
        apiVersion: string;
        requires: string[];
        widgets: { id: string; url: string; size: string }[];
        panels: { id: string; url: string }[];
      };
      expect(manifest.apiVersion).toBe('1');
      expect(manifest.requires).toEqual(['widgets']);
      expect(manifest.widgets).toEqual([
        expect.objectContaining({
          id: 'tides',
          url: '/signalk-tides/widget.html',
          size: '2x1',
        }),
      ]);
      expect(manifest.panels).toEqual([
        expect.objectContaining({ id: 'tides', url: '/signalk-tides/' }),
      ]);
    });

    it('returns the manifest by id and rejects any other id', async () => {
      const { app } = buildApp();
      plugin = createPlugin(app);
      await plugin.start({}, () => {});
      const provider = plotterExtensionProvider(app);

      expect(await provider.getResource('signalk-tides')).toEqual(
        (await provider.listResources())['signalk-tides'],
      );
      await expect(provider.getResource('other')).rejects.toThrow();
    });
  });
});
