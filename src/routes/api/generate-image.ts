import { createFileRoute } from "@tanstack/react-router";
import {
  assertFeatureEnabled,
  assertNotBanned,
  enforceQuota,
  getCallerTier,
  requireVerifiedUser,
} from "@/lib/api-auth.server";
import { DAILY_IMAGE_LIMIT_BY_TIER } from "@/lib/modes";
<<<<<<< HEAD
import { imageGenerations, missingAiProviderResponse } from "@/lib/ai/provider.server";
import {
  imageProviderPayload,
  imageResultMetadata,
  normalizeImageSettings,
} from "@/lib/multimodal/image-workflows.server";
=======
import { imageGenerations, imageModel, missingAiProviderResponse } from "@/lib/ai/provider.server";
>>>>>>> origin/main

const MODEL_TIMEOUT_MS = 22_000;

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function tryModel(
<<<<<<< HEAD
  payload: ReturnType<typeof imageProviderPayload>,
=======
  model: string,
  prompt: string,
  size: string,
>>>>>>> origin/main
): Promise<{ imageUrl?: string; status: number; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  let upstream: Response;
  try {
<<<<<<< HEAD
    upstream = await imageGenerations(payload, { signal: controller.signal });
=======
    upstream = await imageGenerations(
      { model, prompt, size, quality: "low", n: 1 },
      { signal: controller.signal },
    );
>>>>>>> origin/main
  } catch (e) {
    clearTimeout(timer);
    const aborted = (e as { name?: string } | null)?.name === "AbortError";
    return { status: 504, error: aborted ? "Model timed out" : "Network error" };
  }
  clearTimeout(timer);

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return { status: upstream.status, error: text || `Upstream ${upstream.status}` };
  }

  const data = await upstream.json().catch(() => null);
  if (!data || typeof data !== "object") return { status: 500, error: "Invalid upstream response" };
  const item = (data as { data?: Array<{ b64_json?: string; url?: string }> }).data?.[0];
  if (item?.b64_json) return { imageUrl: `data:image/png;base64,${item.b64_json}`, status: 200 };
  if (item?.url) return { imageUrl: item.url, status: 200 };
  return { status: 500, error: "No image in provider response" };
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
          const parsed = JSON.parse(raw) as Parameters<typeof normalizeImageSettings>[0];
          let settings;
          try {
            settings = normalizeImageSettings(parsed);
          } catch (error) {
            return jsonError(
              error instanceof Error ? error.message : "Invalid image settings.",
              400,
            );
          }
<<<<<<< HEAD
=======
          const ALLOWED_SIZES = new Set(["1024x1024", "1024x1536", "1536x1024", "1792x1024"]);
          const chosenSize = ALLOWED_SIZES.has(size ?? "") ? (size as string) : "1024x1024";
>>>>>>> origin/main
          const missingProvider = missingAiProviderResponse();
          if (missingProvider) return missingProvider;

          const banned = await assertNotBanned(auth);
          if (banned) return banned;
          const maint = await assertFeatureEnabled(auth, "images");
          if (maint) return maint;

          const tier = await getCallerTier(auth);
          const quota = await enforceQuota(auth, "images", DAILY_IMAGE_LIMIT_BY_TIER[tier]);
          if (quota) return quota;

<<<<<<< HEAD
          const payload = imageProviderPayload(settings);
          const result = await tryModel(payload);
          if (result.imageUrl) {
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
          if (result.status === 429) return jsonError("Rate limit - try again in a moment.", 429);
          if (result.error)
            console.error(
              "[generate-image] provider error",
              payload.model,
              result.status,
              result.error,
            );
          return jsonError(
            "Image service is temporarily unavailable. Please try again.",
            result.status,
          );
=======

          const model = imageModel();
          const result = await tryModel(model, prompt.trim(), chosenSize);
          if (result.imageUrl) {
            return new Response(JSON.stringify({ imageUrl: result.imageUrl, model }), {
              headers: { "Content-Type": "application/json" },
            });
          }
          if (result.status === 429) return jsonError("Rate limit - try again in a moment.", 429);
          if (result.error) console.error("[generate-image] provider error", model, result.status, result.error);
          return jsonError("Image service is temporarily unavailable. Please try again.", result.status);
>>>>>>> origin/main
        } catch (e) {
          console.error("[generate-image] handler error", e);
          return jsonError("An unexpected error occurred. Please try again.", 500);
        }
      },
    },
  },
});
