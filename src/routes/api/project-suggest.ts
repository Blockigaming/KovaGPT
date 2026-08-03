import { createFileRoute } from "@tanstack/react-router";
import {
  AiProviderError,
  chatCompletions,
  utilityModel,
  missingAiProviderResponse,
  providerErrorFromResponse,
  providerErrorResponse,
} from "@/lib/ai/provider.server";
import {
  assertFeatureEnabled,
  assertNotBanned,
  enforceQuota,
  getCallerTier,
  requireUser,
} from "@/lib/api-auth.server";
import { DAILY_CHAT_LIMIT_BY_TIER } from "@/lib/modes";
import { modelForRole } from "@/lib/ai/model-router.server";
import { UTILITY_MAX_OUTPUT_TOKENS } from "@/lib/ai/model-config.mjs";

// Per-IP sliding window rate limit; keeps this public AI endpoint from
// becoming an unlimited free LLM call. Lower cap than /api/title since
// there's no signal of legitimate use.
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    rateLimitBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX) return false;
  bucket.count += 1;
  return true;
}

export const Route = createFileRoute("/api/project-suggest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = await requireUser(request);
          if (auth instanceof Response) return auth;
          const banned = await assertNotBanned(auth);
          if (banned) return banned;
          const maintenance = await assertFeatureEnabled(auth, "chat");
          if (maintenance) return maintenance;

          const ip =
            request.headers.get("cf-connecting-ip") ??
            request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
            "unknown";
          if (!checkRateLimit(ip)) {
            return Response.json(
              { error: "Too many suggestion requests. Try again later." },
              { status: 429 },
            );
          }
          const contentLength = Number(request.headers.get("content-length") ?? "0");
          if (contentLength > 8_192) {
            return Response.json({ error: "Request too large." }, { status: 413 });
          }
          const raw = await request.text();
          if (raw.length > 8_192) {
            return Response.json({ error: "Request too large." }, { status: 413 });
          }
          let body: { hint?: unknown };
          try {
            body = JSON.parse(raw) as { hint?: unknown };
          } catch {
            return Response.json({ error: "Invalid JSON." }, { status: 400 });
          }
          if (body.hint !== undefined && typeof body.hint !== "string") {
            return Response.json({ error: "hint must be a string." }, { status: 400 });
          }
          const hint = (body.hint ?? "").trim().slice(0, 400);
          const missingProvider = missingAiProviderResponse();
          if (missingProvider) return missingProvider;
          const tier = await getCallerTier(auth);
          const quota = await enforceQuota(auth, "chats", DAILY_CHAT_LIMIT_BY_TIER[tier]);
          if (quota) return quota;
          const upstream = await chatCompletions({

            model: utilityModel(),

            model: modelForRole("UTILITY"),
            max_completion_tokens: UTILITY_MAX_OUTPUT_TOKENS,

            messages: [
              {
                role: "system",
                content:
                  'You suggest a name and short description for a collaborative work project. Reply with ONLY compact JSON in the shape {"name": string (2-5 words, Title Case, no quotes), "description": string (one sentence, <=140 chars)}. No markdown, no code fences.',
              },
              { role: "user", content: hint || "Suggest a creative, useful project idea." },
            ],
          });
          if (!upstream.ok) {
            return providerErrorResponse(await providerErrorFromResponse(upstream));
          }
          const data = await upstream.json();
          const providerText = (data.choices?.[0]?.message?.content ?? "")
            .trim()
            .replace(/^```json|^```|```$/g, "")
            .trim();
          let parsed: { name?: string; description?: string } = {};
          try {
            parsed = JSON.parse(providerText);
          } catch {
            /* ignore */
          }
          const name = String(parsed.name ?? "")
            .trim()
            .slice(0, 100);
          const description = String(parsed.description ?? "")
            .trim()
            .slice(0, 300);
          if (!name) {
            return providerErrorResponse(
              new AiProviderError({
                error: "KovaGPT couldn't complete that request. Please try again.",
                code: "provider_bad_response",
                retryable: false,
                status: 502,
              }),
            );
          }
          return new Response(JSON.stringify({ name, description }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch {
          return Response.json(
            { error: "Suggestion service unavailable." },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
