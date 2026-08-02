import { createFileRoute } from "@tanstack/react-router";
import {
  assertFeatureEnabled,
  assertNotBanned,
  enforceQuota,
  getCallerTier,
  requireVerifiedUser,
} from "@/lib/api-auth.server";
import { DAILY_IMAGE_LIMIT_BY_TIER } from "@/lib/modes";
import {
  AiProviderError,
  imageGenerations,
  missingAiProviderResponse,
  providerErrorFromResponse,
  providerErrorResponse,
} from "@/lib/ai/provider.server";
import {
  imageProviderPayload,
  imageResultMetadata,
  normalizeImageSettings,
} from "@/lib/multimodal/image-workflows.server";

const MODEL_TIMEOUT_MS = 22_000;

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

type ModelAttempt = { imageUrl: string; status: 200 } | { error: AiProviderError };

function invalidImageResponse(): AiProviderError {
  return new AiProviderError({
    error: "KovaGPT couldn't complete that request. Please try again.",
    code: "provider_bad_response",
    retryable: false,
    status: 502,
  });
}

async function tryModel(payload: ReturnType<typeof imageProviderPayload>): Promise<ModelAttempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await imageGenerations(payload, { signal: controller.signal });
  } catch (error) {
    clearTimeout(timer);
    return {
      error: error instanceof AiProviderError ? error : invalidImageResponse(),
    };
  }
  clearTimeout(timer);

  if (!upstream.ok) return { error: await providerErrorFromResponse(upstream) };

  const data = await upstream.json().catch(() => null);
  if (!data || typeof data !== "object") return { error: invalidImageResponse() };
  const item = (data as { data?: Array<{ b64_json?: string; url?: string }> }).data?.[0];
  if (item?.b64_json) {
    return { imageUrl: `data:image/png;base64,${item.b64_json}`, status: 200 };
  }
  if (item?.url) return { imageUrl: item.url, status: 200 };
  return { error: invalidImageResponse() };
}

export const Route = createFileRoute("/api/generate-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = await requireVerifiedUser(request);
          if (auth instanceof Response) return auth;
          const MAX_BODY = 1 * 1024 * 1024;
          const contentLength = Number(request.headers.get("content-length") ?? "0");
          if (contentLength > MAX_BODY) return jsonError("Request too large.", 413);
          const raw = await request.text();
          if (raw.length > MAX_BODY) return jsonError("Request too large.", 413);
          let parsed: Parameters<typeof normalizeImageSettings>[0];
          try {
            parsed = JSON.parse(raw) as Parameters<typeof normalizeImageSettings>[0];
          } catch {
            return jsonError("Invalid JSON.", 400);
          }
          let settings;
          try {
            settings = normalizeImageSettings(parsed);
          } catch (error) {
            return jsonError(
              error instanceof Error ? error.message : "Invalid image settings.",
              400,
            );
          }
          const missingProvider = missingAiProviderResponse();
          if (missingProvider) return missingProvider;

          const banned = await assertNotBanned(auth);
          if (banned) return banned;
          const maint = await assertFeatureEnabled(auth, "images");
          if (maint) return maint;

          const tier = await getCallerTier(auth);
          const quota = await enforceQuota(auth, "images", DAILY_IMAGE_LIMIT_BY_TIER[tier]);
          if (quota) return quota;

          const payload = imageProviderPayload(settings);
          const result = await tryModel(payload);
          if ("imageUrl" in result) {
            return new Response(
              JSON.stringify({
                imageUrl: result.imageUrl,
                model: payload.model,
                metadata: imageResultMetadata(settings),
              }),
              {
                headers: { "Content-Type": "application/json" },
              },
            );
          }

          console.error("[generate-image] provider error", {
            code: result.error.code,
            status: result.error.status,
          });
          return providerErrorResponse(result.error);
        } catch (error) {
          console.error("[generate-image] handler error", {
            name: error instanceof Error ? error.name : "UnknownError",
          });
          return jsonError("An unexpected error occurred. Please try again.", 500);
        }
      },
    },
  },
});
