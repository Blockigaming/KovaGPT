import { createFileRoute } from "@tanstack/react-router";
import {
  requireUser,
  assertNotBanned,
  assertFeatureEnabled,
  enforceQuota,
  getCallerTier,
} from "@/lib/api-auth.server";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { createVoiceHandler } from "@/lib/voice/handler.server.mjs";

const handle = createVoiceHandler({
  requireUser,
  assertNotBanned,
  assertFeatureEnabled,
  enforceQuota,
  getCallerTier,
  env: runtimeEnv,
  limitRealtime: async (auth) => {
    const result = await consumeApplicationRateLimit({
      identity: `user:${auth.userId}`,
      action: "voice_realtime_minute",
      limit: 12,
      windowSeconds: 60,
    });
    if (result.allowed) return null;
    const unavailable = result.status === "unavailable";
    return Response.json(
      { error: unavailable ? "voice_not_configured" : "voice_provider_rate_limited" },
      { status: unavailable ? 503 : 429, headers: { "Cache-Control": "no-store" } },
    );
  },
});
export const Route = createFileRoute("/api/voice")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
