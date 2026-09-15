import { createFileRoute } from "@tanstack/react-router";

const MAX_RESULTS = 6;
const recentRequests = new Map<string, number>();

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, max-age=60", "X-Content-Type-Options": "nosniff" },
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
        const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
        const client = forwarded || request.headers.get("cf-connecting-ip") || "unknown";
        const now = Date.now();
        const lastRequest = recentRequests.get(client) ?? 0;
        if (now - lastRequest < 1_000) {
          return json({ error: "Please wait a moment before searching again." }, 429);
        }
        recentRequests.set(client, now);
        if (recentRequests.size > 10_000) {
          for (const [key, timestamp] of recentRequests) {
            if (now - timestamp > 60_000) recentRequests.delete(key);
          }
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
