import { useEffect, useState } from "react";
import { type Units, getDefaultUnits } from "@neaps/react";

const { VITE_SIGNALK_URL = window.location.toString() } = import.meta.env;
export const UNIT_PREFERENCES_URL = new URL(
  "/signalk/v1/unitpreferences/active",
  VITE_SIGNALK_URL,
).toString();

interface ActivePreset {
  categories?: Record<string, { targetUnit?: string }>;
}

export interface UnitPreferences {
  // Resolved display units, with the locale-based fallback already applied.
  units: Units;
  // False while the active preset is being fetched. Callers gate rendering on
  // this so the tide API isn't queried with the wrong units and then refetched.
  ready: boolean;
}

// Maps the SignalK `depth` category's targetUnit onto a neaps `Units` value.
// The six built-in presets only ever use "foot" or "m" for depth; anything
// else (custom unit, missing category) falls back to the locale default.
function unitsFromPreset(preset: ActivePreset, fallback: Units): Units {
  switch (preset.categories?.depth?.targetUnit) {
    case "foot":
      return "feet";
    case "m":
      return "meters";
    default:
      return fallback;
  }
}

// Reads the active SignalK unit-preferences preset so the tide chart honours
// the units the user configured on the server (per-user when logged in, server
// default otherwise). Falls back to the locale-based guess on older servers
// that don't expose /signalk/v1/unitpreferences/active.
export function useUnitPreferences(): UnitPreferences {
  const [prefs, setPrefs] = useState<UnitPreferences>({
    units: getDefaultUnits(navigator.language),
    ready: false,
  });

  useEffect(() => {
    let cancelled = false;
    const fallback = getDefaultUnits(navigator.language);

    (async () => {
      try {
        const res = await fetch(UNIT_PREFERENCES_URL, { credentials: "include" });
        if (!res.ok) {
          // Older server without the unit-preferences API.
          if (!cancelled) setPrefs({ units: fallback, ready: true });
          return;
        }
        const body = (await res.json()) as ActivePreset;
        if (cancelled) return;
        setPrefs({ units: unitsFromPreset(body, fallback), ready: true });
      } catch {
        if (!cancelled) setPrefs({ units: fallback, ready: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return prefs;
}
