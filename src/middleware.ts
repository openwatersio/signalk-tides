/**
 * Middleware for handling vessel position queries and redirects
 */
import { RequestHandler } from 'express';
import type { Position } from '@signalk/server-api';
import type { PositionOptions } from './types.js';

/** Resolves the station nearest to a position for the active source. */
export type FindNearestStation = (
  position: PositionOptions,
) => Promise<{ id: string } | null | undefined> | { id: string } | null | undefined;

/**
 * Middleware that handles vessel/current station endpoints by redirecting to
 * the nearest real station, and injects the default vessel position for
 * location-based queries.
 *
 * The nearest station is resolved through `findNearestStation` (backed by the
 * active source's provider) rather than a fixed database, so the redirect
 * always targets a station the active source can actually serve.
 */
export function withVesselPosition(
  router: RequestHandler,
  getPosition: () => Position | null,
  findNearestStation: FindNearestStation,
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

      Promise.resolve(
        findNearestStation({
          latitude: pos.latitude,
          longitude: pos.longitude,
        }),
      )
        .then((station) => {
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
          res.redirect(303, redirectUrl);
        })
        .catch(() => {
          res.status(500).json({
            message: "Failed to find nearest station",
          });
        });
      return;
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
