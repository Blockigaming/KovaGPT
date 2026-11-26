import { createFileRoute } from "@tanstack/react-router";
import { enforceQuota, getCallerTier, requireVerifiedUser } from "@/lib/api-auth.server";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { createSpeechHandler, speechConfiguration } from "@/lib/speech.server.mjs";
import { assertImagePrincipal } from "@/lib/multimodal/image-source.server.mjs";
import { voiceConfiguration } from "@/lib/voice/elevenlabs.server.mjs";
import { STREAM_TTS_MODEL_IDS } from "@/lib/voice/catalog.server.mjs";
import { voiceModelPolicy } from "@/lib/voice/openai-model-eligibility.server.mjs";

// Reuse the existing live-session/deletion-fence check; no new Auth implementation.
// Streaming speech model. Defaults to Flash v2.5 so nothing changes (and no plan
// upgrade is implied) until the owner confirms Eleven v4 Turbo is available and
// sets KOVA_VOICE_STREAM_TTS_MODEL=eleven_v4_turbo. Unknown values fall back.
const streamModel = () => {
  const configured = runtimeEnv("KOVA_VOICE_STREAM_TTS_MODEL");
  return configured && STREAM_TTS_MODEL_IDS.includes(configured) ? configured : "eleven_flash_v2_5";
};

const speechPost = () =>
  createSpeechHandler({
    streamModelId: streamModel(),
    authenticate: requireVerifiedUser,
    rateLimit: consumeApplicationRateLimit,
    revalidate: assertImagePrincipal,
    admit: async ({ request, ownerId, chatId, ...input }) => {
      const mode = runtimeEnv("KOVA_GENERATION_ACCEPTANCE_ENABLED");
      if (!mode || mode === "false") return null;
      const { generationAcceptance } = await import("@/lib/generation-acceptance-runtime.server");
      return generationAcceptance.run(
        { ownerId, chatId, operationId: request.headers.get("x-kova-acceptance-operation") ?? "" },
        () => generationAcceptance.speech({ ...input, ownerId, chatId }),
      );
    },
    quota: async (auth, signal) => {
      const { dailyLimit } = voiceConfiguration(runtimeEnv, await getCallerTier(auth));
      // Fail closed: speech never runs without a configured plan allowance.
      if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 1)
        return Response.json(
          { error: "speech_limits_unavailable" },
          { status: 503, headers: { "Cache-Control": "private, no-store" } },
        );
      return enforceQuota(auth, "voice", dailyLimit, 1, signal);
    },
    config: async (auth, input) =>
      speechConfiguration(runtimeEnv, await getCallerTier(auth), input.voiceId),
    modelPolicy: () => voiceModelPolicy(runtimeEnv),
  });

export const Route = createFileRoute("/api/speech")({
  server: {
    handlers: {
      POST: ({ request }) => {
        const captureMode = runtimeEnv("KOVA_REQUEST_CAPTURE_ENABLED");
        if (captureMode && captureMode !== "false") {
          return Response.json(
            { error: "Speech is disabled during request capture.", code: "request_capture_denied" },
            { status: 503, headers: { "Cache-Control": "private, no-store" } },
          );
        }
        return speechPost()(request);
      },
    },
  },
});
