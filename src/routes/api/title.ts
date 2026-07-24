import { createFileRoute } from "@tanstack/react-router";
import { chatCompletions, chatModel, missingAiProviderResponse } from "@/lib/ai/provider.server";

const RATE_LIMIT_MAX = 30;
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
          const { messages } = JSON.parse(raw) as {
            messages: { role: string; content: string }[];
          };
          const missingProvider = missingAiProviderResponse({ title: "New chat" });
          if (missingProvider) return missingProvider;

          const excerpt = messages
            .slice(0, 8)
            .map((m) => `${m.role}: ${m.content}`)
            .join("\n")
            .slice(0, 4000);

<<<<<<< HEAD
          const upstream = await chatCompletions({
            model: chatModel("fast"),
            messages: [
              {
                role: "system",
                content:
                  "You write concise chat titles. Read the conversation and return a clear 3 to 5 word title summarizing the main topic. No quotes. No trailing punctuation. No emoji. No dashes. Return only the title.",
              },
              { role: "user", content: excerpt },
            ],
          });
=======

          const upstream = await chatCompletions({
              model: chatModel("fast"),
              messages: [
                {
                  role: "system",
                  content:
                    "You write concise chat titles. Read the conversation and return a clear 3 to 5 word title summarizing the main topic. No quotes. No trailing punctuation. No emoji. No dashes. Return only the title.",

                },
                { role: "user", content: excerpt },
              ],
            });
>>>>>>> origin/main

          if (!upstream.ok) {
            return new Response(JSON.stringify({ title: "New chat" }), {
              headers: { "Content-Type": "application/json" },
            });
          }
          const data = await upstream.json();
          let title = (data.choices?.[0]?.message?.content ?? "New chat").trim();
          title = title.replace(/^["']|["']$/g, "").slice(0, 50);
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
