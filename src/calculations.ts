import type { Extreme } from './types.js';

/** Given a list of tide extremes, estimate the height at a specific time. */
export function approximateTideHeightAt(extremes: Extreme[], time: Date): number | null {
  const sorted = extremes.slice().sort((a, b) => a.time.getTime() - b.time.getTime());
  const prev = sorted.filter(h => h.time <= time).at(-1);
  const next = sorted.filter(h => h.time >= time).at(0);

  if (!prev) throw new Error("Missing height data before " + time.toISOString());
  if (!next) throw new Error("Missing height data after " + time.toISOString());

  const prevTime = prev.time.getTime();
  const nextTime = next.time.getTime();
  // Exactly at an extreme prev === next; avoid 0/0 -> NaN
  if (prevTime === nextTime) return parseFloat(prev.level.toFixed(3));

  const progress = (time.getTime() - prevTime) / (nextTime - prevTime);

  const value = interpolate(prev.level, next.level, easeSine(progress));

  return parseFloat(value.toFixed(3));
}

/** Interpolate between two values using the given progress (0-1). */
function interpolate(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function easeSine(progress: number) {
  // Map progress [0..1] to angle [0..π]
  const angle = progress * Math.PI;
  // Use sine to ease in/out
  return (1 - Math.cos(angle)) / 2;
}

export type TideState = "rising" | "falling";

/**
 * Trend of the tide at `time`: "rising" if the next extreme is a High,
 * "falling" if it is a Low.
 *
 * Boundary: at the instant of an extreme the extreme itself satisfies
 * `extreme.time >= time`, so it is still "next", and the state reads as that
 * extreme's own type — e.g. "falling" with timeToNextExtreme 0 at the instant
 * of low water — flipping on the following tick. Simplest consistent rule at
 * one-minute resolution.
 *
 * Returns null when the forecast has no upcoming extreme (stale data).
 */
export function tideStateAt(extremes: Extreme[], time: Date): TideState | null {
  const next = nextExtremeAt(extremes, time);
  if (!next) return null;
  return next.high ? "rising" : "falling";
}

/** First extreme at or after `time`, or undefined. Tolerates unsorted input. */
function nextExtremeAt(extremes: Extreme[], time: Date): Extreme | undefined {
  return extremes
    .slice()
    .sort((a, b) => a.time.getTime() - b.time.getTime())
    .find((extreme) => extreme.time >= time);
}

/**
 * Whole seconds (rounded up) until the next tide extreme (high or low water)
 * at `time`, or null when the forecast has no upcoming extreme. Ceiling keeps
 * the countdown > 0 until the extreme is actually reached; see tideStateAt
 * for the exactly-at-extreme boundary behaviour (this returns 0 for that tick).
 */
export function timeToNextExtreme(extremes: Extreme[], time: Date): number | null {
  const next = nextExtremeAt(extremes, time);
  if (!next) return null;
  return Math.ceil((next.time.getTime() - time.getTime()) / 1000);
}
