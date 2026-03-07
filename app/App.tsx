import { NeapsProvider } from '@neaps/react'
import '@neaps/react/styles.css'
import './App.css'
import { Footer } from './components/Footer'
import { TideStation } from '@neaps/react';

const VESSEL_STATION_ID = 'vessel/current';
const { VITE_SIGNALK_URL = window.location.toString() } = import.meta.env;
const API_BASE_URL = new URL("/signalk/v2/api", VITE_SIGNALK_URL).toString();

function App() {
  return (
    <NeapsProvider baseUrl={API_BASE_URL}>
      <TideStation id={VESSEL_STATION_ID} className="p-8" />
      <Footer />
    </NeapsProvider>
  )
}

export default App
