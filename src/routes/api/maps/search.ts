import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { resolveAnonymousClientKey } from "@/lib/chat-ingress.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { assertLockdownAllows, lockdownErrorResponse } from "@/lib/lockdown-policy.mjs";

const MAX_RESULTS = 6;

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
        providerUrl.searchParams.set(
          "accept-language",
          request.headers.get("accept-language") ?? "en",
        );

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
          return json({ results });
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
