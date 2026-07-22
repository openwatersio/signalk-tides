import { describe, it, expect, vi } from "vitest";
import {
  buildManifest,
  registerTideGraphWidget,
  PACKAGE_NAME,
} from "../src/plotterext.js";

describe("buildManifest", () => {
  const manifest = buildManifest();

  it("advertises API version 1 and requires the widgets capability", () => {
    expect(manifest.apiVersion).toBe("1");
    expect(manifest.requires).toContain("widgets");
    // Data is same-origin REST, so no stream requirement.
    expect(manifest.requires).not.toContain("signalk.stream");
    expect(manifest.optional).toEqual(
      expect.arrayContaining(["units", "panels.iframe", "map"]),
    );
  });

  it("declares exactly one 2x1 graph widget served from the public route", () => {
    expect(manifest.widgets).toHaveLength(1);
    const [widget] = manifest.widgets;
    expect(widget.id).toBe("graph");
    expect(widget.title).toBe("Tide Cycle (Advanced)");
    expect(widget.type).toBe("iframe");
    expect(widget.size).toBe("2x1");
    expect(widget.size).toMatch(/^[12]x[12]$/);
    expect(widget.url).toBe("/plotterext/signalk-tides/graph.html");
    expect(widget.configPanel).toBe("graph-config");
  });

  it("declares the graph-config panel", () => {
    expect(manifest.panels).toHaveLength(1);
    const [panel] = manifest.panels;
    expect(panel.id).toBe("graph-config");
    expect(panel.type).toBe("iframe");
    expect(panel.url).toBe("/plotterext/signalk-tides/config.html");
  });

  it("includes the package version", () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("registerTideGraphWidget", () => {
  function fakeApp() {
    return {
      use: vi.fn(),
      registerResourceProvider: vi.fn(),
      debug: vi.fn(),
    };
  }

  it("serves assets on a public, non-admin route", () => {
    const app = fakeApp();
    registerTideGraphWidget(app as never);
    expect(app.use).toHaveBeenCalledWith(
      "/plotterext/signalk-tides",
      expect.any(Function),
    );
    // The public route is deliberately not under /plugins/*.
    const [route] = app.use.mock.calls[0];
    expect(route).not.toMatch(/^\/plugins\b/);
  });

  it("registers a read-only plotterExtensions provider keyed by the package name", async () => {
    const app = fakeApp();
    registerTideGraphWidget(app as never);

    expect(app.registerResourceProvider).toHaveBeenCalledTimes(1);
    const { type, methods } = app.registerResourceProvider.mock.calls[0][0];
    expect(type).toBe("plotterExtensions");

    const list = await methods.listResources();
    expect(Object.keys(list)).toEqual([PACKAGE_NAME]);

    const resource = await methods.getResource(PACKAGE_NAME);
    expect(resource).toMatchObject({ apiVersion: "1", name: "Tides" });

    await expect(methods.getResource("something-else")).rejects.toThrow();
    expect(() => methods.setResource()).toThrow(/read-only/);
    expect(() => methods.deleteResource()).toThrow(/read-only/);
  });
});
