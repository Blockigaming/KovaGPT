// Cross-chat memory store + summarizer for Plus+ users.
import { createFileRoute } from "@tanstack/react-router";
import {
  assertFeatureEnabled,
  assertNotBanned,
  getCallerTier,
  requireUser,
  type AuthedCaller,
} from "@/lib/api-auth.server";
import { chatCompletions, utilityModel, missingAiProviderResponse } from "@/lib/ai/provider.server";
import {
  assertDatabaseSuccess,
  BodyReadError,
  MEMORY_LIMITS as REQUEST_LIMITS,
  parseMemoryPayload,
  persistMemorySafely,
  readUtf8BodyBounded,
} from "@/lib/endpoint-reliability.mjs";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { modelForRole } from "@/lib/ai/model-router.server";
import { UTILITY_MAX_OUTPUT_TOKENS } from "@/lib/ai/model-config.mjs";
import { parseChatSummarySnapshot } from "@/lib/chat-summary-policy.server.mjs";
import {
  beginChatMemoryWrite,
  chatSummariesEnabled,
  deleteChatMemory,
  persistChatMemory,
  queueChatSummary,
  readChatSummaryDescriptor,
} from "@/lib/chat-summary.server";

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
    model: modelForRole("UTILITY"),
    max_completion_tokens: UTILITY_MAX_OUTPUT_TOKENS,

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
          const contextChatId = new URL(request.url).searchParams.get("contextChatId");
          if (contextChatId !== null) {
            if (
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
                contextChatId,
              )
            )
              return jsonError("Invalid chat ID.", 400);
            return Response.json(
              await readChatSummaryDescriptor(
                authorized.auth.supabaseAdmin,
                authorized.auth.userId,
                contextChatId,
              ),
              { headers: { "Cache-Control": "no-store" } },
            );
          }
          const returned =
            authorized.tier === "pro" ? MEMORY_LIMITS.pro.returned : MEMORY_LIMITS.plus.returned;
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
        if (isCrossSiteMutation(request)) {
          return jsonError("Cross-site memory changes are not allowed.", 403);
        }
        const caller = await identifyMemoryCaller(request);
        if (caller instanceof Response) return caller;
        // This endpoint is called automatically after conversation updates. Free
        // accounts have always received a silent no-op and the client relies on it.
        if (caller.tier === "free") {
          return new Response(null, {
            status: 204,
            headers: { "Cache-Control": "no-store" },
          });
        }
        const authorized = await authorizePaidMemory(caller);
        if (authorized instanceof Response) return authorized;

        // Capture the durable privacy epoch before any request-body/provider
        // work. A DELETE on another device invalidates both queued summaries
        // and the final cross-chat memory write from this admitted request.
        let memoryEpoch: number;
        try {
          memoryEpoch = await beginChatMemoryWrite(
            authorized.auth.supabaseAdmin,
            authorized.auth.userId,
          );
        } catch {
          return jsonError("Memory storage is temporarily unavailable. Please retry.", 503);
        }

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
        const body = JSON.parse(raw) as { contextSummary?: unknown; contextOnly?: unknown };
        if (body.contextOnly !== undefined && typeof body.contextOnly !== "boolean")
          return jsonError("Invalid payload.", 400);

        // Admission runs inside the client's existing memory-write barrier.
        // Privacy deletion drains this POST before removing pending summaries.
        if (chatSummariesEnabled()) {
          const contextSummary = body.contextSummary;
          if (contextSummary !== undefined && contextSummary !== null) {
            const snapshot = parseChatSummarySnapshot(contextSummary);
            if (
              !snapshot ||
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
                parsed.value.chatId,
              )
            ) {
              return jsonError("Invalid conversation summary payload.", 400);
            }
            try {
              await queueChatSummary(
                authorized.auth.supabaseAdmin,
                authorized.auth.userId,
                memoryEpoch,
                parsed.value.chatId,
                snapshot,
              );
            } catch {
              return jsonError("Memory storage is temporarily unavailable. Please retry.", 503);
            }
          }
        }

        if (body.contextOnly === true)
          return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });

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
              await persistChatMemory(authorized.auth.supabaseAdmin, memoryEpoch, row),
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
        if (isCrossSiteMutation(request)) {
          return jsonError("Cross-site memory changes are not allowed.", 403);
        }
        // Deleting personal memory remains available after a downgrade or ban.
        // Subscription and maintenance gates must never block privacy cleanup.
        const caller = await identifyMemoryCaller(request);
        if (caller instanceof Response) return caller;
        const chatId = new URL(request.url).searchParams.get("chatId")?.trim() || null;
        if (chatId && chatId.length > REQUEST_LIMITS.maxChatIdChars) {
          return jsonError("Invalid chat ID.", 400);
        }

        try {
          // Advance the durable privacy epoch and remove both memory stores in
          // one transaction. Legacy text chat IDs remain supported by the RPC.
          await deleteChatMemory(caller.auth.supabaseAdmin, caller.auth.userId, chatId);
          return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          console.error("[memory] delete failed", error);
          return jsonError("Memory storage is temporarily unavailable. Please retry.", 503);
        }
      },
    },
  },
});
