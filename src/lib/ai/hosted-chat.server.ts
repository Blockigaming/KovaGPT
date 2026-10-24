import { runtimeEnv } from "@/lib/runtime-env.server";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { openAiServices } from "./openai-service-runtime.server";
import { OpenAiServiceError } from "./openai-services.server.mjs";
import { hostedChatResult } from "./hosted-chat-result.mjs";

export async function hostedChatCompletion(
  body: Record<string, unknown>,
  tool: "data_analysis" | "file_analysis",
  question: string,
  ownerId: string,
  signal: AbortSignal,
) {
  if (
    runtimeEnv("KOVA_OPENAI_SERVICES_ENABLED") !== "true" ||
    !ownerId ||
    ["KOVA_REQUEST_CAPTURE_ENABLED", "KOVA_GENERATION_ACCEPTANCE_ENABLED"].some((name) => {
      const value = runtimeEnv(name);
      return Boolean(value && value !== "false");
    })
  )
    throw new OpenAiServiceError("hosted_tools_unavailable", 503);
  const messages = body.messages as { role: string; content: unknown }[];
  const transcript = JSON.stringify(messages.filter((message) => message.role !== "system"));
  if (transcript.length > 64000) throw new OpenAiServiceError("analysis_context_too_large", 413);
  for (const admission of [
    {
      identity: "openai_hosted_chat_global",
      action: "openai_hosted_chat_daily",
      limit: 20,
      windowSeconds: 86400,
    },
    {
      identity: `user:${ownerId}`,
      action: "openai_hosted_chat_daily",
      limit: 5,
      windowSeconds: 86400,
    },
  ]) {
    const budget = await consumeApplicationRateLimit(admission);
    if (!budget.allowed)
      throw new OpenAiServiceError(
        "hosted_tool_budget_unavailable",
        budget.status === "limited" ? 429 : 503,
      );
  }
  const provider = openAiServices(String(body.model), {
    maxOutputTokens: Number(body.max_completion_tokens),
    instructions: messages
      .filter((message) => message.role === "system" && typeof message.content === "string")
      .map((message) => message.content)
      .join("\n\n"),
  });
  const options = { signal };
  const result =
    tool === "data_analysis"
      ? await provider.analyze(transcript, options)
      : await provider.searchFiles(
          question,
          [
            { name: "Current chat context part 1", text: transcript.slice(0, 32000) },
            ...(transcript.length > 32000
              ? [{ name: "Current chat context part 2", text: transcript.slice(32000) }]
              : []),
          ],
          options,
        );
  return hostedChatResult(result);
}
