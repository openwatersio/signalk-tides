/**
 * Middleware for handling vessel position queries and redirects
 */
import { RequestHandler } from 'express';
import { nearestStation } from 'neaps';
import type { Position } from '@signalk/server-api';

/**
 * Middleware that handles vessel/current station endpoints by redirecting to the nearest real station
 * Also injects default vessel position for location-based queries
 */
export function withVesselPosition(
  router: RequestHandler,
  getPosition: () => Position | null,
): RequestHandler {
  return (req, res, next) => {
    const isVesselCurrentPath = /^\/stations\/vessel\/current(?:\/|$)/.test(
      req.path,
    );

    // Handle vessel/current station endpoints by redirecting to the nearest real station
    if (isVesselCurrentPath) {
      const pos = getPosition();

      if (!pos) {
        return res.status(503).json({
          message: "Vessel position not available",
        });
      }

      try {
        // Find the nearest station to current position
        const station = nearestStation({
          latitude: pos.latitude,
          longitude: pos.longitude,
        });

        if (!station) {
          return res.status(404).json({
            message: "No nearby stations found",
          });
        }

        const path = req.url.replace(
          /^\/stations\/vessel\/current\b/,
          `/stations/${station.id}`,
        );
        const redirectUrl = `${req.baseUrl}${path}`;

        // HTTP 303 See Other: indicates the response to the request can be found under a different URI
        return res.redirect(303, redirectUrl);
      } catch (error) {
        return res.status(500).json({
          message: "Failed to find nearest station",
        });
      }
    }

    // Inject default position for location-based queries
    const isLocationQueryPath =
      req.path === "/extremes" || req.path === "/timeline";
    if (isLocationQueryPath && !req.query.latitude && !req.query.longitude) {
      const pos = getPosition();
      if (pos) {
        req.query.latitude = String(pos.latitude);
        req.query.longitude = String(pos.longitude);
      }
    }

    router(req, res, next);
  };
}
