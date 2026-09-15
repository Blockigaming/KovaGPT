import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { readBoundedUtf8 } from "@/lib/bounded-json.server.mjs";
import { resolveAnonymousClientKey } from "@/lib/chat-ingress.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { assertLockdownAllows, lockdownErrorResponse } from "@/lib/lockdown-policy.mjs";
import { MAPS_RELEASE_APPROVED, MAPS_RELEASE_UNAVAILABLE_MESSAGE } from "@/lib/maps-release-gate";

const MAX_RESULTS = 6;
const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1024;
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

type MapsPlace = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  type: string;
  address: Record<string, string>;
  bounds: [number, number, number, number] | null;
};

type MapsPayload = { results: MapsPlace[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteCoordinate(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
}

function sanitizeProviderBounds(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const south = finiteCoordinate(value[0]);
  const north = finiteCoordinate(value[1]);
  const west = finiteCoordinate(value[2]);
  const east = finiteCoordinate(value[3]);
  if (
    south === null ||
    south < -90 ||
    south > 90 ||
    north === null ||
    north < -90 ||
    north > 90 ||
    west === null ||
    west < -180 ||
    west > 180 ||
    east === null ||
    east < -180 ||
    east > 180
  ) {
    return null;
  }
  return [west, south, east, north];
}

function isCachedPlace(value: unknown): value is MapsPlace {
  if (!isRecord(value)) return false;
  const bounds = value.bounds;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.id.length <= 128 &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    value.name.length <= 500 &&
    typeof value.type === "string" &&
    value.type.length > 0 &&
    value.type.length <= 80 &&
    typeof value.latitude === "number" &&
    Number.isFinite(value.latitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    typeof value.longitude === "number" &&
    Number.isFinite(value.longitude) &&
    value.longitude >= -180 &&
    value.longitude <= 180 &&
    isRecord(value.address) &&
    Object.keys(value.address).length <= 32 &&
    Object.entries(value.address).every(
      ([key, item]) => key.length <= 64 && typeof item === "string" && item.length <= 200,
    ) &&
    (bounds === null ||
      (Array.isArray(bounds) &&
        bounds.length === 4 &&
        bounds.every((item) => typeof item === "number" && Number.isFinite(item)) &&
        bounds[0] >= -180 &&
        bounds[0] <= 180 &&
        bounds[1] >= -90 &&
        bounds[1] <= 90 &&
        bounds[2] >= -180 &&
        bounds[2] <= 180 &&
        bounds[3] >= -90 &&
        bounds[3] <= 90))
  );
}

function cachedMapsPayload(row: unknown): MapsPayload | null {
  if (!isRecord(row) || !isRecord(row.payload) || !Array.isArray(row.payload.results)) return null;
  if (row.payload.results.length > MAX_RESULTS || !row.payload.results.every(isCachedPlace)) {
    return null;
  }
  return { results: row.payload.results };
}

function sanitizeAddress(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => key.length <= 64 && typeof item === "string")
      .slice(0, 32)
      .map(([key, item]) => [key, (item as string).slice(0, 200)]),
  );
}

function sanitizeProviderPlace(value: unknown): MapsPlace | null {
  if (!isRecord(value)) return null;
  const latitude = finiteCoordinate(value.lat);
  const longitude = finiteCoordinate(value.lon);
  if (
    latitude === null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude === null ||
    longitude < -180 ||
    longitude > 180 ||
    typeof value.display_name !== "string" ||
    !value.display_name
  ) {
    return null;
  }
  const bounds = sanitizeProviderBounds(value.boundingbox);
  const id =
    (typeof value.place_id === "string" && value.place_id.length > 0) ||
    typeof value.place_id === "number"
      ? String(value.place_id)
      : `${latitude},${longitude}`;
  const type =
    typeof value.type === "string" && value.type.length > 0
      ? value.type
      : typeof value.category === "string" && value.category.length > 0
        ? value.category
        : "place";
  return {
    id: id.slice(0, 128),
    name: value.display_name.slice(0, 500),
    latitude,
    longitude,
    type: type.slice(0, 80),
    address: sanitizeAddress(value.address),
    bounds,
  };
}

