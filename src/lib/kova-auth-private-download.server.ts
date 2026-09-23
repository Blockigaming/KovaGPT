import type { SupabaseClient } from "@supabase/supabase-js";
import { requireVerifiedUser, type HttpAuthedCaller } from "./api-auth.server";
import { consumeApplicationRateLimit } from "./distributed-rate-limit.server";
import { runtimeEnv } from "./runtime-env.server";
import {
  createRequestDeadline,
  waitForPromiseWithSignal,
} from "./ai/provider-transport.server.mjs";
import { readResponseBytesBounded } from "./endpoint-reliability.mjs";
import { inspectProjectFile, sha256Hex } from "./project-files-policy.mjs";
import {
  PRIVATE_PROJECT_COLUMNS,
  PRIVATE_DELIVERABLE_COLUMNS,
  PRIVATE_EXPORT_COLUMNS,
  PRIVATE_EVIDENCE_COLUMNS,
  privateFileDescriptor,
  privateFileVersion,
  validPrivateResourceId,
  type PrivateFileKind,
} from "./kova-auth-private-download.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const denied = (status = 404) =>
  Response.json(
    { error: "Private file unavailable." },
    {
      status,
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
    },
  );

export async function handleOwnedPrivateDownload(request: Request): Promise<Response> {
  if (request.method !== "GET") return denied(405);
  const deadline = createRequestDeadline(request.signal, 45_000, "owned_private_download");
  const bounded = <T>(work: PromiseLike<T>) =>
    waitForPromiseWithSignal(Promise.resolve(work), deadline.signal);
  try {
    const url = new URL(request.url),
      keys = [...url.searchParams.keys()];
    const kind = url.searchParams.get("kind") as PrivateFileKind;
    const owner = url.searchParams.get("owner"),
      id = url.searchParams.get("id"),
      version = url.searchParams.get("version");
    if (
      keys.length !== 4 ||
      new Set(keys).size !== 4 ||
      !keys.every((key) => ["kind", "owner", "id", "version"].includes(key)) ||
      !owner ||
      !UUID.test(owner) ||
      !id ||
      !validPrivateResourceId(kind, id) ||
      !version ||
      !/^[0-9a-f]{64}$/u.test(version)
    )
      return denied(400);
    const site = request.headers.get("sec-fetch-site"),
      origin = request.headers.get("origin");
    if ((site && !["same-origin", "none"].includes(site)) || (origin && origin !== url.origin))
      return denied(403);
    const auth = await bounded(requireVerifiedUser(request));
    if (auth instanceof Response) return auth;
    if (
      auth.authProvider !== "kova" ||
      auth.userId !== owner ||
      typeof auth.claims?.session_id !== "string" ||
      !auth.claims.session_id ||
      typeof auth.revalidateSession !== "function"
    )
      return denied(401);
    const rate = await bounded(
      consumeApplicationRateLimit({
        identity: `user:${owner}`,
        action: `owned_private_${kind}`,
        limit: kind === "export" ? 20 : 120,
        windowSeconds: 60,
      }),
    );
    if (!rate.allowed) return denied(rate.status === "unavailable" ? 503 : 429);
    const user = auth.supabaseUser as unknown as SupabaseClient;
    const admin = auth.supabaseAdmin as unknown as SupabaseClient;
    const current = async (boundAuth: HttpAuthedCaller) => {
      const [live, fence] = await Promise.all([
        bounded(boundAuth.revalidateSession!()),
        bounded(
          admin
            .from("account_deletion_fences")
            .select("user_id")
            .eq("user_id", owner)
            .abortSignal(deadline.signal)
            .maybeSingle(),
        ),
      ]);
      if (live !== true || fence.error || fence.data)
        throw new Error("private_authority_unavailable");
    };
    const read = async () => {
      const table =
        kind === "project"
          ? "project_files"
          : kind === "deliverable"
            ? "agent_deliverables"
            : kind === "evidence"
              ? "agent_job_events"
              : "account_export_jobs";
      const columns =
        kind === "project"
          ? PRIVATE_PROJECT_COLUMNS
          : kind === "deliverable"
            ? PRIVATE_DELIVERABLE_COLUMNS
            : kind === "evidence"
              ? PRIVATE_EVIDENCE_COLUMNS
              : PRIVATE_EXPORT_COLUMNS;
      let query = (kind === "export" ? admin : user).from(table).select(columns).eq("id", id);
      if (kind === "export") query = query.eq("user_id", owner);
      if (kind === "deliverable") query = query.eq("owner_id", owner);
      const result = await bounded(query.abortSignal(deadline.signal).maybeSingle());
      if (result.error || !result.data) throw new Error("private_record_unavailable");
      const descriptor = privateFileDescriptor(kind, owner, result.data);
      if (descriptor.id !== id || (await privateFileVersion(descriptor)) !== version)
        throw new Error("private_record_changed");
      if (kind === "evidence") {
        const job = await bounded(
          user
            .from("agent_jobs")
            .select("id,owner_id")
            .eq("id", descriptor.scope)
            .eq("owner_id", owner)
            .abortSignal(deadline.signal)
            .maybeSingle(),
        );
        if (job.error || job.data?.id !== descriptor.scope || job.data?.owner_id !== owner)
          throw new Error("private_job_unavailable");
      }
      return descriptor;
    };
    await current(auth);
    const descriptor = await read();
    const base = new URL(runtimeEnv("SUPABASE_URL") ?? "");
    if (
      base.protocol !== "https:" ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== "/"
    )
      return denied(503);
    // Only the account export's service-owned bucket uses the admin Storage
    // client. Project and Work objects retain caller-scoped Storage RLS.
    const signed = await bounded(
      (kind === "export" ? admin : user).storage
        .from(descriptor.bucket)
        .createSignedUrl(descriptor.path, 30),
    );
    if (signed.error || !signed.data?.signedUrl) return denied(503);
    const source = new URL(signed.data.signedUrl);
    if (
      source.protocol !== "https:" ||
      source.origin !== base.origin ||
      source.username ||
      source.password ||
      source.hash ||
      decodeURIComponent(source.pathname) !==
        `/storage/v1/object/sign/${descriptor.bucket}/${descriptor.path}`
    )
      return denied(502);
    const response = await bounded(
      fetch(source.href, {
        signal: deadline.signal,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
      }),
    );
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      return denied(502);
    }
    const bytes = await readResponseBytesBounded(response, descriptor.maxBytes, {
      signal: deadline.signal,
      timeoutMs: 15000,
    });
    if (
      (descriptor.size !== null && bytes.length !== descriptor.size) ||
      (descriptor.sha256 !== null && (await sha256Hex(bytes)) !== descriptor.sha256)
    )
      return denied(502);
    let mime = descriptor.mime ?? "application/octet-stream";
    if (descriptor.image) {
      const inspected = inspectProjectFile({
        bytes,
        fileName: "evidence.png",
        requestedKind: "image",
      });
      if (descriptor.mime !== null && descriptor.mime !== inspected.mimeType) return denied(502);
      mime = inspected.mimeType;
    }
    // Recheck both the live object revision/current RLS and the original cookie
    // after collection. No bytes or reusable Storage credential leave early.
    await read();
    await current(auth);
    deadline.signal.throwIfAborted();
    return new Response(bytes as BodyInit, {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `${descriptor.image ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(descriptor.name)}`,
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    return denied(deadline.signal.aborted ? 504 : 404);
  } finally {
    deadline.cleanup();
  }
}
