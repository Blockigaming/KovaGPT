import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readAccountIdentity } from "@/lib/account-identity.server.mjs";
import { createClient } from "@supabase/supabase-js";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { consumeOpenAiApplicationAdmission } from "@/lib/ai/openai-admission-runtime.server";
import { readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";
import { requireVerifiedUser } from "@/lib/api-auth.server";
import { resolveAnonymousClientKey } from "@/lib/chat-ingress.server.mjs";
import {
  developerResponses,
  embeddings,
  imageGenerations,
  getAiProviderConfig,
  providerModelId,
  type ProviderCapability,
} from "@/lib/ai/provider.server";
import { withDeveloperBilling } from "./developer-billing.server";
import { prepareDeveloperQuote } from "./developer-metering.mjs";
import { pricingRegistryIds } from "./pricing-administration.mjs";
import { fundingAdjustedVersion } from "./developer-funding-allowance.mjs";
import { summarizeDeveloperUsage } from "./developer-usage-summary.mjs";
import { developerFileReferences } from "./developer-file-policy.mjs";
import { loadDeveloperFileContent } from "./developer-file-content.server";
import {
  DEVELOPER_SCOPES,
  developerRequestKey,
  developerUuid,
  parseDeveloperCredential,
  parseDeveloperInput,
  parseDeveloperLimits,
} from "./developer-platform-policy.mjs";

export function developerDatabase() {
  const url = runtimeEnv("SUPABASE_URL"),
    secret = runtimeEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !secret) throw new Error("developer_storage_unavailable");
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}
function pepper() {
  const value = runtimeEnv("DEVELOPER_KEY_PEPPER");
  if (!value || value.length < 32 || value.length > 512)
    throw new Error("developer_auth_unavailable");
  return value;
}
function digest(domain: string, value: string) {
  return createHmac("sha256", pepper()).update(`${domain}\n${value}`).digest("hex");
}
function equal(a: string, b: string) {
  return (
    /^[a-f0-9]{64}$/.test(a) &&
    /^[a-f0-9]{64}$/.test(b) &&
    timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"))
  );
}
export const developerJson = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
export function developerFailure(error: unknown) {
  const code =
    error instanceof Error && /^developer_[a-z_]+$/.test(error.message)
      ? error.message
      : "developer_unavailable";
  return developerJson(
    { error: { code, message: code.replaceAll("_", " ") } },
    /unauthorized/.test(code)
      ? 401
      : /scope|owner_required/.test(code)
        ? 403
        : /conflict|quote_expired|quote_changed/.test(code)
          ? 409
          : /invalid|required|too_large/.test(code)
            ? 400
            : /rate_limit/.test(code)
              ? 429
              : 503,
  );
}
export function developerEnabled() {
  return (
    runtimeEnv("KOVA_DEVELOPER_API_ENABLED") === "true" &&
    runtimeEnv("KOVA_DEVELOPER_BILLING_ENABLED") === "true"
  );
}
export async function authenticateDeveloper(request: Request) {
  if (!developerEnabled()) throw new Error("developer_platform_disabled");
  if (request.headers.has("origin") && isCrossSiteMutation(request))
    throw new Error("developer_origin_invalid");
  const credential = parseDeveloperCredential(request.headers.get("authorization"));
  const rate = await consumeOpenAiApplicationAdmission({
    identity: `developer-auth:${createHash("sha256").update(resolveAnonymousClientKey(request.headers)).digest("hex")}`,
    action: "developer_authentication",
    limit: 120,
    windowSeconds: 60,
  });
  if (!rate.allowed)
    throw new Error(
      rate.status === "limited" ? "developer_rate_limit" : "developer_rate_unavailable",
    );
  const db = developerDatabase();
  const result = await db
    .from("developer_billing_keys")
    .select("id,account_id,project_id,capabilities,secret_digest")
    .eq("id", credential.keyId)
    .eq("enabled", true)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .abortSignal(AbortSignal.timeout(10000))
    .maybeSingle();
  if (
    result.error ||
    !result.data ||
    !equal(result.data.secret_digest ?? "", digest("key", credential.token))
  )
    throw new Error("developer_unauthorized");
  const authenticatedRate = await consumeOpenAiApplicationAdmission({
    identity: `developer:${credential.keyId}`,
    action: "developer_ingress",
    limit: 120,
    windowSeconds: 60,
  });
  if (!authenticatedRate.allowed)
    throw new Error(
      authenticatedRate.status === "limited"
        ? "developer_rate_limit"
        : "developer_rate_unavailable",
    );
  const owner = await db
    .from("developer_account_owners")
    .select("owner_id")
    .eq("account_id", result.data.account_id)
    .abortSignal(AbortSignal.timeout(10000))
    .maybeSingle();
  if (owner.error || !owner.data) throw new Error("developer_unauthorized");
  const user = await readAccountIdentity(db, owner.data.owner_id);
  if (!user) throw new Error("developer_unauthorized");
  const [fence, banned] = await Promise.all([
    db.from("account_deletion_fences").select("user_id").eq("user_id", user.id).maybeSingle(),
    db.from("banned_users").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);
  if (fence.error || banned.error) throw new Error("developer_auth_unavailable");
  if (fence.data || banned.data) throw new Error("developer_unauthorized");
  await assertLockdownAllows(db, user.id, "agent");
  return { ...result.data, ownerId: user.id, db };
}
type DeveloperIdentity = Awaited<ReturnType<typeof authenticateDeveloper>>;
async function currentPricing(identity: DeveloperIdentity) {
  const account = await identity.db
    .from("developer_credit_accounts")
    .select("currency,funding_collection_rate")
    .eq("id", identity.account_id)
    .is("suspended_at", null)
    .maybeSingle();
  if (account.error || !account.data) throw new Error("developer_account_unavailable");
  const now = new Date().toISOString();
  const version = await identity.db
    .from("api_pricing_versions")
    .select("*")
    .eq("currency", account.data.currency)
    .eq("status", "approved")
    .lte("effective_at", now)
    .gt("expires_at", now)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (version.error || !version.data) throw new Error("developer_pricing_unavailable");
  return fundingAdjustedVersion(version.data, account.data);
}
async function preparePublicRequest(identity: DeveloperIdentity, kind: string, raw: unknown) {
  const references = developerFileReferences(kind, raw);
  const parsed = parseDeveloperInput(kind, references.body);
  if (!identity.capabilities.includes(parsed.capability))
    throw new Error("developer_scope_required");
  const files = await loadDeveloperFileContent(identity, parsed.body, references.ids);
  parsed.body = files.body;
  const version = await currentPricing(identity);
  const provider = getAiProviderConfig(parsed.capability).provider;
  const contracts = version.public_price_configuration?.contracts;
  const contract = Array.isArray(contracts)
    ? contracts.find(
        (entry: { publicModel: string; capability: string; provider: string }) =>
          entry.publicModel === parsed.publicModel &&
          entry.capability === parsed.capability &&
          entry.provider === provider,
      )
    : null;
  if (!contract || typeof contract.upstreamModel !== "string")
    throw new Error("developer_model_unavailable");
  // A reviewed model contract selects the deployment, never a client URL or upstream identifier.
  parsed.body.model = providerModelId(contract.upstreamModel, parsed.capability);
  const at = new Date();
  const registry = await identity.db
    .from("upstream_price_registry")
    .select("*")
    .in("id", pricingRegistryIds(version))
    .eq("provider", provider)
    .eq("upstream_model", parsed.body.model)
    .eq("currency", version.currency)
    .eq("active", true)
    .eq("verification_status", "approved")
    .lte("effective_at", at.toISOString())
    .gt("expires_at", at.toISOString())
    .order("version")
    .limit(257);
  if (registry.error || !registry.data || registry.data.length > 256)
    throw new Error("developer_pricing_unavailable");
  const prepared = prepareDeveloperQuote(
    { version, registry: registry.data },
    { provider, capability: parsed.capability, body: parsed.body },
    at,
  );
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ provider, capability: parsed.capability, body: parsed.body }))
    .digest("hex");
  return {
    ...parsed,
    version,
    prepared,
    fingerprint,
    fileBindings: files.bindings,
    fileExpiresAt: files.expiresAt,
  };
}
export async function developerQuote(identity: DeveloperIdentity, kind: string, input: unknown) {
  const value = await preparePublicRequest(identity, kind, input);
  const quote = {
    key: identity.id,
    version: value.version.id,
    fingerprint: value.fingerprint,
    maximumCharge: Number(value.prepared.quote.maximumReservedCharge),
    expiresAt: Math.min(Date.now() + 120000, value.fileExpiresAt ?? Infinity),
  };
  const payload = Buffer.from(JSON.stringify(quote)).toString("base64url");
  return {
    quoteToken: `${payload}.${digest("quote", payload)}`,
    pricingVersion: quote.version,
    currency: value.version.currency,
    maximumCharge: quote.maximumCharge,
    expiresAt: quote.expiresAt,
  };
}
export async function executeDeveloper(
  identity: DeveloperIdentity,
  kind: string,
  input: unknown,
  requestKey: string,
  quoteToken: string | null,
  signal?: AbortSignal,
) {
  developerRequestKey(requestKey);
  if (!quoteToken || quoteToken.length > 2048) throw new Error("developer_quote_required");
  const [payload, signature, extra] = quoteToken.split(".");
  if (extra !== undefined || !payload || !signature || !equal(signature, digest("quote", payload)))
    throw new Error("developer_quote_invalid");
  let quote;
  try {
    quote = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("developer_quote_invalid");
  }
  if (
    quote.key !== identity.id ||
    !Number.isSafeInteger(quote.expiresAt) ||
    quote.expiresAt <= Date.now() ||
    quote.expiresAt > Date.now() + 120000
  )
    throw new Error("developer_quote_expired");
  const parsed = await preparePublicRequest(identity, kind, input);
  if (
    quote.version !== parsed.version.id ||
    quote.fingerprint !== parsed.fingerprint ||
    quote.maximumCharge < Number(parsed.prepared.quote.maximumReservedCharge)
  )
    throw new Error("developer_quote_changed");
  const response = await withDeveloperBilling(
    {
      keyId: identity.id,
      requestKey,
      pricingVersion: quote.version,
      maximumCharge: quote.maximumCharge,
      requestFingerprint: quote.fingerprint,
      fileBindings: parsed.fileBindings,
    },
    () => {
      const call =
        kind === "responses"
          ? developerResponses
          : kind === "images"
            ? imageGenerations
            : embeddings;
      return call(parsed.body, { signal });
    },
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error("developer_provider_unavailable");
  }
  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export async function handleDeveloperApi(request: Request, operation: string) {
  try {
    const identity = await authenticateDeveloper(request);
    if (operation === "models") {
      const pricing = await currentPricing(identity);
      const contracts = pricing.public_price_configuration?.contracts;
      const models = Array.isArray(contracts)
        ? contracts
            .filter(
              (entry: { capability: string; provider: string }) =>
                identity.capabilities.includes(entry.capability) &&
                entry.provider ===
                  getAiProviderConfig(entry.capability as ProviderCapability).provider,
            )
            .map((entry: { publicModel: string; capability: string }) => ({
              id: entry.publicModel,
              capability: entry.capability,
            }))
        : [];
      return developerJson({ object: "list", data: models, pricingVersion: pricing.id });
    }
    if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json")
      throw new Error("developer_json_required");
    const body = await readBoundedJsonObject(request, 65536);
    if (operation === "quotes")
      return developerJson(await developerQuote(identity, String(body.operation), body.input));
    return await executeDeveloper(
      identity,
      operation,
      body,
      developerRequestKey(request.headers.get("idempotency-key")),
      request.headers.get("x-kova-quote"),
      request.signal,
    );
  } catch (error) {
    return developerFailure(error);
  }
}

export async function handleDeveloperConsole(request: Request) {
  if (request.method !== "GET" && isCrossSiteMutation(request))
    return developerJson({ error: "cross_site_request_blocked" }, 403);
  const caller = await requireVerifiedUser(request);
  if (caller instanceof Response) return caller;
  if (request.headers.get("x-kova-expected-user") !== caller.userId)
    return developerJson(
      {
        error: {
          code: "developer_principal_conflict",
          message: "Your signed-in account changed. Reload the developer console.",
        },
      },
      409,
    );
  const rate = await consumeApplicationRateLimit({
    identity: `user:${caller.userId}`,
    action: "developer_console",
    limit: 60,
    windowSeconds: 60,
  });
  if (!rate.allowed) return developerJson({ error: "developer_rate_limit" }, 429);
  const db = developerDatabase();
  try {
    if (request.method === "GET") {
      const params = new URL(request.url).searchParams;
      const limitsPage = Number(params.get("limitsPage") ?? 0);
      const usagePage = Number(params.get("usagePage") ?? 0);
      const summaryRequested = params.get("usageSummary") === "1";
      if (
        [limitsPage, usagePage].some(
          (page) => !Number.isSafeInteger(page) || page < 0 || page > 10000,
        )
      )
        throw new Error("developer_page_invalid");
      const accounts = await db
        .from("developer_account_owners")
        .select("account_id,name,created_at")
        .eq("owner_id", caller.userId)
        .order("created_at")
        .limit(10);
      if (accounts.error) throw new Error("developer_storage_unavailable");
      const ids = (accounts.data ?? []).map((row) => row.account_id);
      if (!ids.length)
        return developerJson({
          enabled: developerEnabled(),
          accounts: [],
          projects: [],
          keys: [],
          limits: [],
          usage: [],
          balances: [],
          limitsPage,
          limitsHasMore: false,
          usagePage,
          usageHasMore: false,
          ...(summaryRequested ? { summary: summarizeDeveloperUsage([]), summaryReadAt: new Date().toISOString() } : {}),
        });
      const usageAccount = params.get("usageAccount");
      const usageProject = params.get("usageProject");
      const usageKey = params.get("usageKey");
      const usageModel = params.get("usageModel");
      const usageService = params.get("usageService");
      const usageStatus = params.get("usageStatus");
      const dateBound = (key: string) => {
        const value = params.get(key);
        if (!value) return null;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
          throw new Error("developer_input_invalid");
        const date = new Date(value + "T00:00:00.000Z");
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
          throw new Error("developer_input_invalid");
        return date;
      };
      const from = dateBound("usageFrom");
      const through = dateBound("usageThrough");
      if (from && through && from > through) throw new Error("developer_input_invalid");
      if (summaryRequested && (!from || !through || +through - +from > 92 * 86400000))
        throw new Error("developer_summary_range_invalid");
      if (usageAccount && !ids.includes(developerUuid(usageAccount)))
        throw new Error("developer_owner_required");
      if (usageProject) developerUuid(usageProject);
      if (usageKey) developerUuid(usageKey);
      if (usageModel && !/^[a-zA-Z0-9._:-]{1,100}$/.test(usageModel))
        throw new Error("developer_input_invalid");
      if (usageService && !/^[a-zA-Z0-9_-]{1,80}$/.test(usageService))
        throw new Error("developer_input_invalid");
      if (
        usageStatus &&
        !["reserved", "dispatched", "settled", "uncertain", "reconciliation_required", "rejected"].includes(usageStatus)
      )
        throw new Error("developer_input_invalid");
      let usageQuery = db
        .from("developer_api_requests")
        .select(
          "id,account_id,project_id,api_key_id,public_model,capability,currency,settlement_state,maximum_reserved_charge,final_customer_charge,created_at,settled_at,authoritative_usage",
        )
        .in("account_id", ids);
      if (usageAccount) usageQuery = usageQuery.eq("account_id", usageAccount);
      if (usageProject) usageQuery = usageQuery.eq("project_id", usageProject);
      if (usageKey) usageQuery = usageQuery.eq("api_key_id", usageKey);
      if (usageModel) usageQuery = usageQuery.eq("public_model", usageModel);
      if (usageService) usageQuery = usageQuery.eq("capability", usageService);
      if (usageStatus) usageQuery = usageQuery.eq("settlement_state", usageStatus);
      if (from) usageQuery = usageQuery.gte("created_at", from.toISOString());
      if (through) {
        through.setUTCDate(through.getUTCDate() + 1);
        usageQuery = usageQuery.lt("created_at", through.toISOString());
      }
      if (summaryRequested) {
        // Fixed cutoff and stable ordering prevent new incoming requests from
        // moving the observed window. Settlement changes can still occur while
        // reading; the ledger remains the billing authority.
        const cutoff = new Date().toISOString();
        const batchSize = 250;
        const maximumRows = 5000;
        const history = [];
        const query = usageQuery
          .lte("created_at", cutoff)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false });
        for (let offset = 0; offset <= maximumRows; offset += batchSize) {
          const page = await query
            .range(offset, offset + batchSize - 1)
            .abortSignal(AbortSignal.timeout(10000));
          if (page.error || !page.data) throw new Error("developer_storage_unavailable");
          if (history.length + page.data.length > maximumRows)
            throw new Error("developer_summary_range_too_large");
          history.push(...page.data);
          if (page.data.length < batchSize)
            return developerJson({
              summary: summarizeDeveloperUsage(history),
              summaryReadAt: cutoff,
            });
        }
        throw new Error("developer_summary_range_too_large");
      }
      const rows = await Promise.all([
        db.from("developer_projects").select("id,account_id,name").in("account_id", ids).limit(100),
        db
          .from("developer_billing_keys")
          .select(
            "id,account_id,project_id,name,secret_suffix,enabled,expires_at,revoked_at,capabilities",
          )
          .in("account_id", ids)
          .is("revoked_at", null)
          .order("created_at", { ascending: false })
          .limit(1000),
        db
          .from("developer_billing_limits")
          .select("*")
          .in("account_id", ids)
          .order("account_id")
          .order("scope_type")
          .order("scope_id")
          .range(limitsPage * 100, limitsPage * 100 + 100),
        usageQuery
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(usagePage * 100, usagePage * 100 + 100),
        db
          .from("developer_credit_accounts")
          .select("id,organization_id,currency,available_amount,reserved_amount,suspended_at")
          .in("id", ids),
      ]);
      if (rows.some((row) => row.error)) throw new Error("developer_storage_unavailable");
      return developerJson({
        enabled: developerEnabled(),
        accounts: accounts.data,
        projects: rows[0].data,
        keys: rows[1].data,
        limits: rows[2].data?.slice(0, 100),
        limitsPage,
        limitsHasMore: (rows[2].data?.length ?? 0) > 100,
        usage: rows[3].data?.slice(0, 100).map(({ authoritative_usage, ...row }) => {
          const dimension = (name: string) => {
            const value = authoritative_usage?.[name];
            return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
              ? value
              : null;
          };
          return {
            ...row,
            input_tokens: dimension("input_tokens"),
            cached_input_tokens: dimension("cached_input_tokens"),
            image_input_tokens: dimension("image_input_tokens"),
            output_tokens: dimension("output_tokens"),
          };
        }),
        usagePage,
        usageHasMore: (rows[3].data?.length ?? 0) > 100,
        balances: rows[4].data,
      });
    }
    const body = await readBoundedJsonObject(request, 8192);
    const operation = String(body.operation);
    let input: Record<string, unknown>;
    let secret: string | undefined;
    if (operation === "create_account") {
      if (
        typeof body.name !== "string" ||
        !body.name.trim() ||
        body.name.length > 80 ||
        typeof body.currency !== "string" ||
        !/^[A-Z]{3}$/.test(body.currency)
      )
        throw new Error("developer_input_invalid");
      input = { name: body.name.trim(), currency: body.currency };
    } else {
      input = { accountId: developerUuid(body.accountId) };
      if (operation === "revoke_key") input.keyId = developerUuid(body.keyId);
      else if (operation === "set_limits")
        Object.assign(input, {
          scope: body.scope,
          scopeId: body.scopeId ? developerUuid(body.scopeId) : null,
          limits: parseDeveloperLimits(body.limits),
        });
      else if (operation === "issue_key") {
        if (
          typeof body.name !== "string" ||
          !body.name.trim() ||
          body.name.length > 80 ||
          !Array.isArray(body.scopes) ||
          !body.scopes.length ||
          body.scopes.length > DEVELOPER_SCOPES.length ||
          body.scopes.some((value) => !DEVELOPER_SCOPES.includes(String(value)))
        )
          throw new Error("developer_key_invalid");
        const keyId = crypto.randomUUID();
        secret = `kova_${keyId}_${randomBytes(32).toString("base64url")}`;
        Object.assign(input, {
          keyId,
          projectId: developerUuid(body.projectId),
          name: body.name.trim(),
          digest: digest("key", secret),
          suffix: secret.slice(-6),
          scopes: [...new Set(body.scopes)],
          expiresAt: new Date(Date.now() + 89 * 86400000).toISOString(),
          limits: parseDeveloperLimits(body.limits),
          rotateKeyId: body.rotateKeyId ? developerUuid(body.rotateKeyId) : null,
        });
      } else throw new Error("developer_operation_invalid");
    }
    const result = await db.rpc("manage_developer_workspace", {
      p_owner: caller.userId,
      p_operation: operation,
      p_input: input,
    });
    if (result.error) throw new Error("developer_change_unavailable");
    return developerJson({ ...result.data, ...(secret ? { secret } : {}) });
  } catch (error) {
    return developerFailure(error);
  }
}
