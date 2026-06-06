import type { SignalKApp, TideSource, TideProvider, StationSummary } from "../types.js";
import {
  getExtremesPrediction,
  getTimelinePrediction,
  findStation,
  stationsNear,
} from "neaps";
import { stations, search, bbox, type Station } from "@neaps/tide-database";

function stripStationDetails(station: Station): StationSummary {
  const { id, name, region, country, continent, latitude, longitude, timezone, type } = station;
  return { id, name, region, country, continent, latitude, longitude, timezone, type };
}

export default function (app: SignalKApp): TideSource {
  return {
    id: "neaps",
    title: "Neaps",
    properties: {},

    start() {
      app.debug("Using Neaps");

      const provider: TideProvider = {
        getExtremesPrediction(options) {
          return getExtremesPrediction(options);
        },

        getTimelinePrediction(options) {
          return getTimelinePrediction(options);
        },

        findStation(id) {
          return findStation(id);
        },

        searchStations(query, options) {
          const limit = options?.maxResults ?? 10;
          return search(query).slice(0, limit).map(stripStationDetails);
        },

        stationsNear(options) {
          return stationsNear(options);
        },

        stationsWithin(box) {
          return bbox(box).map(stripStationDetails);
        },

        stations() {
          return stations.map(stripStationDetails);
        },

        getStationExtremes(id, options) {
          return findStation(id).getExtremesPrediction(options);
        },

        getStationTimeline(id, options) {
          return findStation(id).getTimelinePrediction(options);
        },
      };

      return provider;
    },
  };
}
