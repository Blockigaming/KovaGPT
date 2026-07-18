import { createFileRoute } from "@tanstack/react-router";

// Per-IP sliding window rate limit; keeps this public AI endpoint from
// becoming an unlimited free LLM call. Lower cap than /api/title since
// there's no signal of legitimate use.
const RATE_LIMIT_MAX = 10;
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

export const Route = createFileRoute("/api/project-suggest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const ip =
            request.headers.get("cf-connecting-ip") ??
            request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
            "unknown";
          if (!checkRateLimit(ip)) {
            return new Response(JSON.stringify(fallback()), {
              status: 429,
              headers: { "Content-Type": "application/json" },
            });
          }
          const body = await request.json().catch(() => ({})) as { hint?: string };
          const hint = (body.hint ?? "").toString().slice(0, 400);
          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) {
            return new Response(JSON.stringify(fallback()), { headers: { "Content-Type": "application/json" } });
          }
          const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash-lite",
              messages: [
                {
                  role: "system",
                  content:
                    'You suggest a name and short description for a collaborative work project. Reply with ONLY compact JSON in the shape {"name": string (2-5 words, Title Case, no quotes), "description": string (one sentence, <=140 chars)}. No markdown, no code fences.',
                },
                { role: "user", content: hint || "Suggest a creative, useful project idea." },
              ],
            }),
          });
          if (!upstream.ok) {
            return new Response(JSON.stringify(fallback()), { headers: { "Content-Type": "application/json" } });
          }
          const data = await upstream.json();
          const raw = (data.choices?.[0]?.message?.content ?? "").trim().replace(/^```json|^```|```$/g, "").trim();
          let parsed: { name?: string; description?: string } = {};
          try { parsed = JSON.parse(raw); } catch { /* ignore */ }
          const name = String(parsed.name ?? "").trim().slice(0, 100);
          const description = String(parsed.description ?? "").trim().slice(0, 300);
          if (!name) {
            return new Response(JSON.stringify(fallback()), { headers: { "Content-Type": "application/json" } });
          }
          return new Response(JSON.stringify({ name, description }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch {
          return new Response(JSON.stringify(fallback()), { headers: { "Content-Type": "application/json" } });
        }
      },
    },
  },
});

function fallback() {
  const options = [
    { name: "Marketing Campaign", description: "Plan, draft, and coordinate launch content across channels." },
    { name: "Product Research", description: "Gather user interviews, competitive notes, and opportunity briefs." },
    { name: "Content Calendar", description: "Track posts, deadlines, and drafts for the upcoming quarter." },
    { name: "Team Onboarding", description: "Docs, checklists, and resources for new hires." },
  ];
  return options[Math.floor(Math.random() * options.length)];
}
