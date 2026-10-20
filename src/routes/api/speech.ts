import { createFileRoute } from "@tanstack/react-router";
import { requireVerifiedUser } from "@/lib/api-auth.server";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { createSpeechHandler } from "@/lib/speech.server.mjs";
import { assertImagePrincipal } from "@/lib/multimodal/image-source.server.mjs";

// Reuse the existing live-session/deletion-fence check; no new Auth implementation.
const speechPost = () =>
  createSpeechHandler({
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
    config: () => ({
      enabled:
        runtimeEnv("KOVA_SPEECH_ENABLED") === "true" &&
        runtimeEnv("KOVA_GENERATION_DISABLED") !== "true",
      apiKey: runtimeEnv("ELEVENLABS_API_KEY"),
      voiceId: runtimeEnv("ELEVENLABS_VOICE_ID"),
    }),
  });

export const Route = createFileRoute("/api/speech")({
  server: { handlers: { POST: ({ request }) => speechPost()(request) } },
});
