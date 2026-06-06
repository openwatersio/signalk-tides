export interface WorldTidesApiResponse {
  status: number;
  error?: string;
  callCount: number;
  copyright: string;
  requestLat: number;
  requestLon: number;
  responseLat: number;
  responseLon: number;
  station: string;
  atlas: string;
  requestDatum?: string;
  responseDatum?: string;
  timezone?: string;
  extremes?: WorldTidesExtreme[];
  heights?: WorldTidesHeight[];
  stations?: WorldTidesStation[];
  datums?: WorldTidesDatum[];
}

export interface WorldTidesExtreme {
  dt: number;
  date: string;
  height: number;
  type: "High" | "Low";
}

export interface WorldTidesHeight {
  dt: number;
  date: string;
  height: number;
}

export interface WorldTidesStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  timezone: string;
}

export interface WorldTidesDatum {
  name: string;
  height: number;
}
