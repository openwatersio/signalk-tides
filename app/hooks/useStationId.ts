import { useCallback, useEffect, useState } from "react";

// The SignalK plugin resolves this id to the station nearest the vessel.
export const VESSEL_STATION_ID = "vessel/default";

// `||` (not `??`) so an empty `?station=` falls back to the vessel station too.
const readStation = () =>
  new URLSearchParams(window.location.search).get("station") || VESSEL_STATION_ID;

// Tracks the station being viewed in the `?station=` query param so the view is
// shareable and back/forward navigable. neaps owns the URL hash (TideStation's
// tabs), so keeping station in the query string sidesteps that namespace.
export function useStationId(): [string, (id: string) => void] {
  const [id, setId] = useState(readStation);

  useEffect(() => {
    const onPop = () => setId(readStation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const select = useCallback((raw: string) => {
    const next = raw.trim() || VESSEL_STATION_ID; // never write a blank id
    const url = new URL(window.location.href); // preserves neaps's #tab hash
    if (next === VESSEL_STATION_ID) url.searchParams.delete("station");
    else url.searchParams.set("station", next);
    // pushState (not replace) so the back button returns to the prior station.
    window.history.pushState(window.history.state, "", url);
    setId(next);
  }, []);

  return [id, select];
}
