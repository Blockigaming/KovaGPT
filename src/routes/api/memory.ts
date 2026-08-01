// Cross-chat memory store + summarizer for Plus+ users.
import { createFileRoute } from "@tanstack/react-router";
import {
  assertFeatureEnabled,
  assertNotBanned,
  enforceQuota,
  getCallerTier,
  requireUser,
  type AuthedCaller,
} from "@/lib/api-auth.server";
import { chatCompletions, chatModel, missingAiProviderResponse } from "@/lib/ai/provider.server";
import {
  assertDatabaseSuccess,
  MEMORY_LIMITS as REQUEST_LIMITS,
  parseMemoryPayload,
  persistMemorySafely,
} from "@/lib/endpoint-reliability.mjs";
import { DAILY_CHAT_LIMIT_BY_TIER } from "@/lib/modes";

const MEMORY_LIMITS = {
  plus: { returned: 12, stored: 250 },
  pro: { returned: 500, stored: null },
} as const;

type DatabaseResult<T = unknown> = { data: T | null; error?: unknown };
type MemoryTableQuery = PromiseLike<DatabaseResult> & {
  select: (cols: string) => MemoryTableQuery;
  upsert: (row: unknown, opts?: unknown) => MemoryTableQuery;
  delete: () => MemoryTableQuery;
  eq: (column: string, value: unknown) => MemoryTableQuery;
  order: (column: string, options?: unknown) => MemoryTableQuery;
  limit: (count: number) => Promise<DatabaseResult<unknown[]>>;
  range: (from: number, to: number) => Promise<DatabaseResult<unknown[]>>;
  in: (column: string, values: unknown[]) => MemoryTableQuery;
};

function tbl(auth: AuthedCaller): MemoryTableQuery {
  return (
    auth.supabaseAdmin as unknown as {
      from: (table: string) => MemoryTableQuery;
    }
  ).from("chat_memories");
}

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

async function authorizeMemory(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const tier = await getCallerTier(auth);
  if (tier === "free") return jsonError("Memory requires a Plus or Pro plan.", 403);

  const banned = await assertNotBanned(auth);
  if (banned) return banned;
  const feature = await assertFeatureEnabled(auth, "chat");
  if (feature) return feature;
  return { auth, tier } as const;
}

async function summarize(messages: Array<{ role: "user" | "assistant"; content: string }>) {
  const transcript = messages
    .map((message) => `${message.role === "user" ? "User" : "KovaGPT"}: ${message.content}`)
    .join("\n");
  const response = await chatCompletions({
    model: chatModel("fast"),
    messages: [
      {
        role: "system",
        content:
          "Summarize this conversation in 2-4 sentences as factual notes about the user and what they discussed. Focus on lasting facts, preferences, projects, decisions, names, and goals - not small talk. Write in third person ('The user...'). No markdown. No en or em dashes; use a regular hyphen. Plain text only.",
      },
      { role: "user", content: transcript },
    ],
  });
  if (!response.ok) return null;
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) return null;
  return text.trim().slice(0, 1500);
}

export const Route = createFileRoute("/api/memory")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authorized = await authorizeMemory(request);
        if (authorized instanceof Response) return authorized;

        try {
          const returned = MEMORY_LIMITS[authorized.tier].returned;
          const result = await tbl(authorized.auth)
            .select("chat_id, title, summary, updated_at")
            .eq("user_id", authorized.auth.userId)
            .order("updated_at", { ascending: false })
            .limit(returned);
          const memories = assertDatabaseSuccess(result, "memory_list");
          return Response.json(
            { memories: Array.isArray(memories) ? memories : [] },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (error) {
          console.error("[memory] list failed", error);
          return jsonError("Memory storage is temporarily unavailable.", 503);
        }
      },

      POST: async ({ request }) => {
        const authorized = await authorizeMemory(request);
        if (authorized instanceof Response) return authorized;

        const contentLength = Number(request.headers.get("content-length") ?? "0");
        if (!Number.isFinite(contentLength) || contentLength > REQUEST_LIMITS.maxBodyBytes) {
          return jsonError("Request too large.", 413);
        }
        const parsed = parseMemoryPayload(await request.text());
        if (!parsed.ok) return jsonError(parsed.error, parsed.status);

        const quota = await enforceQuota(
          authorized.auth,
          "chats",
          DAILY_CHAT_LIMIT_BY_TIER[authorized.tier],
        );
        if (quota) return quota;

        const missingProvider = missingAiProviderResponse();
        if (missingProvider) return missingProvider;

        let summary: string | null;
        try {
          summary = await summarize(parsed.value.messages);
        } catch (error) {
          console.error("[memory] summarizer failed", error);
          summary = null;
        }
        if (!summary) return jsonError("Memory summarization failed. Please retry.", 502);

        const row = {
          user_id: authorized.auth.userId,
          chat_id: parsed.value.chatId,
          title: parsed.value.title,
          summary,
          message_count: parsed.value.messages.length,
          updated_at: new Date().toISOString(),
        };

        try {
          const memoryCap = MEMORY_LIMITS.plus.stored;
          await persistMemorySafely({
            upsert: async () =>
              await tbl(authorized.auth).upsert(row, { onConflict: "user_id,chat_id" }),
            listOverflow:
              authorized.tier === "plus"
                ? async () =>
                    await tbl(authorized.auth)
                      .select("id")
                      .eq("user_id", authorized.auth.userId)
                      .order("updated_at", { ascending: false })
                      .range(memoryCap, memoryCap + 50)
                : null,
            deleteOverflow: async (overflow) =>
              await tbl(authorized.auth)
                .delete()
                .eq("user_id", authorized.auth.userId)
                .in(
                  "id",
                  (overflow as Array<{ id: string }>).map((record) => record.id),
                ),
          });
        } catch (error) {
          console.error("[memory] durable write failed", error);
          return jsonError("Memory storage is temporarily unavailable. Please retry.", 503);
        }

        return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
      },

      DELETE: async ({ request }) => {
        const authorized = await authorizeMemory(request);
        if (authorized instanceof Response) return authorized;
        const chatId = new URL(request.url).searchParams.get("chatId")?.trim() || null;
        if (chatId && chatId.length > REQUEST_LIMITS.maxChatIdChars) {
          return jsonError("Invalid chat ID.", 400);
        }

        try {
          let query = tbl(authorized.auth).delete().eq("user_id", authorized.auth.userId);
          if (chatId) query = query.eq("chat_id", chatId);
          assertDatabaseSuccess(await query, "memory_delete");
          return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          console.error("[memory] delete failed", error);
          return jsonError("Memory storage is temporarily unavailable. Please retry.", 503);
        }
      },
    },
  },
});
