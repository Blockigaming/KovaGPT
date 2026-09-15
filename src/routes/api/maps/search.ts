import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { resolveAnonymousClientKey } from "@/lib/chat-ingress.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { assertLockdownAllows, lockdownErrorResponse } from "@/lib/lockdown-policy.mjs";

const MAX_RESULTS = 6;
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": status < 400 ? "private, max-age=60" : "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
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
          identity: `${auth.userId}:${resolveAnonymousClientKey(request.headers)}`,
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
        const cacheKey = JSON.stringify([query.toLocaleLowerCase("en-US"), language]);
        const { data: cached } = await auth.supabaseAdmin
          .from("maps_geocoder_cache" as never)
          .select("payload,expires_at")
          .eq("cache_key", cacheKey)
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();
        if (cached && typeof cached === "object" && !Array.isArray(cached)) {
          return json((cached as { payload: unknown }).payload);
        }

        // This database-backed lease serializes provider calls across all
        // application instances. Cache hits above do not consume the lease.
        const { data: claimToken, error: claimError } = await auth.supabaseAdmin.rpc(
          "claim_maps_geocoder_provider_slot" as never,
        );
        if (claimError || typeof claimToken !== "string") {
          return Response.json(
            { error: "Map search is busy. Please wait a moment and try again." },
            {
              status: claimError ? 503 : 429,
              headers: {
                "Cache-Control": "no-store",
                "Retry-After": "1",
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
          const raw = (await response.json()) as NominatimPlace[];
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
          return json(payload);
        } catch (error) {
          console.error("[maps] geocoder request failed", {
            name: error instanceof Error ? error.name : "UnknownError",
          });
          return json(
            { error: "Place search could not connect. Check your network and try again." },
            502,
          );
        } finally {
          const { error: releaseError } = await auth.supabaseAdmin.rpc(
            "release_maps_geocoder_provider_slot" as never,
            { p_claim_token: claimToken } as never,
          );
          if (releaseError) console.error("[maps] could not release geocoder provider slot");
        }
      },
    },
  },
});
