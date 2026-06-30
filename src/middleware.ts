/**
 * Middleware for handling vessel position queries and redirects
 */
import { RequestHandler } from 'express';
import { findStation, nearestStation } from 'neaps';
import type { Position } from '@signalk/server-api';

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
  return (req, res, next) => {
    // HTTP 303 See Other: the response can be found under a different URI
    const redirect = (toPath: string) =>
      res.redirect(303, `${req.baseUrl}${toPath}`);

    // The configured default station, or null when unset, "auto", or stale.
    const defaultStation = (): { id: string } | null => {
      const id = getDefaultStationId?.();
      if (!id || id === "auto") return null;
      try {
        return findStation(id);
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
      const station = defaultStation();
      if (station) return toStation(station);

      const pos = getPosition();
      if (!pos) {
        return res.status(503).json({ message: "Vessel position not available" });
      }

      try {
        const nearest = nearestStation({
          latitude: pos.latitude,
          longitude: pos.longitude,
        });

        if (!nearest) {
          return res.status(404).json({ message: "No nearby stations found" });
        }

        return toStation(nearest);
      } catch {
        return res.status(500).json({
          message: "Failed to find nearest station",
        });
      }
    }

    // Bare location-based queries: redirect to the configured station when set,
    // otherwise inject the vessel position so neaps uses the nearest station.
    const isLocationQueryPath =
      req.path === "/extremes" || req.path === "/timeline";
    if (isLocationQueryPath && !req.query.latitude && !req.query.longitude) {
      const station = defaultStation();
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
        req.query.latitude = String(pos.latitude);
        req.query.longitude = String(pos.longitude);
      }
    }

    router(req, res, next);
  };
}
