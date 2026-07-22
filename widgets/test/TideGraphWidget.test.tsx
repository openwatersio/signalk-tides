import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Fake host bus: answers units.get, map.getView, and the persisted config so
// the widget resolves without the real postMessage handshake. This mirrors a
// conforming host — the widget's tide data still comes from the (dev-proxied)
// Neaps API, exactly as in production. Individual tests tune state.get to pick
// the location mode.
const fakeClient = {
  hasCapability: () => true,
  call: vi.fn(async (method: string) => {
    if (method === "units.get") return { units: { depth: "foot" } };
    // San Francisco Bay, [lon, lat] — same area as the dev server's mock vessel.
    if (method === "map.getView") return { center: [-122.4194, 37.7749] };
    return undefined;
  }),
  state: {
    get: vi.fn(async (): Promise<Record<string, unknown>> => ({ window: "24h" })),
    set: vi.fn(async () => {}),
  },
  subscribe: vi.fn(async () => async () => {}),
  close: vi.fn(),
};

vi.mock("signalk-plotterext-bus/extension", () => ({
  connectExtension: vi.fn(async () => fakeClient),
}));

// Imported after the mock is registered.
const { TideGraphWidget } = await import("../web/TideGraphWidget");

describe("TideGraphWidget", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    fakeClient.state.get.mockResolvedValue({ window: "24h" });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("renders the tide graph, without a header or table, and without errors", async () => {
    const { container } = render(<TideGraphWidget />);

    // The graph-only component renders an SVG chart from real Neaps data.
    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull(), {
      timeout: 10_000,
    });

    // Graph-only: no TideTable and no station-name heading (TideStationHeader).
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();

    // The resolved station's name is shown in the corner.
    await waitFor(() =>
      expect(
        container.querySelector(".tide-graph-station")?.textContent?.trim(),
      ).toBeTruthy(),
    );

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it("follows the chart centre when in chart-location mode", async () => {
    fakeClient.state.get.mockResolvedValue({
      window: "24h",
      locationMode: "chart",
    });

    const { container } = render(<TideGraphWidget />);

    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull(), {
      timeout: 10_000,
    });

    // Chart-follow reads the starting view via map.getView and subscribes to
    // the map.view viewport event to track pan/zoom.
    expect(fakeClient.call).toHaveBeenCalledWith("map.getView");
    expect(fakeClient.subscribe).toHaveBeenCalledWith(
      ["map.view"],
      expect.any(Function),
    );
    // ...and the graph still renders cleanly from the location-based query.
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});
