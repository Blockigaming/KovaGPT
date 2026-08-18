import { createFileRoute } from "@tanstack/react-router";

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

type TitleMessage = { role: "user" | "assistant"; content: string };

function parseMessages(raw: string): TitleMessage[] | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const messages = (value as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 100) return null;
  const valid = messages.every(
    (message) =>
      message !== null &&
      typeof message === "object" &&
      ((message as { role?: unknown }).role === "user" ||
        (message as { role?: unknown }).role === "assistant") &&
      typeof (message as { content?: unknown }).content === "string" &&
      (message as { content: string }).content.length <= 50_000,
  );
  return valid ? (messages as TitleMessage[]) : null;
}

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

export const Route = createFileRoute("/api/title")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const ip =
            request.headers.get("cf-connecting-ip") ??
            request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
            "unknown";
          if (!checkRateLimit(ip)) {
            return new Response(JSON.stringify({ title: "New chat" }), {
              status: 429,
              headers: { "Content-Type": "application/json" },
            });
          }

          const MAX_BODY = 1 * 1024 * 1024;
          const contentLength = Number(request.headers.get("content-length") ?? "0");
          if (contentLength > MAX_BODY) {
            return new Response(JSON.stringify({ error: "Request too large." }), {
              status: 413,
              headers: { "Content-Type": "application/json" },
            });
          }
          const raw = await request.text();
          if (raw.length > MAX_BODY) {
            return new Response(JSON.stringify({ error: "Request too large." }), {
              status: 413,
              headers: { "Content-Type": "application/json" },
            });
          }
          const messages = parseMessages(raw);
          if (!messages) {
            return new Response(JSON.stringify({ error: "Invalid messages." }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const provider = await import("@/lib/ai/provider.server");
          const { chatCompletions, missingAiProviderResponse } = provider;
          const { modelForRole } = await import("@/lib/ai/model-router.server");
          const { UTILITY_MAX_OUTPUT_TOKENS } = await import("@/lib/ai/model-config.mjs");
          const { readUtilityCache, writeUtilityCache } =
            await import("@/lib/ai/utility-cache.server");

          const missingProvider = missingAiProviderResponse({
            title: "New chat",
          });
          if (missingProvider) return missingProvider;

          const excerpt = messages
            .slice(0, 8)
            .map((m) => `${m.role}: ${m.content}`)
            .join("\n")
            .slice(0, 4000);

          const cached = readUtilityCache("chat_title", excerpt);
          if (cached) {
            return new Response(JSON.stringify({ title: cached }), {
              headers: { "Content-Type": "application/json" },
            });
          }

          const upstream = await chatCompletions({
            model: modelForRole("UTILITY"),
            max_completion_tokens: UTILITY_MAX_OUTPUT_TOKENS,

            messages: [
              {
                role: "system",
                content:
                  "You write concise chat titles. Read the conversation and return a clear 3 to 5 word title summarizing the main topic. No quotes. No trailing punctuation. No emoji. No dashes. Return only the title.",
              },
              { role: "user", content: excerpt },
            ],
          });

          if (!upstream.ok) {
            return new Response(JSON.stringify({ title: "New chat" }), {
              headers: { "Content-Type": "application/json" },
            });
          }
          const data = await upstream.json();
          let title = (data.choices?.[0]?.message?.content ?? "New chat").trim();
          title = title.replace(/^["']|["']$/g, "").slice(0, 50);
          writeUtilityCache("chat_title", excerpt, title);
          return new Response(JSON.stringify({ title }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch {
          return new Response(JSON.stringify({ title: "New chat" }), {
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