async function geocoderCacheKey(query: string, language: string): Promise<string> {
  const canonical = `maps-geocoder:v1\0${query.normalize("NFKC").toLocaleLowerCase("en-US")}\0${language}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return `v1:${hex}`;
}

export const Route = createFileRoute("/api/maps/search")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!MAPS_RELEASE_APPROVED) {
          return json({ error: MAPS_RELEASE_UNAVAILABLE_MESSAGE }, 503);
        }
        const requestUrl = new URL(request.url);
        const query = requestUrl.searchParams.get("q")?.trim() ?? "";
        if (query.length < 2 || query.length > 160) {
          return json({ error: "Enter a location or place to search." }, 400);
        }
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        if (request.headers.get("x-kova-expected-user") !== auth.userId) {
          return json({ error: "Map account changed. Reload and try again." }, 409);
        }
        try {
          await assertLockdownAllows(auth.supabaseAdmin, auth.userId, "live_web");
        } catch (error) {
          return (
            lockdownErrorResponse(error) ??
            json({ error: "Map access could not be verified. Try again shortly." }, 503)
          );
        }

        const clientLimit = await consumeApplicationRateLimit({
          identity: resolveAnonymousClientKey(request.headers),
          action: "maps_search_client",
          limit: 30,
          windowSeconds: 60,
        });
        if (!clientLimit.allowed) {
          return Response.json(
            {
              error:
                clientLimit.status === "limited"
                  ? "Please wait a moment before searching again."
                  : "Map search protection is temporarily unavailable.",
            },
            {
              status: clientLimit.status === "limited" ? 429 : 503,
              headers: {
                "Cache-Control": "no-store",
                "Retry-After": String(clientLimit.retryAfter),
              },
            },
          );
        }

        const language = (request.headers.get("accept-language") ?? "en").slice(0, 128);
        const cacheKey = await geocoderCacheKey(query, language);
        let cached: unknown = null;
        try {
          const cacheRead = await auth.supabaseAdmin
            .from("maps_geocoder_cache" as never)
            .select("payload,expires_at")
            .eq("cache_key", cacheKey)
            .gt("expires_at", new Date().toISOString())
            .maybeSingle();
          if (cacheRead.error) console.error("[maps] could not read geocoder cache");
          else cached = cacheRead.data;
        } catch {
          console.error("[maps] could not read geocoder cache");
        }
        const cachedPayload = cachedMapsPayload(cached);
        if (cachedPayload) return json(cachedPayload);
        if (cached) console.error("[maps] ignored invalid geocoder cache payload");

        // Nominatim's public service permits one request per second for the
        // entire application, not per user or per server instance. This RPC is
        // an atomic rolling boundary rather than a fixed time bucket.
        const providerAdmission = await auth.supabaseAdmin.rpc(
          "admit_maps_provider_request" as never,
          { p_provider: "nominatim" } as never,
        );
        const providerRow = Array.isArray(providerAdmission.data)
          ? providerAdmission.data[0]
          : providerAdmission.data;
        if (
          providerAdmission.error ||
          !providerRow ||
          typeof providerRow !== "object" ||
          typeof (providerRow as { allowed?: unknown }).allowed !== "boolean" ||
          !Number.isSafeInteger((providerRow as { retry_after?: unknown }).retry_after)
        ) {
          return Response.json(
            { error: "Map search protection is temporarily unavailable." },
            { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "1" } },
          );
        }
        if (!(providerRow as { allowed: boolean }).allowed) {
          return Response.json(
            { error: "Map search is busy. Please wait a moment and try again." },
            {
              status: 429,
              headers: {
                "Cache-Control": "no-store",
                "Retry-After": String((providerRow as { retry_after: number }).retry_after),
              },
            },
          );
        }

        const providerUrl = new URL("https://nominatim.openstreetmap.org/search");
        providerUrl.searchParams.set("q", query);
        providerUrl.searchParams.set("format", "jsonv2");
        providerUrl.searchParams.set("addressdetails", "1");
        providerUrl.searchParams.set("limit", String(MAX_RESULTS));
        providerUrl.searchParams.set("accept-language", language);

        try {
          const providerSignal = AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]);
          const response = await fetch(providerUrl, {
            signal: providerSignal,
            headers: {
              Accept: "application/json",
              "User-Agent": "KovaGPT-Maps/1.0 (https://kovagpt.com)",
            },
          });
          if (!response.ok) {
            console.error("[maps] geocoder rejected request", { status: response.status });
            return json(
              { error: "Place search is temporarily unavailable. Try again shortly." },
              502,
            );
          }
          let raw: unknown;
          try {
            raw = JSON.parse(
              await readBoundedUtf8(
                response as unknown as Request,
                MAX_PROVIDER_RESPONSE_BYTES,
                providerSignal,
              ),
            );
          } catch {
            return json({ error: "Place search returned an invalid response." }, 502);
          }
          const results = (Array.isArray(raw) ? raw : []).slice(0, MAX_RESULTS).flatMap((place) => {
            const sanitized = sanitizeProviderPlace(place);
            return sanitized ? [sanitized] : [];
          });
          const payload = { results };
          try {
            const { error: cacheError } = await auth.supabaseAdmin
              .from("maps_geocoder_cache" as never)
              .upsert(
                {
                  cache_key: cacheKey,
                  payload,
                  expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
                } as never,
                { onConflict: "cache_key" },
              );
            if (cacheError) console.error("[maps] could not cache geocoder response");
          } catch {
            console.error("[maps] could not cache geocoder response");
          }
          return json(payload);
        } catch (error) {
          console.error("[maps] geocoder request failed", {
            name: error instanceof Error ? error.name : "UnknownError",
          });
          return json(
            { error: "Place search could not connect. Check your network and try again." },
            502,
          );
        }
      },
    },
  },
});
