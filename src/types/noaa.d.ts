export interface NoaaStationsApiResponse {
  count: number;
  stations: NoaaStation[];
}

export interface NoaaStation {
  state: string;
  tidepredoffsets: {
    self: string;
  };
  type: "R" | "S";
  timemeridian: number | null;
  reference_id: string;
  timezonecorr: number;
  id: string;
  name: string;
  lat: number;
  lng: number;
  affiliations: string;
  portscode: string;
  products: null;
  disclaimers: null;
  notices: null;
  self: null;
  expand: null;
  tideType: string;
}

export interface NoaaDatum {
  name: string;
  description: string;
  value: number;
}

export interface NoaaDatumsApiResponse {
  units: string;
  datums?: NoaaDatum[];
}

interface NoaaPredictionApiResponse {
  predictions: NoaaTidePrediction[];
  error?: {
    message: string;
  }
}

interface NoaaTidePrediction {
  t: string;
  v: string;
  type: string;
}
