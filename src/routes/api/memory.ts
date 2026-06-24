// Cross-chat memory store + summarizer for Plus+ users.
//
// POST: client posts { chatId, title?, messages[] } at the end of a turn.
//   - Plus+ only. Free tier returns 204 silently so the client can call
//     unconditionally without errors in the console.
//   - We ask the AI to write a short factual summary, then upsert it as
//     the single memory row for that chat.
// GET:  returns the 8 most recent memory summaries for the caller. The
//   /api/chat endpoint calls this internally (via direct DB read) to
//   inject context into the system prompt for new chats.
import { createFileRoute } from "@tanstack/react-router";
import {
  getCallerTier,
  requireUser,
} from "@/lib/api-auth.server";

const MAX_SUMMARIES_RETURNED = 8;
const MAX_MEMORIES_PER_USER = 100; // soft cap; oldest are pruned

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
        const { data } = await auth.supabaseAdmin
          .from("chat_memories")
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
        if (tier === "free") {
          return new Response(null, { status: 204 });
        }

        const body = (await request.json().catch(() => null)) as {
          chatId?: string;
          title?: string;
          messages?: { role: string; content: string }[];
        } | null;
        if (!body || typeof body.chatId !== "string" || !Array.isArray(body.messages)) {
          return new Response(JSON.stringify({ error: "Invalid payload" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (body.messages.length < 4) {
          // Not enough context to be worth remembering yet.
          return new Response(null, { status: 204 });
        }
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
        if (!summary) {
          return new Response(null, { status: 204 });
        }

        await auth.supabaseAdmin
          .from("chat_memories")
          .upsert(
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
        const { data: extra } = await auth.supabaseAdmin
          .from("chat_memories")
          .select("id")
          .eq("user_id", auth.userId)
          .order("updated_at", { ascending: false })
          .range(MAX_MEMORIES_PER_USER, MAX_MEMORIES_PER_USER + 50);
        if (extra && extra.length > 0) {
          await auth.supabaseAdmin
            .from("chat_memories")
            .delete()
            .in("id", extra.map((r) => r.id));
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
        if (chatId) {
          await auth.supabaseAdmin
            .from("chat_memories")
            .delete()
            .eq("user_id", auth.userId)
            .eq("chat_id", chatId);
        } else {
          await auth.supabaseAdmin
            .from("chat_memories")
            .delete()
            .eq("user_id", auth.userId);
        }
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
