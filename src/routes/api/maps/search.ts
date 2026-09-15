import { createFileRoute } from "@tanstack/react-router";
import { optionalUser } from "@/lib/api-auth.server";
import { resolveAnonymousClientKey } from "@/lib/chat-ingress.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { enforceLockdownCapability } from "@/lib/lockdown-policy.mjs";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const MAX_RESULTS = 6;
const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1024;

function json(value: unknown, status = 200, retryAfter?: number) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": status < 400 ? "private, max-age=60" : "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
    },
  });
}

type MapsAdmin = {
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string } | null }> & {
    abortSignal(signal: AbortSignal): PromiseLike<{
      data: unknown;
      error: { code?: string } | null;
    }>;
  };
};

const mapsAdmin = supabaseAdmin as unknown as MapsAdmin;

async function cacheKey(query: string, language: string) {
  const bytes = new TextEncoder().encode(`${query.toLowerCase()}\n${language.toLowerCase()}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type NominatimPlace = {
  place_id?: number;
  display_name?: string;
  lat?: string;
  lon?: string;
  type?: string;
  category?: string;
  boundingbox?: string[];
  address?: Record<string, string>;
};

export const Route = createFileRoute("/api/maps/search")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const requestUrl = new URL(request.url);
        const query = requestUrl.searchParams.get("q")?.trim() ?? "";
        if (query.length < 2 || query.length > 160) {
          return json({ error: "Enter a location or place to search." }, 400);
        }

        const auth = await optionalUser(request);
        if (auth instanceof Response) return auth;
        if (auth) {
          const lockdown = await enforceLockdownCapability(
            auth.supabaseAdmin,
            auth.userId,
            "live_web",
          );
          if (lockdown) return lockdown;
        }

        const rate = await consumeApplicationRateLimit({
          identity: auth ? `user:${auth.userId}` : resolveAnonymousClientKey(request.headers),
          action: "maps_search",
          limit: 30,
          windowSeconds: 60,
        });
        if (!rate.allowed) {
          return json(
            {
              error:
                rate.status === "limited"
                  ? "Please wait a moment before searching again."
                  : "Place search protection is temporarily unavailable.",
            },
            rate.status === "limited" ? 429 : 503,
            rate.retryAfter,
          );
        }

        const language = (request.headers.get("accept-language") ?? "en")
          .split(",")[0]
          .trim()
          .slice(0, 32);
        const key = await cacheKey(query, language || "en");
        const deadline = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
        const cached = await mapsAdmin
          .rpc("read_maps_search_cache", { p_query_hash: key })
          .abortSignal(deadline);
        if (cached.error) {
          return json(
            { error: "Place search is temporarily unavailable. Try again shortly." },
            503,
          );
        }
        if (cached.data && typeof cached.data === "object" && !Array.isArray(cached.data)) {
          return json(cached.data);
        }

        const claim = await mapsAdmin.rpc("claim_maps_provider_request").abortSignal(deadline);
        const admission = Array.isArray(claim.data) ? claim.data[0] : claim.data;
        if (claim.error || !admission || typeof admission !== "object") {
          return json(
            { error: "Place search is temporarily unavailable. Try again shortly." },
            503,
          );
        }
        const providerAdmission = admission as { allowed?: unknown; retry_after?: unknown };
        if (providerAdmission.allowed !== true) {
          const retryAfter =
            Number.isSafeInteger(providerAdmission.retry_after) &&
            Number(providerAdmission.retry_after) > 0
              ? Number(providerAdmission.retry_after)
              : 1;
          return json({ error: "Please wait a moment before searching again." }, 429, retryAfter);
        }

        const providerUrl = new URL("https://nominatim.openstreetmap.org/search");
        providerUrl.searchParams.set("q", query);
        providerUrl.searchParams.set("format", "jsonv2");
        providerUrl.searchParams.set("addressdetails", "1");
        providerUrl.searchParams.set("limit", String(MAX_RESULTS));
        providerUrl.searchParams.set("accept-language", language || "en");

        try {
          const response = await fetch(providerUrl, {
            signal: AbortSignal.timeout(8_000),
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
          const rawText = await response.text();
          if (new TextEncoder().encode(rawText).length > MAX_PROVIDER_RESPONSE_BYTES) {
            return json({ error: "Place search returned an invalid response." }, 502);
          }
          const raw = JSON.parse(rawText) as NominatimPlace[];
          const results = (Array.isArray(raw) ? raw : []).flatMap((place) => {
            const latitude = Number(place.lat);
            const longitude = Number(place.lon);
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !place.display_name)
              return [];
            const bounds = place.boundingbox?.map(Number);
            return [
              {
                id: String(place.place_id ?? `${latitude},${longitude}`),
                name: place.display_name,
                latitude,
                longitude,
                type: place.type ?? place.category ?? "place",
                address: place.address ?? {},
                bounds:
                  bounds?.length === 4 && bounds.every(Number.isFinite)
                    ? [bounds[2], bounds[0], bounds[3], bounds[1]]
                    : null,
              },
            ];
          });
          const payload = { results };
          const stored = await mapsAdmin
            .rpc("store_maps_search_cache", { p_query_hash: key, p_payload: payload })
            .abortSignal(deadline);
          if (stored.error)
            console.error("[maps] shared cache write failed", { code: stored.error.code });
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
