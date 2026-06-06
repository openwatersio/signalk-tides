import type { Extreme } from './types.js';

/** Given a list of tide extremes, estimate the height at a specific time. */
export function approximateTideHeightAt(extremes: Extreme[], time: Date): number | null {
  const sorted = extremes.slice().sort((a, b) => a.time.getTime() - b.time.getTime());
  const prev = sorted.filter(h => h.time <= time).at(-1);
  const next = sorted.filter(h => h.time >= time).at(0);

  if (!prev) throw new Error("Missing height data before " + time.toISOString());
  if (!next) throw new Error("Missing height data after " + time.toISOString());

  const progress = (time.getTime() - prev.time.getTime()) /
    (next.time.getTime() - prev.time.getTime());

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
