import { Router } from "express";
import { openapi } from "@neaps/api";
import type { TideProvider } from "./types.js";

/**
 * Create Express routes that implement a @neaps/api-compatible API
 * backed by the given tide provider.
 */
export function createAdapterRoutes(provider: TideProvider) {
  const router = Router();

  router.get("/", (req, res) => {
    res.json({
      name: "Tides API",
      version: openapi.info.version,
      docs: `${req.baseUrl}/openapi.json`,
    });
  });

  router.get("/openapi.json", (req, res) => {
    res.json({ ...openapi, servers: [{ url: req.baseUrl || "/" }] });
  });

  router.get("/extremes", async (req, res) => {
    const { latitude, longitude } = req.query;

    if (!latitude || !longitude) {
      return res
        .status(400)
        .json({ message: "latitude and longitude are required" });
    }

    try {
      const result = await provider.getExtremesPrediction(
        parsePredictionOptions(req.query),
      );

      res.json({
        ...result,
        extremes: result.extremes.map(serializeExtreme),
      });
    } catch (error: unknown) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  router.get("/timeline", async (req, res) => {
    const { latitude, longitude } = req.query;

    if (!latitude || !longitude) {
      return res
        .status(400)
        .json({ message: "latitude and longitude are required" });
    }

    try {
      const result = await provider.getTimelinePrediction(
        parsePredictionOptions(req.query),
      );

      res.json({
        ...result,
        timeline: result.timeline.map(serializeTimelineEntry),
      });
    } catch (error: unknown) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  // Station endpoints — delegate to provider if supported

  router.get("/stations", async (req, res) => {
    const { query, latitude, longitude, maxResults, maxDistance, bbox } =
      req.query;

    try {
      if (query && provider.searchStations) {
        const results = await provider.searchStations(String(query), {
          maxResults: maxResults ? Number(maxResults) : undefined,
        });
        return res.json(results);
      }

      if (bbox && provider.stationsWithin) {
        const parts = String(bbox)
          .split(",")
          .map(Number) as [number, number, number, number];
        return res.json(await provider.stationsWithin(parts));
      }

      if (latitude && longitude && provider.stationsNear) {
        const results = await provider.stationsNear({
          latitude: Number(latitude),
          longitude: Number(longitude),
          maxResults: maxResults ? Number(maxResults) : undefined,
          maxDistance: maxDistance ? Number(maxDistance) : undefined,
        });
        return res.json(results);
      }

      if (provider.stations) {
        return res.json(await provider.stations());
      }

      res.status(501).json({
        message: "Station discovery is not supported by this data source",
      });
    } catch (error: unknown) {
      res.status(500).json({ message: (error as Error).message });
    }
  });

  router.get("/stations/:source/:id", async (req, res) => {
    if (!provider.findStation) {
      return res.status(501).json({
        message: "Station lookup is not supported by this data source",
      });
    }

    try {
      const station = await provider.findStation(
        `${req.params.source}/${req.params.id}`,
      );
      res.json(station);
    } catch (error: unknown) {
      res.status(404).json({ message: (error as Error).message });
    }
  });

  router.get("/stations/:source/:id/extremes", async (req, res) => {
    if (!provider.getStationExtremes) {
      return res.status(501).json({
        message: "Station predictions are not supported by this data source",
      });
    }

    try {
      const result = await provider.getStationExtremes(
        `${req.params.source}/${req.params.id}`,
        parseTimeOptions(req.query),
      );

      res.json({
        ...result,
        extremes: result.extremes.map(serializeExtreme),
      });
    } catch (error: unknown) {
      res.status(404).json({ message: (error as Error).message });
    }
  });

  router.get("/stations/:source/:id/timeline", async (req, res) => {
    if (!provider.getStationTimeline) {
      return res.status(501).json({
        message: "Station predictions are not supported by this data source",
      });
    }

    try {
      const result = await provider.getStationTimeline(
        `${req.params.source}/${req.params.id}`,
        parseTimeOptions(req.query),
      );

      res.json({
        ...result,
        timeline: result.timeline.map(serializeTimelineEntry),
      });
    } catch (error: unknown) {
      res.status(404).json({ message: (error as Error).message });
    }
  });

  return router;
}

function parseTimeOptions(query: Record<string, unknown>) {
  const { start, end, datum, units } = query;
  return {
    start: start ? new Date(String(start)) : new Date(),
    end: end
      ? new Date(String(end))
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    ...(datum ? { datum: String(datum) } : {}),
    ...(units ? { units: String(units) as "meters" | "feet" } : {}),
  };
}

function parsePredictionOptions(query: Record<string, unknown>) {
  const { latitude, longitude } = query;
  return {
    latitude: Number(latitude),
    longitude: Number(longitude),
    ...parseTimeOptions(query),
  };
}

/** Serialize an Extreme's Date to ISO string for JSON response */
function serializeExtreme(e: {
  time: Date;
  level: number;
  high: boolean;
  low: boolean;
  label: string;
}) {
  return {
    time: e.time.toISOString(),
    level: e.level,
    high: e.high,
    low: e.low,
    label: e.label,
  };
}

/** Serialize a TimelineEntry's Date to ISO string for JSON response */
function serializeTimelineEntry(e: { time: Date; level: number }) {
  return {
    time: e.time.toISOString(),
    level: e.level,
  };
}
