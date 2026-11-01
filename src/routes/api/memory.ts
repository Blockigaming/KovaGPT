// Owner-bound saved memory, optional conversation notes, and same-chat summaries.
import { createFileRoute } from "@tanstack/react-router";
import {
  assertFeatureEnabled,
  assertNotBanned,
  getCallerTier,
  requireUser,
  type AuthedCaller,
} from "@/lib/api-auth.server";
import {
  assertDatabaseSuccess,
  BodyReadError,
  MEMORY_LIMITS as REQUEST_LIMITS,
  parseMemoryPayload,
  persistMemorySafely,
  readUtf8BodyBounded,
} from "@/lib/endpoint-reliability.mjs";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { parseChatSummarySnapshot } from "@/lib/chat-summary-policy.server.mjs";
import {
  beginChatMemoryWrite,
  chatSummariesEnabled,
  deleteChatMemory,
  persistChatMemory,
  queueChatSummary,
  readChatSummaryDescriptor,
} from "@/lib/chat-summary.server";

import { MEMORY_TIERS, conversationMemoryNotes } from "@/lib/memory-tier-policy.mjs";
import { loose } from "@/lib/supabase-loose";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { parseReviewedMemoryRequest, reviewedMemorySource } from "@/lib/reviewed-memory-policy.mjs";

type HistoryQuery = PromiseLike<{ data: unknown; error?: unknown }> & {
  select(columns: string): HistoryQuery;
  eq(column: string, value: string): HistoryQuery;
  is(column: string, value: null): HistoryQuery;
  maybeSingle(): HistoryQuery;
  abortSignal(signal: AbortSignal): HistoryQuery;
};

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

async function authorizeMemory(
  caller: Exclude<Awaited<ReturnType<typeof identifyMemoryCaller>>, Response>,
) {
  const banned = await assertNotBanned(caller.auth);
  if (banned) return banned;
  const feature = await assertFeatureEnabled(caller.auth, "chat");
  if (feature) return feature;
  return caller;
}

