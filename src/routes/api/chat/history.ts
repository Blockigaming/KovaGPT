import { createFileRoute } from "@tanstack/react-router";
import { requireUser, requireVerifiedUser, getCallerTier } from "@/lib/api-auth.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { readBoundedJsonObject, BoundedJsonError } from "@/lib/bounded-json.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import {
  CHAT_HISTORY_LIMITS,
  chatHistoryUuid,
  chatHistoryId,
  normalizeChatHistory,
} from "@/lib/chat-history-policy.mjs";
import { STORAGE_LIMITS_BYTES } from "@/lib/modes";
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
type Admin = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> & {
    abortSignal(
      signal: AbortSignal,
    ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
  };
};
function databaseError(error: { code?: string; message?: string }) {
  const status =
    error.code === "40001"
      ? 409
      : error.code === "54000"
        ? 413
        : error.code === "42501"
          ? 403
          : error.code === "22023"
            ? 400
            : 503;
  return json(
    {
      error:
        status === 409
          ? "chat_history_conflict"
          : status === 413
            ? "chat_history_storage_limit"
            : status === 403
              ? "chat_history_denied"
              : "chat_history_unavailable",
    },
    status,
  );
}
export const Route = createFileRoute("/api/chat/history")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const rate = await consumeApplicationRateLimit({
          identity: `user:${auth.userId}`,
          action: "chat_history_read",
          limit: 300,
          windowSeconds: 60,
        });
        if (!rate.allowed) return json({ error: "chat_history_rate_limited" }, 429);
        try {
          const url = new URL(request.url);
          if (
            [...url.searchParams.keys()].some((key) => !["epoch", "cursor"].includes(key)) ||
            url.searchParams.getAll("epoch").length > 1 ||
            url.searchParams.getAll("cursor").length > 1
          )
            throw Error("chat_history_invalid");
          const cursor = Number(url.searchParams.get("cursor") ?? "0");
          if (!Number.isSafeInteger(cursor) || cursor < 0) throw Error("chat_history_invalid");
          const epoch = url.searchParams.get("epoch")
            ? chatHistoryUuid(url.searchParams.get("epoch"))
            : null;
          const result = await (auth.supabaseAdmin as unknown as Admin)
            .rpc("read_chat_history_changes", {
              p_owner: auth.userId,
              p_epoch: epoch,
              p_after: cursor,
              p_limit: 1,
            })
            .abortSignal(AbortSignal.any([request.signal, AbortSignal.timeout(10000)]));
          return result.error ? databaseError(result.error) : json(result.data);
        } catch (error) {
          return error instanceof Error && error.message === "chat_history_invalid"
            ? json({ error: error.message }, 400)
            : json({ error: "chat_history_unavailable" }, 503);
        }
      },
      POST: async ({ request }) => {
        if (isCrossSiteMutation(request)) return json({ error: "cross_site_request_blocked" }, 403);
        const auth = await requireVerifiedUser(request);
        if (auth instanceof Response) return auth;
        const rate = await consumeApplicationRateLimit({
          identity: `user:${auth.userId}`,
          action: "chat_history_write",
          limit: 120,
          windowSeconds: 60,
        });
        if (!rate.allowed) return json({ error: "chat_history_rate_limited" }, 429);
        try {
          const input = await readBoundedJsonObject(
            request,
            CHAT_HISTORY_LIMITS.snapshotBytes + 65536,
          );
          if (
            Object.keys(input).some(
              (key) =>
                !["id", "mutationId", "epoch", "expectedRevision", "payload", "archived"].includes(
                  key,
                ),
            ) ||
            !Number.isSafeInteger(input.expectedRevision) ||
            Number(input.expectedRevision) < 0 ||
            typeof input.archived !== "boolean"
          )
            throw new Error("chat_history_invalid");
          const id = chatHistoryId(input.id),
            payload =
              input.payload === null ? null : normalizeChatHistory(input.payload, auth.userId);
          if (payload && payload.id !== id) throw new Error("chat_history_invalid");
          const tier = await getCallerTier(auth);
          const result = await (auth.supabaseAdmin as unknown as Admin)
            .rpc("mutate_chat_history", {
              p_owner: auth.userId,
              p_epoch: chatHistoryUuid(input.epoch),
              p_id: id,
              p_mutation: chatHistoryUuid(input.mutationId),
              p_revision: input.expectedRevision,
              p_payload: payload,
              p_archived: input.archived,
              p_storage_limit: STORAGE_LIMITS_BYTES[tier],
            })
            .abortSignal(AbortSignal.any([request.signal, AbortSignal.timeout(10000)]));
          return result.error ? databaseError(result.error) : json(result.data);
        } catch (error) {
          if (error instanceof BoundedJsonError) return json({ error: error.code }, error.status);
          if (
            error instanceof Error &&
            ["chat_history_invalid", "chat_history_too_large"].includes(error.message)
          )
            return json(
              { error: error.message },
              error.message === "chat_history_too_large" ? 413 : 400,
            );
          return json({ error: "chat_history_unavailable" }, 503);
        }
      },
    },
  },
});
