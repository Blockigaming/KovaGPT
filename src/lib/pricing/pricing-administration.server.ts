import { verifyConfiguredCreditOffer } from "./developer-offer-verification.server";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdministrator } from "@/lib/administrator.server";
import { assertNotBanned } from "@/lib/api-auth.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { readBoundedJsonObject, BoundedJsonError } from "@/lib/bounded-json.server.mjs";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { validatePricingProposal, validateCreditOfferProposal } from "./pricing-administration.mjs";

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const uuid = (value: unknown) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
type Draft = {
  id: string;
  kind: "pricing" | "credit_offer";
  revision: number;
  payload_hash: string;
  canonical_payload: string;
  status: string;
};
function validate(kind: string, proposal: unknown) {
  if (kind === "pricing") return validatePricingProposal(proposal);
  if (kind === "credit_offer") return validateCreditOfferProposal(proposal);
  throw new Error("pricing_admin_kind_invalid");
}
async function readDraft(db: SupabaseClient, id: string): Promise<Draft> {
  const result = await db
    .from("developer_pricing_drafts")
    .select("*")
    .eq("id", id)
    .abortSignal(AbortSignal.timeout(10000))
    .maybeSingle();
  if (result.error || !result.data) throw new Error("pricing_admin_draft_unavailable");
  return result.data;
}
export async function handlePricingAdministration(request: Request): Promise<Response> {
  if (request.method === "POST" && isCrossSiteMutation(request))
    return json({ error: "cross_site_request_blocked" }, 403);
  const authorization = await requireAdministrator(request);
  if ("response" in authorization) return authorization.response;
  const caller = authorization.caller;
  if (request.headers.get("X-Kova-Expected-User") !== caller.userId)
    return json({ error: "pricing_admin_principal_changed" }, 409);
  const banned = await assertNotBanned(caller);
  if (banned) return banned;
  const db: SupabaseClient = caller.supabaseAdmin;
  const rate = await consumeApplicationRateLimit({
    identity: `user:${caller.userId}`,
    action: "pricing_administration",
    limit: 30,
    windowSeconds: 60,
  });
  if (!rate.allowed)
    return json({ error: "pricing_admin_rate_limited" }, rate.status === "limited" ? 429 : 503);
  try {
    if (request.method === "GET") {
      const url = new URL(request.url),
        id = url.searchParams.get("id");
      if (id) {
        if (!uuid(id)) return json({ error: "pricing_admin_id_invalid" }, 400);
        const draft = await readDraft(db, id);
        let preview = null;
        try {
          preview = validate(draft.kind, JSON.parse(draft.canonical_payload));
        } catch {
          /* Expired drafts remain reviewable and editable. */
        }
        return json({ draft, preview });
      }
      const page = Number(url.searchParams.get("page") ?? 0);
      if (!Number.isSafeInteger(page) || page < 0 || page > 1000)
        return json({ error: "pricing_admin_page_invalid" }, 400);
      const result = await db
        .from("developer_pricing_drafts")
        .select("id,kind,revision,payload_hash,status,result_id,approved_at,updated_at")
        .order("created_at", { ascending: false })
        .order("id")
        .range(page * 20, page * 20 + 20)
        .abortSignal(AbortSignal.timeout(10000));
      if (result.error) throw new Error("pricing_admin_drafts_unavailable");
      return json({
        page,
        hasMore: (result.data?.length ?? 0) > 20,
        drafts: result.data?.slice(0, 20) ?? [],
      });
    }
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json")
      return json({ error: "json_content_type_required" }, 415);
    const body = await readBoundedJsonObject(request, 147456);
    if (!uuid(body.id)) return json({ error: "pricing_admin_id_invalid" }, 400);
    if (body.operation === "save") {
      if (
        typeof body.kind !== "string" ||
        !Number.isSafeInteger(body.revision) ||
        Number(body.revision) < 0
      )
        throw new Error("pricing_admin_revision_invalid");
      const checked = validate(body.kind, body.proposal);
      const hash = createHash("sha256").update(checked.canonical).digest("hex");
      const result = await db.rpc("save_developer_pricing_draft", {
        p_admin: caller.userId,
        p_id: body.id,
        p_kind: body.kind,
        p_expected_revision: body.revision,
        p_expected_hash: body.hash ?? null,
        p_canonical: checked.canonical,
        p_hash: hash,
      });
      if (result.error || !result.data)
        throw new Error(
          result.error?.code === "23505"
            ? "pricing_admin_version_conflict"
            : "pricing_admin_draft_conflict",
        );
      return json({ draft: result.data, preview: checked });
    }
    const draft = await readDraft(db, body.id as string);
    if (draft.revision !== body.revision || draft.payload_hash !== body.hash)
      throw new Error("pricing_admin_draft_conflict");
    let rpc: string, args: Record<string, unknown>;
    if (body.operation === "approve") {
      if (body.reviewedHash !== draft.payload_hash)
        throw new Error("pricing_admin_review_required");
      if (draft.status === "approved") return json({ draft });
      const checked = validate(draft.kind, JSON.parse(draft.canonical_payload));
      if (createHash("sha256").update(checked.canonical).digest("hex") !== draft.payload_hash)
        throw new Error("pricing_admin_hash_conflict");
      if (draft.kind === "credit_offer") await verifyConfiguredCreditOffer(checked.proposal);
      rpc = "approve_developer_pricing_draft";
      args = {
        p_admin: caller.userId,
        p_id: draft.id,
        p_revision: draft.revision,
        p_hash: draft.payload_hash,
      };
    } else if (body.operation === "retire") {
      if (
        typeof body.reason !== "string" ||
        body.reason.trim().length < 8 ||
        body.reason.length > 500
      )
        throw new Error("pricing_admin_reason_required");
      rpc = "retire_developer_pricing_draft";
      args = {
        p_admin: caller.userId,
        p_id: draft.id,
        p_revision: draft.revision,
        p_hash: draft.payload_hash,
        p_reason: body.reason.trim(),
      };
    } else throw new Error("pricing_admin_operation_invalid");
    const result = await db.rpc(rpc, args);
    if (result.error || !result.data)
      throw new Error(
        result.error?.code === "23505"
          ? "pricing_admin_version_conflict"
          : "pricing_admin_draft_conflict",
      );
    return json({ draft: result.data });
  } catch (error) {
    if (error instanceof BoundedJsonError) return json({ error: error.code }, error.status);
    const code =
      error instanceof Error && /^pricing_admin_[a-z_]+$/.test(error.message)
        ? error.message
        : "pricing_admin_unavailable";
    return json(
      { error: code },
      /conflict|principal_changed/.test(code)
        ? 409
        : /invalid|required|duplicate/.test(code)
          ? 400
          : 503,
    );
  }
}
