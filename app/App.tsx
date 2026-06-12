import { NeapsProvider } from '@neaps/react'
import '@neaps/react/styles.css'
import './App.css'
import { TideStation } from '@neaps/react';

const VESSEL_STATION_ID = 'vessel/current';
const { VITE_SIGNALK_URL = window.location.toString() } = import.meta.env;
const API_BASE_URL = new URL("/signalk/v2/api", VITE_SIGNALK_URL).toString();

function App() {
  return (
    <NeapsProvider baseUrl={API_BASE_URL}>
      <TideStation id={VESSEL_STATION_ID} className="overflow-y-auto p-2 sm:p-4 md:p-6 lg:p-8 xl:p-20" />
    </NeapsProvider>
  )
}

export default App
