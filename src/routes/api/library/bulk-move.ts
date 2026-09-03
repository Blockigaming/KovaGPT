import { createFileRoute } from "@tanstack/react-router";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { requireUser } from "@/lib/api-auth.server";
import { BoundedJsonError, readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import {
  LibraryFolderInputError,
  MAX_LIBRARY_MUTATION_BODY_BYTES,
  libraryMutationErrorStatus,
  parseBulkMoveLibraryItems,
} from "@/lib/library-folders-policy.mjs";

function json(value: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...extraHeaders },
  });
}

function contentTypeIsJson(request: Request): boolean {
  return (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ===
    "application/json"
  );
}

export const Route = createFileRoute("/api/library/bulk-move")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (isCrossSiteMutation(request)) {
          return json({ error: "cross_site_request_blocked" }, 403);
        }
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;
        const rateLimit = await consumeApplicationRateLimit({
          identity: `user:${auth.userId}`,
          action: "library_bulk_move",
          limit: 60,
          windowSeconds: 60,
        });
        if (!rateLimit.allowed) {
          return json(
            {
              error:
                rateLimit.status === "limited"
                  ? "library_bulk_move_rate_limited"
                  : "library_bulk_move_protection_unavailable",
            },
            rateLimit.status === "limited" ? 429 : 503,
            { "Retry-After": String(rateLimit.retryAfter) },
          );
        }
        if (!contentTypeIsJson(request)) {
          return json({ error: "json_content_type_required" }, 415);
        }

        let body: unknown;
        try {
          body = await readBoundedJsonObject(request, MAX_LIBRARY_MUTATION_BODY_BYTES);
        } catch (error) {
          if (error instanceof BoundedJsonError) return json({ error: error.code }, error.status);
          return json({ error: "invalid_request_body" }, 400);
        }

        let input;
        try {
          input = parseBulkMoveLibraryItems(body);
        } catch (error) {
          if (error instanceof LibraryFolderInputError) {
            return json({ error: error.code }, 400);
          }
          return json({ error: "invalid_request" }, 400);
        }

        const { data, error } = await auth.supabaseAdmin.rpc(
          "bulk_move_library_items" as never,
          {
            p_user_id: auth.userId,
            p_item_ids: [...input.itemIds],
            p_folder_id: input.folderId,
          } as never,
        );
        if (error) {
          const status = libraryMutationErrorStatus(error.code);
          return json(
            {
              error:
                status === 404
                  ? "library_item_or_folder_not_found"
                  : status === 400
                    ? "invalid_library_bulk_move"
                    : "library_bulk_move_failed",
            },
            status,
          );
        }
        const result: unknown = data;
        if (
          !result ||
          typeof result !== "object" ||
          Array.isArray(result) ||
          !("movedCount" in result) ||
          typeof result.movedCount !== "number" ||
          result.movedCount !== input.itemIds.length
        ) {
          return json({ error: "library_bulk_move_unverified" }, 503);
        }
        return json({ movedCount: result.movedCount, folderId: input.folderId });
      },
    },
  },
});
