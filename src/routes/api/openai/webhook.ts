import { createFileRoute } from "@tanstack/react-router";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { consumeOpenAiApplicationAdmission } from "@/lib/ai/openai-admission-runtime.server";
import { createOpenAiServiceClient } from "@/lib/ai/openai-services.server.mjs";
import { createOpenAiWebhookHandler } from "@/lib/ai/openai-webhook.server.mjs";
const handle = createOpenAiWebhookHandler({
  env: runtimeEnv,
  consumeRateLimit: consumeOpenAiApplicationAdmission,
  verify: (body: string, headers: Headers, secret: string) =>
    createOpenAiServiceClient(runtimeEnv("OPENAI_API_KEY")).webhooks.unwrap(body, headers, secret),
});
export const Route = createFileRoute("/api/openai/webhook")({
  server: { handlers: { POST: ({ request }) => handle(request) } },
});