async function saveReviewedMemory(
  rawBody: unknown,
  caller: Exclude<Awaited<ReturnType<typeof identifyMemoryCaller>>, Response>,
  epoch: number,
  request: Request,
) {
  let input;
  try {
    input = parseReviewedMemoryRequest(rawBody);
  } catch {
    return jsonError("Review the exact memory text and confirm before saving.", 400);
  }
  if (!caller.auth.emailVerified) return jsonError("Verify your email before saving memory.", 403);
  if (request.headers.get("X-Kova-Owner") !== caller.auth.userId)
    return jsonError("Your account changed. Reopen the memory review.", 409);
  try {
    // Read with the caller's RLS identity as well as explicit owner predicates.
    // Revision validation is admission-time; the existing memory RPC atomically
    // enforces the privacy epoch, not a chat-history revision lock.
    const result = await (
      caller.auth.supabaseUser as unknown as { from(table: string): HistoryQuery }
    )
      .from("chat_history_records")
      .select("owner_id,id,payload,revision,deleted_at")
      .eq("owner_id", caller.auth.userId)
      .eq("id", input.chatId)
      .is("deleted_at", null)
      .maybeSingle()
      .abortSignal(AbortSignal.any([request.signal, AbortSignal.timeout(10000)]));
    if (result.error) return jsonError("Chat history is unavailable. Nothing was saved.", 503);
    const record = result.data as {
      owner_id?: unknown;
      id?: unknown;
      payload?: unknown;
      revision?: unknown;
      deleted_at?: unknown;
    } | null;
    if (
      !record ||
      record.owner_id !== caller.auth.userId ||
      record.id !== input.chatId ||
      record.deleted_at !== null ||
      record.revision !== input.expectedRevision
    )
      return jsonError(
        "This chat changed or is not synced. Close this review and try again from the current chat.",
        409,
      );
    let source;
    try {
      source = reviewedMemorySource(record.payload, caller.auth.userId);
    } catch {
      return jsonError(
        "This chat needs at least four eligible non-temporary messages before memory can be saved.",
        409,
      );
    }
    if (source.conversation.id !== input.chatId)
      return jsonError("This chat is unavailable for saving memory.", 409);
    request.signal.throwIfAborted();
    if (caller.auth.revalidateSession && !(await caller.auth.revalidateSession()))
      return jsonError("Your session changed. Reopen the memory review.", 401);
    request.signal.throwIfAborted();
    await persistMemorySafely({
      upsert: () =>
        persistChatMemory(caller.auth.supabaseAdmin, epoch, {
          user_id: caller.auth.userId,
          chat_id: input.chatId,
          title: source.title,
          summary: input.text,
          message_count: source.messageCount,
        }),
      listOverflow: () =>
        tbl(caller.auth)
          .select("id")
          .eq("user_id", caller.auth.userId)
          .eq("automatic", true)
          .order("updated_at", { ascending: false })
          .range(MEMORY_TIERS[caller.tier].stored, MEMORY_TIERS[caller.tier].stored + 50),
      deleteOverflow: async (overflow: unknown[]) =>
        await tbl(caller.auth)
          .delete()
          .eq("user_id", caller.auth.userId)
          .in(
            "id",
            (overflow as Array<{ id: string }>).map((record) => record.id),
          ),
    });
    return Response.json(
      { ok: true, saved: true, chatId: input.chatId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return jsonError(
      "Could not confirm that memory was saved. Review Memory Center before trying again.",
      503,
    );
  }
}

export const Route = createFileRoute("/api/memory")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const caller = await identifyMemoryCaller(request);
        if (caller instanceof Response) return caller;
        const authorized = await authorizeMemory(caller);
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
          const returned = MEMORY_TIERS[authorized.tier].returned;
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
        const authorized = await authorizeMemory(caller);
        if (authorized instanceof Response) return authorized;

        // Capture the durable privacy epoch before reading the request body.
        // A DELETE on another device invalidates writes from this admitted request.
        let memoryEpoch: number;
        {
          try {
            memoryEpoch = await beginChatMemoryWrite(
              authorized.auth.supabaseAdmin,
              authorized.auth.userId,
            );
          } catch {
            return jsonError("Memory storage is temporarily unavailable. Please retry.", 503);
          }
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
        let body: {
          operation?: unknown;
          contextSummary?: unknown;
          contextOnly?: unknown;
          chatId?: unknown;
          memoryEnabled?: unknown;
          temporary?: unknown;
          automaticMemory?: unknown;
        };
        try {
          body = JSON.parse(raw);
        } catch {
          return jsonError("Invalid payload.", 400);
        }
        if (!body || typeof body !== "object" || Array.isArray(body))
          return jsonError("Invalid payload.", 400);
        if (body.operation === "save_reviewed_memory") {
          return saveReviewedMemory(body, authorized, memoryEpoch, request);
        }
        if (body.operation === "update_conversation_notes") {
          if (
            body.memoryEnabled !== true ||
            body.automaticMemory !== true ||
            body.temporary !== false ||
            typeof body.chatId !== "string" ||
            !/^[A-Za-z0-9._:-]{1,100}$/u.test(body.chatId) ||
            request.headers.get("X-Kova-Owner") !== caller.auth.userId
          )
            return jsonError("Enable conversation memory in Settings before saving notes.", 400);
          const admission = await consumeApplicationRateLimit({
            identity: `account:${caller.auth.userId}`,
            action: "automatic_memory",
            limit: 60,
            windowSeconds: 900,
          });
          if (!admission.allowed)
            return jsonError(
              "Memory updates will resume shortly.",
              admission.status === "limited" ? 429 : 503,
            );
          const record = await loose(caller.auth.supabaseUser)
            .from("chat_history_records")
            .select("payload,revision")
            .eq("owner_id", caller.auth.userId)
            .eq("id", body.chatId)
            .is("deleted_at", null)
            .maybeSingle()
            .abortSignal(AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]));
          if (record.error) return jsonError("Synced chat is unavailable.", 503);
          if (!record.data)
            return jsonError("Wait for this chat to sync before updating memory.", 409);
          try {
            const source = reviewedMemorySource(record.data.payload, caller.auth.userId);
            if (source.conversation.id !== body.chatId)
              return jsonError("Memory source changed.", 409);
            const notes = conversationMemoryNotes(
              source.conversation.messages.slice(source.conversation.memoryStartIndex ?? 0),
              caller.tier,
            );
            if (!notes)
              return Response.json(
                { ok: true, saved: false },
                { headers: { "Cache-Control": "no-store" } },
              );
            if (caller.auth.revalidateSession && !(await caller.auth.revalidateSession()))
              return jsonError("Your account changed.", 401);
            const saved = await loose(caller.auth.supabaseAdmin)
              .rpc("persist_automatic_chat_memory", {
                p_user_id: caller.auth.userId,
                p_epoch: memoryEpoch,
                p_chat_id: body.chatId,
                p_revision: record.data.revision,
                p_title: source.title,
                p_summary: notes,
                p_message_count: source.messageCount,
                p_stored_limit: MEMORY_TIERS[caller.tier].stored,
              })
              .abortSignal(AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]));
            if (saved.error) return jsonError("Memory could not be updated.", 503);
            return Response.json(
              { ok: true, saved: saved.data === true },
              { headers: { "Cache-Control": "no-store" } },
            );
          } catch {
            return jsonError("This chat is not eligible for conversation memory.", 409);
          }
        }
        const parsed = parseMemoryPayload(raw);
        if (!parsed.ok) return jsonError(parsed.error, parsed.status);
        // Old clients must not silently promote a temporary instruction into
        // cross-chat memory. A general memory toggle is not reviewed-save consent.
        if (body.contextOnly !== true)
          return jsonError("Automatic cross-chat memory saving is unavailable.", 409);
        const snapshot = parseChatSummarySnapshot(body.contextSummary);
        if (
          !snapshot ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
            parsed.value.chatId,
          )
        )
          return jsonError("Invalid conversation summary payload.", 400);

        // Admission runs inside the client's existing memory-write barrier.
        // Privacy deletion drains this POST before removing pending summaries.
        if (chatSummariesEnabled()) {
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
