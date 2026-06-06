export interface StormGlassExtremesResponse {
  data: StormGlassExtreme[];
  meta: StormGlassMeta;
}

export interface StormGlassExtreme {
  height: number;
  time: string;
  type: "high" | "low";
}

export interface StormGlassSeaLevelResponse {
  data: StormGlassSeaLevelEntry[];
  meta: StormGlassMeta;
}

export interface StormGlassSeaLevelEntry {
  time: string;
  sg: number;
}

export interface StormGlassStationsResponse {
  data: StormGlassStationData[];
  meta: { cost: number; dailyQuota: number; requestCount: number };
}

export interface StormGlassStationData {
  name: string;
  lat: number;
  lng: number;
  source: string;
}

export interface StormGlassMeta {
  cost: number;
  dailyQuota: number;
  end: string;
  lat: number;
  lng: number;
  requestCount: number;
  start: string;
  datum?: string;
  station: StormGlassMetaStation;
}

export interface StormGlassMetaStation {
  distance: number;
  lat: number;
  lng: number;
  name: string;
  source: string;
}
