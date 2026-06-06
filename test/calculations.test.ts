import { describe, expect, it } from "vitest";
import { tideStateAt, timeToNextExtreme, approximateTideHeightAt } from "../src/calculations.js";
import type { Extreme } from "../src/types.js";

const extreme = (time: string, level: number, high: boolean): Extreme => ({
  time: new Date(time),
  level,
  high,
  low: !high,
  label: high ? "High" : "Low",
});

// One semidiurnal day in Boundary Pass-ish shape
const extremes: Extreme[] = [
  extreme("2026-06-05T00:00:00Z", 3.2, true),
  extreme("2026-06-05T06:12:00Z", 0.4, false),
  extreme("2026-06-05T12:30:00Z", 3.4, true),
  extreme("2026-06-05T18:45:00Z", 0.2, false),
];

describe("tideStateAt", () => {
  it("is falling when the next extreme is a Low", () => {
    expect(tideStateAt(extremes, new Date("2026-06-05T03:00:00Z"))).toBe("falling");
  });

  it("is rising when the next extreme is a High", () => {
    expect(tideStateAt(extremes, new Date("2026-06-05T09:00:00Z"))).toBe("rising");
  });

  it("reads as the extreme's own type at the exact extreme moment", () => {
    // Intentional boundary: at the instant of low water the Low itself is
    // still "next" (time >= now), so the state reads "falling" for that tick
    // and flips to "rising" on the next one.
    expect(tideStateAt(extremes, new Date("2026-06-05T06:12:00Z"))).toBe("falling");
  });

  it("handles unsorted input", () => {
    const shuffled = [extremes[2], extremes[0], extremes[3], extremes[1]];
    expect(tideStateAt(shuffled, new Date("2026-06-05T03:00:00Z"))).toBe("falling");
  });

  it("returns null when there is no upcoming extreme", () => {
    expect(tideStateAt(extremes, new Date("2026-06-05T19:00:00Z"))).toBeNull();
    expect(tideStateAt([], new Date("2026-06-05T03:00:00Z"))).toBeNull();
  });
});

describe("timeToNextExtreme", () => {
  it("returns seconds until the next extreme", () => {
    // 03:00 -> 06:12 Low = 3h12m
    expect(timeToNextExtreme(extremes, new Date("2026-06-05T03:00:00Z"))).toBe(11520);
    // 12:00 -> 12:30 High = 30m
    expect(timeToNextExtreme(extremes, new Date("2026-06-05T12:00:00Z"))).toBe(1800);
  });

  it("returns 0 exactly at an extreme", () => {
    expect(timeToNextExtreme(extremes, new Date("2026-06-05T06:12:00Z"))).toBe(0);
  });

  it("stays above 0 until the extreme is reached (rounds up)", () => {
    // 400ms before the Low: Math.round would report 0 early
    expect(timeToNextExtreme(extremes, new Date("2026-06-05T06:11:59.600Z"))).toBe(1);
  });

  it("returns null when there is no upcoming extreme", () => {
    expect(timeToNextExtreme(extremes, new Date("2026-06-05T19:00:00Z"))).toBeNull();
    expect(timeToNextExtreme([], new Date("2026-06-05T03:00:00Z"))).toBeNull();
  });
});

describe("approximateTideHeightAt", () => {
  it("interpolates the midpoint between extremes with sine easing", () => {
    // Halfway 06:12 -> 12:30 is 09:21; easeSine(0.5) = 0.5 -> mean of 0.4 and 3.4
    expect(approximateTideHeightAt(extremes, new Date("2026-06-05T09:21:00Z"))).toBeCloseTo(1.9, 3);
  });

  it("returns the extreme's value exactly at an extreme", () => {
    expect(approximateTideHeightAt(extremes, new Date("2026-06-05T06:12:00Z"))).toBe(0.4);
  });

  it("throws when data is missing before or after", () => {
    expect(() => approximateTideHeightAt(extremes, new Date("2026-06-04T00:00:00Z"))).toThrow();
    expect(() => approximateTideHeightAt(extremes, new Date("2026-06-06T00:00:00Z"))).toThrow();
  });
});
