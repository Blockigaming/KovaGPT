import { createFileRoute } from "@tanstack/react-router";
import {
  requireVerifiedUser,
  getCallerTier,
  assertNotBanned,
  assertFeatureEnabled,
} from "@/lib/api-auth.server";
import { STORAGE_LIMITS_BYTES } from "@/lib/modes";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { BodyReadError, readResponseBytesBounded } from "@/lib/endpoint-reliability.mjs";
import {
  createRequestDeadline,
  waitForPromiseWithSignal,
} from "@/lib/ai/provider-transport.server.mjs";
import {
  publishOriginalLibraryDocument,
  downloadOriginalLibraryDocument,
} from "@/lib/library-original-files.server.mjs";
import {
  LIBRARY_ORIGINAL_MAX_BYTES,
  LibraryOriginalError,
} from "@/lib/library-original-policy.mjs";
import { runtimeEnv } from "@/lib/runtime-env.server";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function handle(request: Request) {
  const deadline = createRequestDeadline(request.signal, 45_000, "library_original");
  try {
    const auth = await waitForPromiseWithSignal(requireVerifiedUser(request), deadline.signal);
    if (auth instanceof Response) return auth;
    if (request.headers.get("x-kova-owner") !== auth.userId)
      return json({ error: "Your account changed. Please try again." }, 409);
    const rate = await waitForPromiseWithSignal(
      consumeApplicationRateLimit({
        identity: `user:${auth.userId}`,
        action: "library_original",
        limit: 20,
        windowSeconds: 60,
      }),
      deadline.signal,
    );
    if (!rate.allowed)
      return json(
        { error: "Please wait before another original-file request." },
        rate.status === "unavailable" ? 503 : 429,
      );
    const url = new URL(request.url),
      id = url.searchParams.get("id"),
      generation = url.searchParams.get("generation");
    if (!id || !UUID.test(id)) return json({ error: "Invalid file request." }, 400);
    if (generation && !UUID.test(generation))
      return json({ error: "Invalid file generation." }, 400);
    const supabaseUrl = runtimeEnv("SUPABASE_URL") ?? "";
    if (request.method === "GET") {
      if (!generation || !UUID.test(generation))
        return json({ error: "Refresh Library before downloading this original." }, 409);
      const { row, bytes } = await downloadOriginalLibraryDocument(
        auth.supabaseAdmin,
        auth.userId,
        id,
        generation,
        deadline.signal,
        { supabaseUrl },
      );
      return new Response(bytes as BodyInit, {
        headers: {
          "Content-Type": row.mime_type,
          "Content-Length": String(bytes.length),
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "sandbox",
        },
      });
    }
    const banned = await waitForPromiseWithSignal(assertNotBanned(auth), deadline.signal);
    if (banned) return banned;
    const disabled = await waitForPromiseWithSignal(
      assertFeatureEnabled(auth, "uploads"),
      deadline.signal,
    );
    if (disabled) return disabled;
    const type = request.headers.get("content-type") ?? "";
    if (!type.startsWith("multipart/form-data;"))
      return json({ error: "Invalid original-file upload." }, 415);
    const body = await readResponseBytesBounded(
      new Response(request.body, { headers: request.headers }),
      LIBRARY_ORIGINAL_MAX_BYTES + 250000,
      { signal: deadline.signal, timeoutMs: 15000 },
    );
    let form: FormData;
    try {
      form = await new Response(body as BodyInit, { headers: { "Content-Type": type } }).formData();
    } catch {
      throw new LibraryOriginalError("Invalid original-file form.", 400);
    }
    if ([...form.keys()].length !== 2) return json({ error: "Invalid original-file fields." }, 400);
    const file = form.get("file"),
      text = form.get("text");
    if (!(file instanceof File) || typeof text !== "string")
      return json({ error: "Invalid original-file fields." }, 400);
    const tier = await waitForPromiseWithSignal(getCallerTier(auth), deadline.signal);
    return json(
      await publishOriginalLibraryDocument(
        auth.supabaseAdmin,
        auth.userId,
        {
          id,
          name: file.name,
          contentType: file.type,
          bytes: new Uint8Array(await file.arrayBuffer()),
          text,
        },
        {
          storageLimit: STORAGE_LIMITS_BYTES[tier],
          signal: deadline.signal,
          supabaseUrl,
          expectedGeneration: generation ?? undefined,
        },
      ),
    );
  } catch (error) {
    if (error instanceof BodyReadError)
      return json(
        {
          error:
            request.method === "POST"
              ? "The original-file upload is too large or incomplete."
              : "The original-file response was invalid.",
        },
        request.method === "POST" ? error.status : 502,
      );
    if (error instanceof LibraryOriginalError) return json({ error: error.message }, error.status);
    if (deadline.signal.aborted)
      return json({ error: "The original-file request timed out. Please retry." }, 504);
    return json({ error: "The original file could not be processed. Please retry." }, 503);
  } finally {
    deadline.cleanup();
  }
}
export const Route = createFileRoute("/api/library/files")({
  server: {
    handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) },
  },
});
