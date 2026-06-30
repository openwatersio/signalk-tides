import { NeapsProvider } from '@neaps/react'
import './App.css'
import { TideStation } from '@neaps/react';
import { useUnitPreferences } from './hooks/useUnitPreferences'
import { useStationId } from './hooks/useStationId'
import { StationBrowser } from './StationBrowser'

const { VITE_SIGNALK_URL = window.location.toString() } = import.meta.env;
const API_BASE_URL = new URL("/signalk/v2/api", VITE_SIGNALK_URL).toString();

function App() {
  // `units` feeds the tide API request, so wait until the active preset has
  // resolved before mounting the provider — otherwise neaps fetches with the
  // wrong units and then refetches (the chart flips units) once they load.
  const { units, ready } = useUnitPreferences();
  const [stationId, selectStation] = useStationId();

  if (!ready) return null;

  return (
    <NeapsProvider baseUrl={API_BASE_URL} units={units}>
      <div className="relative">
        <StationBrowser stationId={stationId} onSelect={selectStation} />
        <TideStation id={stationId} className="overflow-y-auto p-2 sm:p-4 md:p-6 lg:p-8 xl:p-20" />
      </div>
    </NeapsProvider>
  )
}

export default App
