import { useEffect, useRef, useState } from "react";
import {
  NearbyStations,
  StationSearch,
  StationsMap,
  useStation,
  type StationSummary,
} from "@neaps/react";
import { VESSEL_STATION_ID } from "./hooks/useStationId";

// No API key needed; OSM raster tiles are enough for browsing stations.
const MAP_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
};

interface StationBrowserProps {
  stationId: string;
  onSelect: (id: string) => void;
}

export function StationBrowser({ stationId, onSelect }: StationBrowserProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  // Only mount the map (WebGL) on desktop, matching the `lg` breakpoint.
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // The active station's coordinates, used to centre and highlight the map.
  // Resolves `vessel/default` to its real station server-side, same as TideStation.
  const { data: current } = useStation(stationId);

  const show = () => {
    setOpen(true);
    dialog.current?.showModal();
  };

  const select = (station: StationSummary) => {
    onSelect(station.id);
    dialog.current?.close();
  };

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-label="Browse stations"
        className="absolute hidden min-[25rem]:block right-2 top-2 sm:right-4 sm:top-4 md:right-6 md:top-6 lg:right-8 lg:top-8 xl:right-20 xl:top-20 z-10 rounded-md border border-(--neaps-border) bg-(--neaps-bg-subtle) p-2 text-(--neaps-text) hover:bg-(--neaps-bg)"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        className="m-auto w-[min(92vw,900px)] max-h-[85vh] rounded-lg border border-(--neaps-border) bg-(--neaps-bg) p-0 text-(--neaps-text) backdrop:bg-black/50"
      >
        {open && (
          <div className="flex max-h-[85vh] flex-col">
            <div className="flex items-center justify-between border-b border-(--neaps-border) p-3">
              <h2 className="text-base font-semibold">Stations</h2>
              <button
                type="button"
                onClick={() => dialog.current?.close()}
                aria-label="Close"
                className="rounded-md p-1 text-(--neaps-text-muted) hover:text-(--neaps-text)"
              >
                ✕
              </button>
            </div>

            <div className="flex min-h-0 flex-col gap-4 p-3 lg:flex-row">
              <div className="flex w-full flex-col gap-3 overflow-y-auto lg:w-80">
                <StationSearch onSelect={select} />
                <button
                  type="button"
                  onClick={() => select({ id: VESSEL_STATION_ID } as StationSummary)}
                  className="rounded-md border border-(--neaps-border) px-3 py-2 text-left text-sm hover:bg-(--neaps-bg-subtle)"
                >
                  📍 Vessel position
                </button>
                <NearbyStations stationId={stationId} onStationSelect={select} />
              </div>

              {desktop && current && (
                <div className="min-h-[400px] flex-1 overflow-hidden rounded-md border border-(--neaps-border)">
                  <StationsMap
                    mapStyle={MAP_STYLE}
                    initialViewState={{
                      longitude: current.longitude,
                      latitude: current.latitude,
                      zoom: 10,
                    }}
                    focusStation={current.id}
                    onStationSelect={select}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
