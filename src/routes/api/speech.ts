import { createFileRoute } from "@tanstack/react-router";
import { getCallerTier, requireVerifiedUser } from "@/lib/api-auth.server";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { createSpeechHandler, speechConfiguration } from "@/lib/speech.server.mjs";
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
    config: async (auth, input) =>
      speechConfiguration(runtimeEnv, await getCallerTier(auth), input.voiceId),
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
