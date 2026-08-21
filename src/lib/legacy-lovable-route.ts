const LEGACY_ROUTE_BODY = {
  error: "This legacy integration endpoint has been retired.",
  code: "legacy_lovable_route_retired",
  replacement: "KovaGPT independent infrastructure",
} as const;

/**
 * Temporary compatibility tombstone for pre-migration /lovable/* URLs.
 * It performs no work, reads no credentials, sends no data, and cannot return
 * a success state. Remove the file routes after external callers are migrated.
 */
export function legacyLovableRouteGone(): Response {
  return Response.json(LEGACY_ROUTE_BODY, {
    status: 410,
    headers: {
      "Cache-Control": "no-store",
      Sunset: "Sat, 01 Aug 2026 00:00:00 GMT",
    },
  });
}
