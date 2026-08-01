// Cross-chat memory store + summarizer for Plus+ users.
import { createFileRoute } from "@tanstack/react-router";
import {
  assertFeatureEnabled,
  assertNotBanned,
  getCallerTier,
  requireUser,
  type AuthedCaller,
} from "@/lib/api-auth.server";
import { chatCompletions, chatModel, missingAiProviderResponse } from "@/lib/ai/provider.server";
import {
  assertDatabaseSuccess,
  BodyReadError,
  MEMORY_LIMITS as REQUEST_LIMITS,
  parseMemoryPayload,
  persistMemorySafely,
  readUtf8BodyBounded,
} from "@/lib/endpoint-reliability.mjs";

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

async function identifyMemoryCaller(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  const tier = await getCallerTier(auth);
  return { auth, tier } as const;
}

async function authorizePaidMemory(
  caller: Exclude<Awaited<ReturnType<typeof identifyMemoryCaller>>, Response>,
) {
  const banned = await assertNotBanned(caller.auth);
  if (banned) return banned;
  const feature = await assertFeatureEnabled(caller.auth, "chat");
  if (feature) return feature;
  return caller;
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
        const caller = await identifyMemoryCaller(request);
        if (caller instanceof Response) return caller;
        // Preserve the existing client contract: memory is invisible on free plans.
        if (caller.tier === "free") {
          return Response.json({ memories: [] }, { headers: { "Cache-Control": "no-store" } });
        }
        const authorized = await authorizePaidMemory(caller);
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
        const caller = await identifyMemoryCaller(request);
        if (caller instanceof Response) return caller;
        // This endpoint is called automatically after conversation updates. Free
        // accounts have always received a silent no-op and the client relies on it.
        if (caller.tier === "free") {
          return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
        }
        const authorized = await authorizePaidMemory(caller);
        if (authorized instanceof Response) return authorized;

        let raw: string;
        try {
          raw = await readUtf8BodyBounded(request, REQUEST_LIMITS.maxBodyBytes);
        } catch (error) {
          if (error instanceof BodyReadError) {
            const message = error.status === 413 ? "Request too large." : "Invalid request body.";
            return jsonError(message, error.status);
          }
          console.error("[memory] body read failed", error);
          return jsonError("Invalid request body.", 400);
        }
        const parsed = parseMemoryPayload(raw);
        if (!parsed.ok) return jsonError(parsed.error, parsed.status);

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
            deleteOverflow: async (overflow: unknown[]) =>
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
        // Deleting personal memory remains available after a downgrade or ban.
        // Subscription and maintenance gates must never block privacy cleanup.
        const caller = await identifyMemoryCaller(request);
        if (caller instanceof Response) return caller;
        const chatId = new URL(request.url).searchParams.get("chatId")?.trim() || null;
        if (chatId && chatId.length > REQUEST_LIMITS.maxChatIdChars) {
          return jsonError("Invalid chat ID.", 400);
        }

        try {
          let query = tbl(caller.auth).delete().eq("user_id", caller.auth.userId);
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
