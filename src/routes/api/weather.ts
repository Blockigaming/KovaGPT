import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";
import { BoundedJsonError, readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { enforceLockdownCapability } from "@/lib/lockdown-policy.mjs";
import { ProviderResponseError, readProviderJsonObject } from "@/lib/provider-response.server.mjs";
import { normalizeWeatherRequest, normalizeWeatherResponse } from "@/lib/weather-policy.mjs";

const MAX_RESPONSE_BYTES = 32 * 1024;

function json(value: unknown, status = 200, retryAfter?: number): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
    },
  });
}

export const Route = createFileRoute("/api/weather")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;

        const lockdown = await enforceLockdownCapability(
          auth.supabaseAdmin,
          auth.userId,
          "live_web",
        );
        if (lockdown) return lockdown;

        const contentType = request.headers.get("content-type") ?? "";
        if (!/^application\/json(?:\s*;|\s*$)/iu.test(contentType)) {
          return json({ error: "unsupported_media_type" }, 415);
        }

        let body: Record<string, unknown>;
        try {
          body = await readBoundedJsonObject(request, 1024);
        } catch (error) {
          if (error instanceof BoundedJsonError) return json({ error: error.code }, error.status);
          return json({ error: "invalid_request_body" }, 400);
        }
        const location = normalizeWeatherRequest(body);
        if (!location) {
          return json({ error: "invalid_weather_location" }, 400);
        }

        const rateLimit = await consumeApplicationRateLimit({
          identity: `user:${auth.userId}`,
          action: "summary_weather",
          limit: 30,
          windowSeconds: 60,
        });
        if (!rateLimit.allowed) {
          return json(
            {
              error:
                rateLimit.status === "limited"
                  ? "weather_rate_limited"
                  : "request_protection_unavailable",
            },
            rateLimit.status === "limited" ? 429 : 503,
            rateLimit.retryAfter,
          );
        }

        const url = new URL("https://api.open-meteo.com/v1/forecast");
        url.searchParams.set("latitude", String(location.latitude));
        url.searchParams.set("longitude", String(location.longitude));
        url.searchParams.set("current", "temperature_2m,weather_code");
        url.searchParams.set("temperature_unit", "fahrenheit");

        try {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(6_000),
            headers: { Accept: "application/json" },
          });
          if (!response.ok) {
            await response.body?.cancel("weather_provider_rejected").catch(() => undefined);
            return json({ error: "weather_unavailable" }, 502);
          }
          const weather = normalizeWeatherResponse(
            await readProviderJsonObject(response, MAX_RESPONSE_BYTES),
          );
          if (!weather) {
            return json({ error: "weather_invalid_response" }, 502);
          }
          return json(weather);
        } catch (error) {
          const timedOut = error instanceof DOMException && error.name === "TimeoutError";
          return json(
            {
              error:
                timedOut || error instanceof ProviderResponseError
                  ? "weather_unavailable"
                  : "weather_request_failed",
            },
            timedOut ? 504 : 502,
          );
        }
      },
    },
  },
});
