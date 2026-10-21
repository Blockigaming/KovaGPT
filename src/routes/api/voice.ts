import { createFileRoute } from "@tanstack/react-router";
import {
  requireUser,
  assertNotBanned,
  assertFeatureEnabled,
  enforceQuota,
  getCallerTier,
} from "@/lib/api-auth.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { createVoiceHandler } from "@/lib/voice/handler.server.mjs";

const handle = createVoiceHandler({
  requireUser,
  assertNotBanned,
  assertFeatureEnabled,
  enforceQuota,
  getCallerTier,
  env: runtimeEnv,
});
export const Route = createFileRoute("/api/voice")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
