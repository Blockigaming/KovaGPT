import { createFileRoute } from "@tanstack/react-router";
import {
  requireVerifiedUser,
  assertNotBanned,
  getCallerTier,
  enforceQuota,
} from "@/lib/api-auth.server";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { openAiServices } from "@/lib/ai/openai-service-runtime.server";
import { createOpenAiServiceHandler } from "@/lib/ai/openai-service-handler.server.mjs";
import { reserveUploads } from "@/lib/upload-quota.server.mjs";
import { DAILY_UPLOAD_LIMIT_BY_TIER } from "@/lib/modes";
import type { AuthedCaller, CallerTier } from "@/lib/api-auth.server";
const handle = createOpenAiServiceHandler({
  requireVerifiedUser,
  assertNotBanned,
  getCallerTier,
  enforceQuota,
  consumeRateLimit: consumeApplicationRateLimit,
  env: runtimeEnv,
  services: openAiServices,
  reserveDocuments: (
    caller: AuthedCaller,
    documents: { name: string; text: string }[],
    tier: CallerTier,
    signal: AbortSignal,
  ) =>
    reserveUploads(
      caller,
      documents.map((document) => ({ kind: "text", name: document.name, content: document.text })),
      DAILY_UPLOAD_LIMIT_BY_TIER[tier],
      signal,
    ),
});
export const Route = createFileRoute("/api/ai/services")({
  server: {
    handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) },
  },
});
