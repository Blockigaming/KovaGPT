import { createFileRoute } from "@tanstack/react-router";
import {
  assertFeatureEnabled,
  assertNotBanned,
  enforceQuota,
  getCallerTier,
  requireUser,
} from "@/lib/api-auth.server";
import { DAILY_IMAGE_LIMIT_BY_TIER } from "@/lib/modes";

// Tries a list of image models in order. Returns the first successful image.
// Falls back gracefully so a single model outage doesn't break the page.
const MODELS = [
  "openai/gpt-image-2",
  "google/gemini-3.1-flash-image",
  "google/gemini-2.5-flash-image",
] as const;

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function tryModel(
  model: string,
  prompt: string,
  apiKey: string,
  size: string,
): Promise<{ imageUrl?: string; status: number; error?: string }> {
  const isOpenAI = model.startsWith("openai/");
  const body = isOpenAI
    ? {
        model,
        prompt,
        size,
        quality: "low",
        n: 1,
      }
    : {
        model,
        messages: [{ role: "user", content: `${prompt}\n\n(Target aspect ratio / size: ${size})` }],
        modalities: ["image", "text"],
      };


  const endpoint = isOpenAI
    ? "https://ai.gateway.lovable.dev/v1/images/generations"
    : "https://ai.gateway.lovable.dev/v1/chat/completions";

  const upstream = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return { status: upstream.status, error: text || `Upstream ${upstream.status}` };
  }

  const data = await upstream.json().catch(() => null as any);
  if (!data) return { status: 500, error: "Invalid upstream response" };

  // OpenAI images endpoint: { data: [{ b64_json | url }] }
  if (isOpenAI) {
    const item = data?.data?.[0];
    if (item?.b64_json) {
      return { imageUrl: `data:image/png;base64,${item.b64_json}`, status: 200 };
    }
    if (item?.url) {
      return { imageUrl: item.url, status: 200 };
    }
    return { status: 500, error: "No image in OpenAI response" };
  }

  // Gemini via chat completions: image lives in choices[0].message.images
  const msg = data?.choices?.[0]?.message;
  const fromImages = msg?.images?.[0]?.image_url?.url;
  if (fromImages) return { imageUrl: fromImages, status: 200 };
  if (Array.isArray(msg?.content)) {
    for (const p of msg.content) {
      if (p?.type === "image_url" && p?.image_url?.url) {
        return { imageUrl: p.image_url.url, status: 200 };
      }
    }
  }
  return { status: 500, error: "No image in Gemini response" };
}

export const Route = createFileRoute("/api/generate-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const auth = await requireUser(request);
          if (auth instanceof Response) return auth;
          const MAX_BODY = 1 * 1024 * 1024;
          const contentLength = Number(request.headers.get("content-length") ?? "0");
          if (contentLength > MAX_BODY) return jsonError("Request too large.", 413);
          const raw = await request.text();
          if (raw.length > MAX_BODY) return jsonError("Request too large.", 413);
          const { prompt, size } = JSON.parse(raw) as { prompt?: string; size?: string };
          if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
            return jsonError("Prompt required", 400);
          }
          const ALLOWED_SIZES = new Set(["1024x1024", "1024x1536", "1536x1024"]);
          const chosenSize = ALLOWED_SIZES.has(size ?? "") ? (size as string) : "1024x1024";
          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) return jsonError("AI service not configured", 500);

          const banned = await assertNotBanned(auth);
          if (banned) return banned;
          const maint = await assertFeatureEnabled(auth, "images");
          if (maint) return maint;

          const tier = await getCallerTier(auth);
          const quota = await enforceQuota(auth, "images", DAILY_IMAGE_LIMIT_BY_TIER[tier]);
          if (quota) return quota;


          let lastStatus = 500;
          for (const model of MODELS) {
            const result = await tryModel(model, prompt.trim(), apiKey, chosenSize);

            if (result.imageUrl) {
              return new Response(
                JSON.stringify({ imageUrl: result.imageUrl, model }),
                { headers: { "Content-Type": "application/json" } },
              );
            }
            // Stop early on rate-limit / payment so the user gets a clear signal.
            if (result.status === 429) return jsonError("Rate limit  -  try again in a moment.", 429);
            if (result.status === 402) return jsonError("AI credits exhausted.", 402);
            if (result.error) console.error("[generate-image] model error", model, result.status, result.error);
            lastStatus = result.status;
          }
          return jsonError("Image service is temporarily unavailable. Please try again.", lastStatus);
        } catch (e) {
          console.error("[generate-image] handler error", e);
          return jsonError("An unexpected error occurred. Please try again.", 500);
        }
      },
    },
  },
});
