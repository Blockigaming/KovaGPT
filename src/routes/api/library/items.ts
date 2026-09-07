import type { SupabaseClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { requireVerifiedUser, getCallerTier, assertNotBanned } from "@/lib/api-auth.server";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { readBoundedJsonObject, BoundedJsonError } from "@/lib/bounded-json.server.mjs";
import {
  createRequestDeadline,
  waitForPromiseWithSignal,
} from "@/lib/ai/provider-transport.server.mjs";
import { STORAGE_LIMITS_BYTES } from "@/lib/modes";
const uuid = (x: unknown): x is string =>
  typeof x === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
async function handle(request: Request) {
  const deadline = createRequestDeadline(request.signal, 20000, "library_items");
  try {
    const caller = await waitForPromiseWithSignal(requireVerifiedUser(request), deadline.signal);
    if (caller instanceof Response) return caller;
    if (request.headers.get("X-Kova-Owner") !== caller.userId)
      return json({ error: "Your account changed. Please try again." }, 409);
    const banned = await waitForPromiseWithSignal(assertNotBanned(caller), deadline.signal);
    if (banned) return banned;
    const rate = await waitForPromiseWithSignal(
      consumeApplicationRateLimit({
        identity: `user:${caller.userId}`,
        action: "library_versions",
        limit: 60,
        windowSeconds: 60,
      }),
      deadline.signal,
    );
    if (!rate.allowed)
      return json(
        { error: "Please wait before another Library request." },
        rate.status === "unavailable" ? 503 : 429,
      );
    const db: SupabaseClient = caller.supabaseAdmin;
    const rpc = async (name: string, args: Record<string, unknown>) => {
      const result = await waitForPromiseWithSignal(
        Promise.resolve(db.rpc(name, args).abortSignal(deadline.signal)),
        deadline.signal,
      );
      if (result.error) throw new Error(result.error.message);
      return result.data;
    };
    if (
      request.method === "POST" &&
      request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
    )
      return json({ error: "JSON is required." }, 415);
    const body = request.method === "POST" ? await readBoundedJsonObject(request, 2_000_000) : null;
    if (request.method === "GET" || body?.operation === "list") {
      const url = new URL(request.url);
      if (body?.operation === "list")
        for (const name of ["query", "sort", "folder", "filter", "cursor", "favorites"]) {
          const value = body[name];
          if (value !== undefined && value !== null)
            url.searchParams.set(name, typeof value === "string" ? value : JSON.stringify(value));
        }
      const id = url.searchParams.get("id"),
        generation = url.searchParams.get("generation");
      if (id) {
        if (!uuid(id) || !uuid(generation))
          return json({ error: "Refresh Library before opening this item." }, 409);
        const args = { p_owner: caller.userId, p_item: id, p_generation: generation };
        const history = url.searchParams.get("history") === "1",
          revision = url.searchParams.get("revision");
        if (revision !== null && (!/^\d{1,7}$/.test(revision) || Number(revision) < 1))
          return json({ error: "Invalid revision." }, 400);
        const result = await rpc(
          history
            ? "read_library_version_history"
            : revision
              ? "read_library_text_version"
              : "read_library_item",
          { ...args, ...(revision ? { p_revision: Number(revision) } : {}) },
        );
        if (!result) return json({ error: "This Library item is no longer available." }, 404);
        return json(result);
      }
      const query = url.searchParams.get("query") ?? "",
        sort = url.searchParams.get("sort") ?? "newest",
        folder = url.searchParams.get("folder") ?? "all",
        filter = url.searchParams.get("filter") ?? "all",
        rawCursor = url.searchParams.get("cursor"),
        rawFavorites = url.searchParams.get("favorites") ?? "";
      if (
        query.length > 200 ||
        !["newest", "oldest", "name", "size"].includes(sort) ||
        !["all", "favorites", "images", "documents", "other"].includes(filter) ||
        (!["all", "unfiled"].includes(folder) && !uuid(folder)) ||
        (rawCursor?.length ?? 0) > 3000 ||
        rawFavorites.length > 37000
      )
        return json({ error: "Invalid Library page." }, 400);
      const favorites = rawFavorites ? rawFavorites.split(",") : [];
      if (favorites.length > 1000 || favorites.some((x) => !uuid(x)))
        return json({ error: "Invalid Library favorites." }, 400);
      let cursor = null;
      try {
        cursor = rawCursor ? JSON.parse(rawCursor) : null;
      } catch {
        return json({ error: "Invalid Library cursor." }, 400);
      }
      return json(
        await rpc("list_library_items_page", {
          p_owner: caller.userId,
          p_query: query,
          p_cursor: cursor,
          p_folder: folder,
          p_filter: filter,
          p_sort: sort,
          p_favorites: favorites,
        }),
      );
    }
    if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json")
      return json({ error: "JSON is required." }, 415);
    if (!body) return json({ error: "Invalid Library request." }, 400);
    if (
      !uuid(body.id) ||
      !uuid(body.generation) ||
      !Number.isSafeInteger(body.revision) ||
      Number(body.revision) < 1 ||
      Number(body.revision) > 1000000
    )
      return json({ error: "Refresh Library before changing this item." }, 409);
    const args = {
      p_owner: caller.userId,
      p_item: body.id,
      p_generation: body.generation,
      p_revision: body.revision,
    };
    if (body.operation === "replace_text") {
      if (typeof body.text !== "string" || new TextEncoder().encode(body.text).length > 300000)
        return json({ error: "Text must be 300 KB or smaller." }, 400);
      const tier = await waitForPromiseWithSignal(getCallerTier(caller), deadline.signal);
      return json({
        revision: await rpc("replace_library_text", {
          ...args,
          p_text: body.text,
          p_storage_limit: STORAGE_LIMITS_BYTES[tier],
        }),
      });
    }
    if (body.operation === "delete_text") {
      const result = await rpc("delete_library_text", args);
      if (result !== true)
        return json({ error: "This item changed. Refresh before deleting." }, 409);
      return json({ ok: true });
    }
    return json({ error: "Unsupported Library operation." }, 400);
  } catch (error) {
    if (error instanceof BoundedJsonError)
      return json({ error: "The Library request is too large or incomplete." }, error.status);
    const message = error instanceof Error ? error.message : "";
    return json(
      {
        error:
          message === "library_version_limit"
            ? "This item has reached its retained version limit. Save a new Library item."
            : message === "library_storage_limit"
              ? "Your account storage limit has been reached."
              : "Library could not confirm this request. Refresh and try again.",
      },
      deadline.signal.aborted ? 504 : 409,
    );
  } finally {
    deadline.cleanup();
  }
}
export const Route = createFileRoute("/api/library/items")({
  server: {
    handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) },
  },
});
