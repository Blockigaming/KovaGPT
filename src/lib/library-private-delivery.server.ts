// Private Library URLs carry resource identity, never a transferable credential.
// Every read authorizes the current cookie again after collecting bounded bytes.
import { requireVerifiedUser, type HttpAuthedCaller } from "@/lib/api-auth.server";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { readResponseBytesBounded } from "@/lib/endpoint-reliability.mjs";
import {
  createRequestDeadline,
  waitForPromiseWithSignal,
} from "@/lib/ai/provider-transport.server.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_BYTES = 8 * 1024 * 1024;
const unavailable = (status = 404) =>
  Response.json(
    { error: "Private image unavailable." },
    {
      status,
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
    },
  );

export async function reauthorizeLibraryDelivery(
  request: Request,
  before: HttpAuthedCaller,
  signal: AbortSignal,
): Promise<Response | null> {
  signal.throwIfAborted();
  if (before.authProvider !== "kova") return null;
  const current = await waitForPromiseWithSignal(requireVerifiedUser(request), signal);
  if (current instanceof Response) return current;
  if (
    current.authProvider !== "kova" ||
    current.userId !== before.userId ||
    typeof before.claims?.session_id !== "string" ||
    !before.claims.session_id ||
    current.claims?.session_id !== before.claims.session_id ||
    current.claims?.aal !== before.claims?.aal
  )
    return unavailable(401);
  return null;
}

type ImageRecord = {
  owner_id: string;
  generation: string;
  storage_path: string;
  size_bytes: number;
  mime_type: string | null;
  sha256: string | null;
  state: string;
  legacy?: boolean;
};
function imageRecord(value: unknown, owner: string, generation: string): ImageRecord {
  const row = value as ImageRecord | null;
  if (
    !row ||
    typeof row !== "object" ||
    Array.isArray(row) ||
    row.owner_id !== owner ||
    row.generation !== generation ||
    row.state !== "ready" ||
    typeof row.storage_path !== "string" ||
    row.storage_path.length > 1024 ||
    !row.storage_path.startsWith(`${owner}/`) ||
    [...row.storage_path].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || "\\?#%".includes(char),
    ) ||
    row.storage_path.split("/").some((part) => !part || part === "." || part === "..") ||
    !Number.isSafeInteger(row.size_bytes) ||
    row.size_bytes < 1 ||
    row.size_bytes > MAX_BYTES ||
    (row.mime_type !== null &&
      !["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"].includes(
        row.mime_type,
      )) ||
    (row.sha256 !== null &&
      (typeof row.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(row.sha256))) ||
    (row.legacy !== true && !row.sha256)
  )
    throw new Error("private_image_record_invalid");
  return row;
}
function fingerprint(row: ImageRecord) {
  return JSON.stringify([
    row.owner_id,
    row.generation,
    row.storage_path,
    row.size_bytes,
    row.mime_type,
    row.sha256,
    row.state,
    row.legacy === true,
  ]);
}
function rasterType(bytes: Uint8Array): string | null {
  if (bytes.length > 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b))
    return "image/png";
  if (bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  const ascii = (start: number, end: number) => new TextDecoder().decode(bytes.slice(start, end));
  if (bytes.length > 6 && /^GIF8[79]a$/u.test(ascii(0, 6))) return "image/gif";
  if (bytes.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

export async function handlePrivateLibraryImage(request: Request): Promise<Response> {
  if (request.method !== "GET") return unavailable(405);
  const deadline = createRequestDeadline(request.signal, 15_000, "library_private_image");
  const bounded = <T>(work: PromiseLike<T>) =>
    waitForPromiseWithSignal(Promise.resolve(work), deadline.signal);
  try {
    const url = new URL(request.url),
      entries = [...url.searchParams.keys()];
    const id = url.searchParams.get("id"),
      owner = url.searchParams.get("owner"),
      generation = url.searchParams.get("generation");
    if (
      entries.length !== 4 ||
      new Set(entries).size !== 4 ||
      !entries.every((key) => ["kind", "id", "owner", "generation"].includes(key)) ||
      url.searchParams.get("kind") !== "image" ||
      !id ||
      !owner ||
      !generation ||
      !UUID.test(id) ||
      !UUID.test(owner) ||
      !UUID.test(generation)
    )
      return unavailable(400);
    const site = request.headers.get("sec-fetch-site"),
      origin = request.headers.get("origin");
    if ((site && !["same-origin", "none"].includes(site)) || (origin && origin !== url.origin))
      return unavailable(403);
    const authHeaders = new Headers(request.headers);
    authHeaders.set("X-Kova-Owner", owner);
    const authRequest = new Request(request, { headers: authHeaders });
    const auth = await bounded(requireVerifiedUser(authRequest));
    if (auth instanceof Response) return auth;
    if (
      auth.authProvider !== "kova" ||
      auth.userId !== owner ||
      typeof auth.claims?.session_id !== "string" ||
      !auth.claims.session_id
    )
      return unavailable(401);
    const rate = await bounded(
      consumeApplicationRateLimit({
        identity: `user:${auth.userId}`,
        action: "library_private_image",
        limit: 120,
        windowSeconds: 60,
      }),
    );
    if (!rate.allowed) return unavailable(rate.status === "unavailable" ? 503 : 429);
    const admin = auth.supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient;
    const read = async () => {
      const result = await bounded(
        admin
          .rpc("read_library_image_upload", { p_owner: owner, p_id: id })
          .abortSignal(deadline.signal),
      );
      if (result.error) throw new Error("private_image_read_failed");
      return imageRecord(result.data, owner, generation);
    };
    const row = await read();
    const base = new URL(runtimeEnv("SUPABASE_URL") ?? "");
    if (
      base.protocol !== "https:" ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== "/"
    )
      return unavailable(503);
    // Storage signing stays server-internal; no signed URL or token reaches the client.
    const signed = await bounded(
      admin.storage.from("library-images").createSignedUrl(row.storage_path, 30),
    );
    if (signed.error || !signed.data?.signedUrl) return unavailable(503);
    const source = new URL(signed.data.signedUrl);
    if (
      source.origin !== base.origin ||
      source.protocol !== "https:" ||
      source.username ||
      source.password ||
      source.hash ||
      decodeURIComponent(source.pathname) !==
        `/storage/v1/object/sign/library-images/${row.storage_path}`
    )
      return unavailable(502);
    const upstream = await bounded(
      fetch(source.href, {
        signal: deadline.signal,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
      }),
    );
    if (!upstream.ok) {
      void upstream.body?.cancel().catch(() => undefined);
      return unavailable(502);
    }
    const bytes = await readResponseBytesBounded(upstream, MAX_BYTES, {
      signal: deadline.signal,
      timeoutMs: 10_000,
    });
    const mime = rasterType(bytes);
    if (
      !mime ||
      (row.mime_type !== null && row.mime_type.replace("image/jpg", "image/jpeg") !== mime) ||
      (row.sha256 ? bytes.length !== row.size_bytes : bytes.length > row.size_bytes)
    )
      return unavailable(502);
    if (row.sha256) {
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)),
        (x) => x.toString(16).padStart(2, "0"),
      ).join("");
      if (digest !== row.sha256) return unavailable(502);
    }
    if (fingerprint(await read()) !== fingerprint(row)) return unavailable();
    const rejected = await reauthorizeLibraryDelivery(authRequest, auth, deadline.signal);
    if (rejected) return rejected;
    deadline.signal.throwIfAborted();
    return new Response(bytes as BodyInit, {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    return unavailable(deadline.signal.aborted ? 504 : 404);
  } finally {
    deadline.cleanup();
  }
}
