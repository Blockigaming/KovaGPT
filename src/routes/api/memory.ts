// Cross-chat memory store + summarizer for Plus+ users.
import { createFileRoute } from "@tanstack/react-router";
import {
  getCallerTier,
  requireUser,
  type AuthedCaller,
} from "@/lib/api-auth.server";

const MAX_SUMMARIES_RETURNED = 8;
const MAX_MEMORIES_PER_USER = 100;

// `chat_memories` was added in a recent migration; the generated Database
// types haven't been refreshed yet, so we go through a permissive client
// to keep the build green. RLS still enforces row ownership.
function tbl(auth: AuthedCaller) {
  return (auth.supabaseAdmin as unknown as {
    from: (t: string) => {
      select: (cols: string) => any;
      upsert: (row: any, opts?: any) => any;
      delete: () => any;
      // chained methods chain through `any`
    };
  }).from("chat_memories");
}

async function summarize(apiKey: string, messages: { role: string; content: string }[]) {
  const transcript = messages
    .slice(-30)
    .map((m) => `${m.role === "user" ? "User" : "KovaGPT"}: ${String(m.content).slice(0, 2000)}`)
    .join("\n");
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3.1-flash-lite",
      messages: [
        {
          role: "system",
          content:
            "Summarize this conversation in 2-4 sentences as factual notes about the user and what they discussed. Focus on lasting facts, preferences, projects, decisions, names, and goals - not small talk. Write in third person ('The user...'). No markdown. No en or em dashes; use a regular hyphen. Plain text only.",
        },
        { role: "user", content: transcript },
      ],
    }),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) return null;
  return text.trim().slice(0, 1500);
}

export const Route = createFileRoute("/api/memory")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const { data } = await tbl(auth)
          .select("chat_id, title, summary, updated_at")
          .eq("user_id", auth.userId)
          .order("updated_at", { ascending: false })
          .limit(MAX_SUMMARIES_RETURNED);
        return new Response(JSON.stringify({ memories: data ?? [] }), {
          headers: { "Content-Type": "application/json" },
        });
      },
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;

        const tier = await getCallerTier(auth);
        if (tier === "free") return new Response(null, { status: 204 });

        const MAX_BODY = 4 * 1024 * 1024; // 4 MB
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
        let body: {
          chatId?: string;
          title?: string;
          messages?: { role: string; content: string }[];
        } | null = null;
        try {
          body = JSON.parse(raw);
        } catch {
          body = null;
        }
        if (!body || typeof body.chatId !== "string" || !Array.isArray(body.messages)) {
          return new Response(JSON.stringify({ error: "Invalid payload" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (body.messages.length < 4) return new Response(null, { status: 204 });
        const chatId = body.chatId.slice(0, 100);
        const title = typeof body.title === "string" ? body.title.slice(0, 120) : null;

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        const summary = await summarize(apiKey, body.messages);
        if (!summary) return new Response(null, { status: 204 });

        await tbl(auth).upsert(
          {
            user_id: auth.userId,
            chat_id: chatId,
            title,
            summary,
            message_count: body.messages.length,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,chat_id" },
        );

        // Prune oldest beyond cap (best-effort).
        const { data: extra } = await tbl(auth)
          .select("id")
          .eq("user_id", auth.userId)
          .order("updated_at", { ascending: false })
          .range(MAX_MEMORIES_PER_USER, MAX_MEMORIES_PER_USER + 50);
        if (Array.isArray(extra) && extra.length > 0) {
          await tbl(auth).delete().in(
            "id",
            extra.map((r: { id: string }) => r.id),
          );
        }
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      },
      DELETE: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const url = new URL(request.url);
        const chatId = url.searchParams.get("chatId");
        let q = tbl(auth).delete().eq("user_id", auth.userId);
        if (chatId) q = q.eq("chat_id", chatId);
        await q;
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
