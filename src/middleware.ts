/**
 * Middleware for handling vessel position queries and redirects
 */
import { RequestHandler } from "express";
import { findStation, nearestStation } from "slackwater";
import { hasTideModel } from "./calculations.js";
import type { Position } from "@signalk/server-api";

/**
 * Middleware that resolves the vessel/default station alias and bare
 * location-based queries (/extremes, /timeline) against the configured default
 * station, falling back to the station nearest the vessel's position when no
 * default is set.
 */
export function withVesselPosition(
  router: RequestHandler,
  getPosition: () => Position | null,
  getDefaultStationId?: () => string | null,
): RequestHandler {
  // signalk-server runs Express 4, which ignores a rejected handler and leaves
  // the request hanging, so every failure has to reach next().
  return async (req, res, next) => {
    try {
      // HTTP 303 See Other: the response can be found under a different URI
      const redirect = (toPath: string) =>
        res.redirect(303, `${req.baseUrl}${toPath}`);

      // The configured default station, or null when unset, "auto", stale, or unpredictable.
      const defaultStation = async (): Promise<{ id: string } | null> => {
        const id = getDefaultStationId?.();
        if (!id || id === "auto") return null;
        try {
          const station = await findStation(id);
          return hasTideModel(station) ? station : null;
        } catch {
          return null; // stale or invalid saved id: fall back to position
        }
      };

      // Redirect the vessel/default alias to the configured (or nearest) station.
      if (/^\/stations\/vessel\/default(?:\/|$)/.test(req.path)) {
        const toStation = (station: { id: string }) =>
          redirect(
            req.url.replace(
              /^\/stations\/vessel\/default\b/,
              `/stations/${station.id}`,
            ),
          );

        // A configured default station resolves without a position
        const station = await defaultStation();
        if (station) return toStation(station);

        const pos = getPosition();
        if (!pos) {
          res.status(503).json({ message: "Vessel position not available" });
          return;
        }

        try {
          const nearest = await nearestStation({
            latitude: pos.latitude,
            longitude: pos.longitude,
            filter: hasTideModel,
          });

          if (!nearest) {
            res.status(404).json({ message: "No nearby stations found" });
            return;
          }

          return toStation(nearest);
        } catch {
          res.status(500).json({ message: "Failed to find nearest station" });
          return;
        }
      }

      // Bare location-based queries: redirect to the configured station when set,
      // otherwise inject the vessel position so slackwater uses the nearest station.
      const isLocationQueryPath =
        req.path === "/extremes" || req.path === "/timeline";
      if (isLocationQueryPath && !req.query.latitude && !req.query.longitude) {
        const station = await defaultStation();
        if (station) {
          return redirect(
            req.url.replace(
              /^\/(extremes|timeline)\b/,
              `/stations/${station.id}/$1`,
            ),
          );
        }

        const pos = getPosition();
        if (pos) {
          // Express 5 makes `req.query` a read-only getter, so assigning to its
          // properties is silently lost. Shadow it with an own data property,
          // which behaves identically on Express 4 and 5.
          Object.defineProperty(req, "query", {
            value: {
              ...req.query,
              latitude: String(pos.latitude),
              longitude: String(pos.longitude),
            },
            writable: true,
            configurable: true,
            enumerable: true,
          });
        }
      }

      router(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}
