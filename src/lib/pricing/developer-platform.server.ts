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
  developerAnalysis,
  developerComputerUse,
  deleteDeveloperAnalysisContainer,
  developerModerations,
  developerTranscriptions,
  developerDecisions,
  embeddings,
  imageGenerations,
  imageEdits,
  getAiProviderConfig,
  providerModelId,
  type ProviderCapability,
} from "@/lib/ai/provider.server";
import { meterProviderRequest, withDeveloperBilling } from "./developer-billing.server";
import { prepareDeveloperQuote } from "./developer-metering.mjs";
import { pricingRegistryIds } from "./pricing-administration.mjs";
import { fundingAdjustedVersion } from "./developer-funding-allowance.mjs";
import { summarizeDeveloperUsage } from "./developer-usage-summary.mjs";
import { developerFileReferences } from "./developer-file-policy.mjs";
import { developerImageEditBytes } from "./developer-image-edit-policy.mjs";
import {
  SPEECH_MODEL,
  bindDeveloperSpeechVoice,
  runDeveloperSpeech,
} from "./developer-speech-policy.mjs";
import { TRANSCRIPTION_BODY_LIMIT } from "./developer-transcription-policy.mjs";
import { normalizeDeveloperOperation } from "./developer-api-aliases.mjs";
import { developerChatCompletion } from "./developer-chat-compat.mjs";
import { readDeveloperDecisionResponse } from "./developer-decisions-policy.mjs";
import { readDeveloperAnalysisResponse } from "./developer-analysis-policy.mjs";
import { readDeveloperComputerResponse } from "./developer-computer-policy.mjs";
import {
  BROWSER_MODEL,
  developerBrowserReceipt,
  developerBrowserTargets,
} from "./developer-browser-policy.mjs";
import {
  assertDeveloperBrowserAuthority,
  developerBrowserEnabled,
  runDeveloperBrowser,
} from "./developer-browser.server";
import {
  expandDeveloperAgentTurn,
  parseDeveloperAgentRequest,
  parseDeveloperAgentTurn,
} from "./developer-agent-policy.mjs";
import { expandDeveloperSkills, parseDeveloperSkillRequest } from "./developer-skill-policy.mjs";
import {
  developerConversationReference,
  expandDeveloperConversation,
  type ConversationBinding,
} from "./developer-conversation-policy.mjs";
import {
  batchChargeTicks,
  developerBatchCapability,
  developerBatchRequestKey,
  type BatchOperation,
} from "./developer-batch-policy.mjs";
import {
  loadDeveloperFileContent,
  readDeveloperFileRecords,
} from "./developer-file-content.server";
import {
  parseDeveloperFileSearch,
  searchDeveloperFileRecords,
} from "./developer-file-search-policy.mjs";
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
  const bodyCode = error instanceof Error && "code" in error ? error.code : null;
  if (bodyCode === "request_too_large")
    return developerJson(
      { error: { code: "developer_input_too_large", message: "request too large" } },
      413,
    );
  if (
    ["invalid_content_length", "invalid_utf8", "invalid_json", "invalid_request_body"].includes(
      String(bodyCode),
    )
  )
    return developerJson(
      { error: { code: "developer_input_invalid", message: "invalid request body" } },
      400,
    );
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
        : /not_found/.test(code)
          ? 404
          : /conflict|quote_expired|quote_changed|quota_exceeded/.test(code)
            ? 409
            : /invalid|required|too_large/.test(code)
              ? 400
              : /rate_limit/.test(code)
                ? 429
                : 503,
  );
}
function developerModerationEnabled() {
  if (runtimeEnv("KOVA_DEVELOPER_MODERATION_ENABLED") !== "true") return false;
  const config = getAiProviderConfig("moderation");
  return config.configured && config.capabilities?.includes("moderation") === true;
}
function developerTranscriptionEnabled() {
  if (
    runtimeEnv("KOVA_DEVELOPER_WORKSPACE_V2") !== "true" ||
    runtimeEnv("KOVA_DEVELOPER_TRANSCRIPTION_ENABLED") !== "true"
  )
    return false;
  const config = getAiProviderConfig("audio_transcription");
  return config.configured && config.capabilities?.includes("audio_transcription") === true;
}
function developerSpeechEnabled() {
  return (
    runtimeEnv("KOVA_DEVELOPER_WORKSPACE_V2") === "true" &&
    runtimeEnv("KOVA_DEVELOPER_SPEECH_ENABLED") === "true" &&
    Boolean(runtimeEnv("ELEVENLABS_API_KEY")) &&
    /^[A-Za-z0-9_-]{1,64}$/.test(runtimeEnv("KOVA_DEVELOPER_SPEECH_VOICE_ID") ?? "")
  );
}
function developerDecisionsEnabled() {
  if (
    runtimeEnv("KOVA_DEVELOPER_WORKSPACE_V2") !== "true" ||
    runtimeEnv("KOVA_DEVELOPER_DECISIONS_ENABLED") !== "true"
  )
    return false;
  const config = getAiProviderConfig("decisions");
  return config.configured && config.capabilities?.includes("decisions") === true;
}
function developerAnalysisEnabled() {
  if (
    runtimeEnv("KOVA_DEVELOPER_WORKSPACE_V2") !== "true" ||
    runtimeEnv("KOVA_DEVELOPER_ANALYSIS_ENABLED") !== "true"
  )
    return false;
  const config = getAiProviderConfig("file_analysis");
  return (
    config.configured &&
    config.provider === "openai" &&
    config.capabilities?.includes("file_analysis") === true
  );
}
function developerComputerEnabled() {
  if (
    runtimeEnv("KOVA_DEVELOPER_WORKSPACE_V2") !== "true" ||
    runtimeEnv("KOVA_DEVELOPER_COMPUTER_USE_ENABLED") !== "true"
  )
    return false;
  const config = getAiProviderConfig("computer_use");
  return (
    config.configured &&
    config.provider === "openai" &&
    config.capabilities?.includes("computer_use") === true
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
export type DeveloperIdentity = Omit<
  Awaited<ReturnType<typeof authenticateDeveloper>>,
  "secret_digest"
>;
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
function requireDeveloperAgents(identity: DeveloperIdentity) {
  if (!identity.capabilities.includes("chat")) throw new Error("developer_scope_required");
  if (
    runtimeEnv("KOVA_DEVELOPER_AGENT_SCHEMA_READY") !== "true" ||
    runtimeEnv("KOVA_DEVELOPER_AGENTS_ENABLED") !== "true"
  )
    throw new Error("developer_agent_unavailable");
}
async function agentResource(
  identity: DeveloperIdentity,
  operation: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
) {
  requireDeveloperAgents(identity);
  const result = await identity.db
    .rpc("manage_developer_agents_v1", {
      p_owner: identity.ownerId,
      p_key: identity.id,
      p_project: identity.project_id,
      p_operation: operation,
      p_input: input,
    })
    .abortSignal(
      signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    );
  if (result.error || !result.data) {
    const known = result.error?.message?.match(
      /^developer_(?:agent_not_found|agent_quota_exceeded|agent_conflict|agent_invalid|scope_required|owner_unavailable)$/,
    )?.[0];
    throw new Error(known ?? "developer_agent_unavailable");
  }
  return result.data;
}
export async function handleDeveloperAgentDefinitions(request: Request) {
  try {
    const identity = await authenticateDeveloper(request);
    requireDeveloperAgents(identity);
    const rate = await consumeApplicationRateLimit({
      identity: `developer:${identity.id}`,
      action: "developer_agent_definitions",
      limit: 30,
      windowSeconds: 60,
    });
    if (!rate.allowed) throw new Error("developer_rate_limit");
    if (
      request.method === "POST" &&
      request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json"
    )
      throw new Error("developer_json_required");
    const parsed = parseDeveloperAgentRequest(
      request.method,
      new URL(request.url).searchParams,
      request.method === "POST"
        ? await readBoundedJsonObject(request, 16384, request.signal)
        : undefined,
    );
    const result = await agentResource(identity, parsed.operation, parsed.input, request.signal);
    return developerJson(result, parsed.operation === "create" ? 201 : 200);
  } catch (error) {
    return developerFailure(error);
  }
}
function requireDeveloperSkills(identity: DeveloperIdentity) {
  if (!identity.capabilities.includes("chat")) throw new Error("developer_scope_required");
  if (
    runtimeEnv("KOVA_DEVELOPER_SKILL_SCHEMA_READY") !== "true" ||
    runtimeEnv("KOVA_DEVELOPER_SKILLS_ENABLED") !== "true"
  )
    throw new Error("developer_skill_unavailable");
}
async function skillResource(
  identity: DeveloperIdentity,
  operation: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
) {
  requireDeveloperSkills(identity);
  const result = await identity.db
    .rpc("manage_developer_skills_v1", {
      p_owner: identity.ownerId,
      p_key: identity.id,
      p_project: identity.project_id,
      p_operation: operation,
      p_input: input,
    })
    .abortSignal(
      signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    );
  if (result.error || !result.data) {
    const known = result.error?.message?.match(
      /^developer_(?:skill_not_found|skill_quota_exceeded|skill_conflict|skill_invalid|scope_required|owner_unavailable)$/,
    )?.[0];
    throw new Error(known ?? "developer_skill_unavailable");
  }
  return result.data;
}
export async function handleDeveloperSkills(request: Request) {
  try {
    const identity = await authenticateDeveloper(request);
    requireDeveloperSkills(identity);
    const rate = await consumeApplicationRateLimit({
      identity: `developer:${identity.id}`,
      action: "developer_skill_definitions",
      limit: 30,
      windowSeconds: 60,
    });
    if (!rate.allowed) throw new Error("developer_rate_limit");
    if (
      request.method === "POST" &&
      request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json"
    )
      throw new Error("developer_json_required");
    const parsed = parseDeveloperSkillRequest(
      request.method,
      new URL(request.url).searchParams,
      request.method === "POST"
        ? await readBoundedJsonObject(request, 16384, request.signal)
        : undefined,
    );
    const result = await skillResource(identity, parsed.operation, parsed.input, request.signal);
    return developerJson(result, parsed.operation === "create" ? 201 : 200);
  } catch (error) {
    return developerFailure(error);
  }
}
async function preparePublicRequest(identity: DeveloperIdentity, kind: string, raw: unknown) {
  let agentBinding: { id: string; version: number; createdAt: string } | null = null;
  let skillBinding: string | null = null;
  if (kind === "agent-turns") {
    requireDeveloperAgents(identity);
    const turn = parseDeveloperAgentTurn(raw);
    const saved = await agentResource(identity, "get", {
      id: turn.agent_id,
      version: turn.version,
    });
    if (typeof saved.created_at !== "string" || !Number.isFinite(Date.parse(saved.created_at)))
      throw new Error("developer_agent_unavailable");
    agentBinding = { id: turn.agent_id, version: turn.version, createdAt: saved.created_at };
    const expanded = expandDeveloperAgentTurn(turn, saved);
    if (turn.skills?.length) {
      requireDeveloperSkills(identity);
      const rows = await Promise.all(
        turn.skills.map((ref) =>
          skillResource(identity, "get", { id: ref.id, version: ref.version }),
        ),
      );
      const result = expandDeveloperSkills(String(expanded.instructions), turn.skills, rows);
      expanded.instructions = result.instructions;
      skillBinding = createHash("sha256").update(JSON.stringify(result.bindings)).digest("hex");
    }
    raw = expanded;
  }
  let conversationBinding: ConversationBinding | null = null;
  let conversationExpiresAt: number | null = null;
  const conversation = developerConversationReference(
    kind === "agent-turns" ? "responses" : kind,
    raw,
  );
  raw = conversation.body;
  if (conversation.reference) {
    if (!identity.capabilities.includes("chat") && !identity.capabilities.includes("streaming"))
      throw new Error("developer_scope_required");
    if (
      runtimeEnv("KOVA_DEVELOPER_CONVERSATION_SCHEMA_READY") !== "true" ||
      runtimeEnv("KOVA_DEVELOPER_CONVERSATIONS_ENABLED") !== "true"
    )
      throw new Error("developer_conversation_unavailable");
    const result = await identity.db
      .rpc("manage_developer_conversations_v1", {
        p_owner: identity.ownerId,
        p_key: identity.id,
        p_project: identity.project_id,
        p_operation: "get",
        p_input: { id: conversation.reference.id },
      })
      .abortSignal(AbortSignal.timeout(10000));
    if (result.error || !result.data) {
      if (result.error?.message === "developer_conversation_not_found")
        throw new Error("developer_conversation_not_found");
      throw new Error("developer_conversation_unavailable");
    }
    const expanded = expandDeveloperConversation(
      conversation.reference,
      conversation.body,
      result.data,
      identity.project_id,
    );
    raw = expanded.body;
    conversationBinding = expanded.binding;
    conversationExpiresAt = expanded.expiresAt;
  }
  const normalized = normalizeDeveloperOperation(kind === "agent-turns" ? "responses" : kind, raw);
  const references = developerFileReferences(normalized.operation, normalized.input);
  const parsed = parseDeveloperInput(normalized.operation, references.body);
  if (!identity.capabilities.includes(parsed.capability))
    throw new Error("developer_scope_required");
  const files = await loadDeveloperFileContent(
    identity,
    parsed.body,
    references.ids,
    normalized.operation,
  );
  parsed.body = files.body;
  const version = await currentPricing(identity);
  const providerConfig = ["cloud_browser", "audio_speech"].includes(parsed.capability)
    ? null
    : getAiProviderConfig(parsed.capability as ProviderCapability);
  const provider =
    parsed.capability === "audio_speech"
      ? "elevenlabs"
      : (providerConfig?.provider ?? "browserbase");
  if (parsed.capability === "audio_speech") {
    if (!developerSpeechEnabled()) throw new Error("developer_speech_unavailable");
    parsed.body = bindDeveloperSpeechVoice(
      parsed.body,
      runtimeEnv("KOVA_DEVELOPER_SPEECH_VOICE_ID"),
    );
  }
  if (parsed.capability === "cloud_browser")
    for (const target of developerBrowserTargets(parsed.body))
      await assertDeveloperBrowserAuthority(identity, target);
  if (
    parsed.body.image !== undefined &&
    (runtimeEnv("KOVA_DEVELOPER_IMAGE_EDITS_ENABLED") !== "true" ||
      runtimeEnv("KOVA_IMAGE_EDITS_ENABLED") === "false" ||
      provider !== "openai")
  )
    throw new Error("developer_image_edits_unavailable");
  if (
    parsed.capability === "moderation" &&
    (!developerModerationEnabled() || provider !== "openai")
  )
    throw new Error("developer_moderation_unavailable");
  if (parsed.capability === "decisions" && (!developerDecisionsEnabled() || provider !== "openai"))
    throw new Error("developer_decision_unavailable");
  if (parsed.capability === "audio_transcription" && !developerTranscriptionEnabled())
    throw new Error("developer_transcription_unavailable");
  if (parsed.capability === "computer_use" && !developerComputerEnabled())
    throw new Error("developer_computer_unavailable");
  if (parsed.capability === "file_analysis" && !developerAnalysisEnabled())
    throw new Error("developer_analysis_unavailable");
  if (
    parsed.capability !== "file_analysis" &&
    parsed.body.max_tool_calls !== undefined &&
    (runtimeEnv("KOVA_DEVELOPER_WEB_SEARCH_ENABLED") !== "true" ||
      provider !== "openai" ||
      !providerConfig?.capabilities?.includes("web_search"))
  )
    throw new Error("developer_web_search_unavailable");
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
  parsed.body.model =
    parsed.capability === "cloud_browser"
      ? BROWSER_MODEL
      : parsed.capability === "audio_speech"
        ? SPEECH_MODEL
        : providerModelId(contract.upstreamModel, parsed.capability);
  if (parsed.capability === "audio_speech" && contract.upstreamModel !== SPEECH_MODEL)
    throw new Error("developer_speech_unavailable");
  if (parsed.capability === "cloud_browser" && contract.upstreamModel !== BROWSER_MODEL)
    throw new Error("developer_browser_unavailable");
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
    operation: normalized.operation,
    agentBinding,
    skillBinding,
    conversationBinding,
    conversationExpiresAt,
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
    operation: kind,
    agentBinding: value.agentBinding,
    skillBinding: value.skillBinding,
    conversationBinding: value.conversationBinding,
    maximumCharge: Number(value.prepared.quote.maximumReservedCharge),
    expiresAt: Math.min(
      Date.now() + 120000,
      value.fileExpiresAt ?? Infinity,
      value.conversationExpiresAt ?? Infinity,
    ),
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
type PublicQuote = {
  key: string;
  version: string;
  fingerprint: string;
  operation: string;
  agentBinding?: unknown;
  skillBinding?: string | null;
  conversationBinding?: ConversationBinding | null;
  maximumCharge: number;
  expiresAt: number;
};
function readDeveloperQuote(identity: DeveloperIdentity, quoteToken: string | null): PublicQuote {
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
  if (
    typeof quote.version !== "string" ||
    typeof quote.fingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(quote.fingerprint) ||
    !Number.isFinite(quote.maximumCharge) ||
    quote.maximumCharge <= 0
  )
    throw new Error("developer_quote_invalid");
  return quote;
}
function checkDeveloperQuote(
  quote: PublicQuote,
  kind: string,
  parsed: Awaited<ReturnType<typeof preparePublicRequest>>,
) {
  if (
    quote.operation !== kind ||
    JSON.stringify(quote.agentBinding ?? null) !== JSON.stringify(parsed.agentBinding) ||
    (quote.skillBinding ?? null) !== parsed.skillBinding ||
    JSON.stringify(quote.conversationBinding ?? null) !==
      JSON.stringify(parsed.conversationBinding) ||
    quote.version !== parsed.version.id ||
    quote.fingerprint !== parsed.fingerprint ||
    quote.maximumCharge < Number(parsed.prepared.quote.maximumReservedCharge)
  )
    throw new Error("developer_quote_changed");
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
  const quote = readDeveloperQuote(identity, quoteToken);
  const parsed = await preparePublicRequest(identity, kind, input);
  checkDeveloperQuote(quote, kind, parsed);
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
      if (kind === "images" && parsed.body.image !== undefined) {
        const { image, ...body } = parsed.body;
        return imageEdits(
          body,
          { image: { bytes: developerImageEditBytes(image), contentType: "image/png" } },
          { signal },
        );
      }
      if (kind === "browser")
        return meterProviderRequest({
          provider: "browserbase",
          capability: "cloud_browser",
          body: parsed.body,
          signal,
          send: () => runDeveloperBrowser(identity, parsed.body, signal),
        });
      if (kind === "computer-use") return developerComputerUse(parsed.body, { signal });
      if (kind === "analysis") return developerAnalysis(parsed.body, { signal });
      if (kind === "audio/speech")
        return meterProviderRequest({
          provider: "elevenlabs",
          capability: "audio_speech",
          body: parsed.body,
          signal,
          send: () =>
            runDeveloperSpeech(parsed.body, {
              apiKey: runtimeEnv("ELEVENLABS_API_KEY"),
              approvedVoice: runtimeEnv("KOVA_DEVELOPER_SPEECH_VOICE_ID"),
              signal: AbortSignal.any([AbortSignal.timeout(60000), ...(signal ? [signal] : [])]),
            }),
        });
      if (kind === "audio/transcriptions") return developerTranscriptions(parsed.body, { signal });
      const call =
        parsed.operation === "responses"
          ? developerResponses
          : kind === "images"
            ? imageGenerations
            : kind === "moderations"
              ? developerModerations
              : kind === "decisions"
                ? developerDecisions
                : embeddings;
      return call(parsed.body, { signal });
    },
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error("developer_provider_unavailable");
  }
  if (kind === "audio/transcriptions" || kind === "audio/speech") {
    const receipt = await response.json();
    return developerJson({ ...receipt, model: parsed.publicModel });
  }
  if (kind === "browser") {
    const receipt = await response.json();
    if (!developerBrowserReceipt(receipt) || !receipt.result)
      throw new Error("developer_browser_unavailable");
    return developerJson({ ...receipt.result, model: parsed.publicModel, usage: receipt.usage });
  }
  if (kind === "computer-use")
    return developerJson(
      await readDeveloperComputerResponse(
        response,
        parsed.body,
        parsed.prepared.contract.expectedResponseModels,
        parsed.publicModel,
      ),
    );
  if (kind === "analysis")
    return developerJson(
      await readDeveloperAnalysisResponse(
        response,
        parsed.prepared.contract.expectedResponseModels,
        parsed.publicModel,
        deleteDeveloperAnalysisContainer,
      ),
    );
  if (kind === "decisions")
    return developerJson(
      await readDeveloperDecisionResponse(
        response,
        parsed.body.questions as Record<string, unknown>[],
        parsed.prepared.contract.expectedResponseModels,
        parsed.publicModel,
      ),
    );
  if (kind === "chat/completions")
    return developerChatCompletion(response, {
      publicModel: parsed.publicModel,
      expectedModels: parsed.prepared.contract.expectedResponseModels,
      stream: parsed.body.stream === true,
    });
  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

type BatchAuthorization = {
  operation: BatchOperation;
  agentBinding: unknown;
  skillBinding: string | null;
  conversationBinding?: ConversationBinding | null;
  runAt: number | null;
  batch: string;
  item: string;
  key: string;
  project: string;
  currency: string;
  version: string;
  fingerprint: string;
  maximumCharge: number;
  expiresAt: number;
};
export async function authorizeDeveloperBatchItem(
  identity: DeveloperIdentity,
  batch: string,
  item: {
    id: string;
    operation: BatchOperation;
    input: Record<string, unknown>;
    quote_token: string;
    run_at?: string;
  },
  currency: string,
  expiresAt: number,
) {
  const quote = readDeveloperQuote(identity, item.quote_token);
  const parsed = await preparePublicRequest(identity, item.operation, item.input);
  checkDeveloperQuote(quote, item.operation, parsed);
  if (
    parsed.capability !== developerBatchCapability(item.operation) ||
    (parsed.capability === "chat" &&
      (parsed.body.stream !== false || Number(parsed.body.max_output_tokens) > 2048)) ||
    parsed.fileBindings.length !== 0 ||
    (parsed.conversationBinding !== null && item.operation !== "agent-turns") ||
    currency !== parsed.version.currency ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Date.now() ||
    expiresAt > Date.now() + 86400000
  )
    throw new Error("developer_batch_invalid");
  const runAt = item.run_at === undefined ? null : Date.parse(item.run_at);
  const authorityExpiresAt = Math.min(expiresAt, parsed.conversationExpiresAt ?? Infinity);
  if (
    authorityExpiresAt <= Date.now() ||
    (runAt !== null &&
      (!Number.isSafeInteger(runAt) || runAt <= Date.now() || runAt >= authorityExpiresAt))
  )
    throw new Error("developer_batch_invalid");
  const authorization: BatchAuthorization = {
    operation: item.operation,
    agentBinding: parsed.agentBinding,
    skillBinding: parsed.skillBinding,
    conversationBinding: parsed.conversationBinding,
    runAt,
    batch,
    item: item.id,
    key: identity.id,
    project: identity.project_id,
    currency,
    version: quote.version,
    fingerprint: quote.fingerprint,
    maximumCharge: quote.maximumCharge,
    expiresAt: authorityExpiresAt,
  };
  const payload = Buffer.from(JSON.stringify(authorization)).toString("base64url");
  return {
    id: item.id,
    operation_kind: item.operation,
    input: item.input,
    authorization: payload + "." + digest("batch-authorization-v1", payload),
    maximum_ticks: batchChargeTicks(quote.maximumCharge),
    ...(item.run_at === undefined ? {} : { run_at: item.run_at }),
    request_group: createHash("sha256")
      .update(developerBatchRequestKey(batch, item.id))
      .digest("hex"),
  };
}
export async function executeAuthorizedBatchItem(
  identity: DeveloperIdentity,
  batch: string,
  item: string,
  input: Record<string, unknown>,
  token: string,
  currency: string,
  maximumTicks: number,
  operation: string,
  runAt: string | null,
  signal?: AbortSignal,
) {
  if (typeof token !== "string" || token.length > 2048) throw new Error("developer_batch_invalid");
  const [payload, signature, extra] = token.split(".");
  if (
    extra !== undefined ||
    !payload ||
    !signature ||
    !equal(signature, digest("batch-authorization-v1", payload))
  )
    throw new Error("developer_batch_invalid");
  const authorization = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as BatchAuthorization;
  developerBatchCapability(operation);
  if (
    authorization.operation !== operation ||
    authorization.batch !== batch ||
    authorization.item !== item ||
    authorization.key !== identity.id ||
    authorization.project !== identity.project_id ||
    authorization.currency !== currency ||
    (authorization.runAt ?? null) !== (runAt === null ? null : Date.parse(runAt)) ||
    (runAt !== null && Date.parse(runAt) > Date.now()) ||
    batchChargeTicks(authorization.maximumCharge) !== maximumTicks ||
    !Number.isSafeInteger(authorization.expiresAt) ||
    authorization.expiresAt <= Date.now() ||
    authorization.expiresAt > Date.now() + 86400000
  )
    throw new Error("developer_batch_invalid");
  const quote: PublicQuote = {
    key: identity.id,
    version: authorization.version,
    fingerprint: authorization.fingerprint,
    operation: authorization.operation,
    agentBinding: authorization.agentBinding,
    skillBinding: authorization.skillBinding,
    conversationBinding: authorization.conversationBinding,
    maximumCharge: authorization.maximumCharge,
    expiresAt: Math.min(Date.now() + 120000, authorization.expiresAt),
  };
  const signed = Buffer.from(JSON.stringify(quote)).toString("base64url");
  return executeDeveloper(
    identity,
    authorization.operation,
    input,
    developerBatchRequestKey(batch, item),
    signed + "." + digest("quote", signed),
    signal,
  );
}

const publicUsage = (row: Record<string, unknown>) => {
  const { authoritative_usage, ...rest } = row;
  const usage =
    authoritative_usage && typeof authoritative_usage === "object"
      ? (authoritative_usage as Record<string, unknown>)
      : {};
  const dimension = (name: string) => {
    const value = usage[name];
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  return {
    ...rest,
    input_tokens: dimension("input_tokens") ?? dimension("decision_input_tokens"),
    cached_input_tokens: dimension("cached_input_tokens"),
    image_input_tokens: dimension("image_input_tokens"),
    output_tokens: dimension("output_tokens"),
    web_search_calls: dimension("web_search_calls"),
    moderation_requests: dimension("moderation_requests"),
    transcription_seconds:
      typeof usage.transcription_seconds === "number" &&
      Number.isFinite(usage.transcription_seconds) &&
      usage.transcription_seconds > 0
        ? usage.transcription_seconds
        : null,
    speech_character_credits: dimension("speech_character_credits"),
    container_1g_sessions: dimension("container_1g_sessions"),
    browser_sessions_60s: dimension("browser_sessions_60s"),
  };
};
export async function developerKeyUsage(identity: DeveloperIdentity, request: Request) {
  const params = new URL(request.url).searchParams;
  const allowed = new Set(["limit", "offset", "id"]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1)
      throw new Error("developer_input_invalid");
  }
  const number = (key: string, fallback: number, minimum: number, maximum: number) => {
    const value = params.get(key);
    if (value === null) return fallback;
    if (!/^(0|[1-9][0-9]{0,4})$/.test(value)) throw new Error("developer_input_invalid");
    const parsed = Number(value);
    if (parsed < minimum || parsed > maximum) throw new Error("developer_input_invalid");
    return parsed;
  };
  const id = params.has("id") ? developerUuid(params.get("id")) : null;
  if (id && (params.has("limit") || params.has("offset")))
    throw new Error("developer_input_invalid");
  const limit = number("limit", 25, 1, 100);
  const offset = number("offset", 0, 0, 10000);
  // A bearer key may inspect only its own activity, never sibling keys or
  // organization-wide billing records. The owner console is a separate boundary.
  const query = identity.db
    .from("developer_api_requests")
    .select(
      "id,public_model,capability,currency,settlement_state,maximum_reserved_charge,final_customer_charge,created_at,settled_at,authoritative_usage",
    )
    .eq("account_id", identity.account_id)
    .eq("project_id", identity.project_id)
    .eq("api_key_id", identity.id);
  if (id) {
    const result = await query.eq("id", id).range(0, 0).abortSignal(AbortSignal.timeout(10000));
    if (result.error || !result.data) throw new Error("developer_storage_unavailable");
    if (result.data.length !== 1)
      return developerJson(
        { error: { code: "developer_request_not_found", message: "developer request not found" } },
        404,
      );
    return developerJson({
      object: "usage",
      data: publicUsage(result.data[0]),
      amount_unit: "currency_minor_unit",
    });
  }
  const result = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit)
    .abortSignal(AbortSignal.timeout(10000));
  if (result.error || !result.data) throw new Error("developer_storage_unavailable");
  const hasMore = result.data.length > limit;
  return developerJson({
    object: "list",
    data: result.data.slice(0, limit).map(publicUsage),
    has_more: hasMore,
    next_offset: hasMore && offset + limit <= 10000 ? offset + limit : null,
    amount_unit: "currency_minor_unit",
  });
}
export async function developerModels(identity: DeveloperIdentity, request: Request) {
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) {
    if (key !== "id" || params.getAll(key).length !== 1) throw new Error("developer_input_invalid");
  }
  const id = params.get("id");
  if (
    id !== null &&
    (id.length < 2 || id.length > 80 || !/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/.test(id))
  )
    throw new Error("developer_model_invalid");
  const pricing = await currentPricing(identity);
  const contracts = pricing.public_price_configuration?.contracts;
  const models = Array.isArray(contracts)
    ? contracts
        .filter(
          (entry: { publicModel: string; capability: string; provider: string }) =>
            (id === null || entry.publicModel === id) &&
            identity.capabilities.includes(entry.capability) &&
            (entry.capability !== "moderation" || developerModerationEnabled()) &&
            (entry.capability !== "audio_transcription" || developerTranscriptionEnabled()) &&
            (entry.capability !== "decisions" || developerDecisionsEnabled()) &&
            (entry.capability !== "file_analysis" || developerAnalysisEnabled()) &&
            (entry.capability !== "computer_use" || developerComputerEnabled()) &&
            (entry.capability === "cloud_browser"
              ? developerBrowserEnabled() && entry.provider === "browserbase"
              : entry.capability === "audio_speech"
                ? developerSpeechEnabled() && entry.provider === "elevenlabs"
                : entry.provider ===
                  getAiProviderConfig(entry.capability as ProviderCapability).provider),
        )
        .map(
          (entry: {
            publicModel: string;
            capability: string;
            allowedReasoningEfforts?: string[];
            maximumInlineImageTokens?: number;
            maximumImageEditInputTokens?: number;
            meter?: string;
            provider: string;
          }) => ({
            id: entry.publicModel,
            capability: entry.capability,
            reasoning_efforts: entry.allowedReasoningEfforts ?? [],
            web_search:
              entry.meter === "responses_search" &&
              entry.provider === "openai" &&
              runtimeEnv("KOVA_DEVELOPER_WEB_SEARCH_ENABLED") === "true" &&
              getAiProviderConfig("chat").capabilities?.includes("web_search") === true,
            inline_image_input:
              Number.isSafeInteger(entry.maximumInlineImageTokens) &&
              Number(entry.maximumInlineImageTokens) > 0,
            image_edits:
              entry.capability === "image_generation" &&
              entry.provider === "openai" &&
              Number.isSafeInteger(entry.maximumImageEditInputTokens) &&
              Number(entry.maximumImageEditInputTokens) > 0 &&
              runtimeEnv("KOVA_DEVELOPER_IMAGE_EDITS_ENABLED") === "true" &&
              runtimeEnv("KOVA_IMAGE_EDITS_ENABLED") !== "false",
          }),
        )
    : [];
  if (id !== null && models.length === 0)
    return developerJson(
      { error: { code: "developer_model_not_found", message: "developer model not found" } },
      404,
    );
  return developerJson({ object: "list", data: models, pricingVersion: pricing.id });
}
export async function handleDeveloperApi(request: Request, operation: string) {
  try {
    const identity = await authenticateDeveloper(request);
    if (operation === "usage") return await developerKeyUsage(identity, request);
    if (operation === "models") return await developerModels(identity, request);
    if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json")
      throw new Error("developer_json_required");
    const limit =
      operation === "quotes" || operation === "audio/transcriptions"
        ? TRANSCRIPTION_BODY_LIMIT
        : 65536;
    const body = await readBoundedJsonObject(request, limit, request.signal);
    if (
      operation === "quotes" &&
      body.operation !== "audio/transcriptions" &&
      Buffer.byteLength(JSON.stringify(body)) > 65536
    )
      throw new Error("developer_input_too_large");
    if (operation === "file_search") {
      if (!identity.capabilities.includes("files")) throw new Error("developer_scope_required");
      if (runtimeEnv("KOVA_DEVELOPER_FILE_SEARCH_ENABLED") !== "true")
        throw new Error("developer_file_search_unavailable");
      const input = parseDeveloperFileSearch(body);
      const rate = await consumeApplicationRateLimit({
        identity: `developer:${identity.id}`,
        action: "developer_file_search",
        limit: 30,
        windowSeconds: 60,
      });
      if (!rate.allowed) throw new Error("developer_rate_limit");
      const files = await readDeveloperFileRecords(identity, input.fileIds);
      return developerJson(searchDeveloperFileRecords(input, files));
    }
    if (operation === "quotes") {
      if (
        typeof body.operation !== "string" ||
        Object.keys(body).length !== 2 ||
        !Object.hasOwn(body, "input")
      )
        throw new Error("developer_input_invalid");
      return developerJson(await developerQuote(identity, body.operation, body.input));
    }
    const requestKey = developerRequestKey(request.headers.get("idempotency-key"));
    if (requestKey.startsWith("batch:")) throw new Error("developer_idempotency_key_invalid");
    return await executeDeveloper(
      identity,
      operation,
      body,
      requestKey,
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
  const workspaceV2 = runtimeEnv("KOVA_DEVELOPER_WORKSPACE_V2") === "true";
  try {
    if (request.method === "GET") {
      const params = new URL(request.url).searchParams;
      if (params.has("creditWallet")) {
        if (runtimeEnv("KOVA_DEVELOPER_CREDIT_LOTS_V2") !== "true")
          return developerJson({ enabled: false });
        const accountId = developerUuid(params.get("creditWallet"));
        const page = Number(params.get("creditPage") ?? 0);
        if (!Number.isSafeInteger(page) || page < 0 || page > 4000)
          throw new Error("developer_page_invalid");
        const wallet = await db
          .rpc("developer_credit_wallet_status_v2", {
            p_owner: caller.userId,
            p_account: accountId,
            p_offset: page * 25,
          })
          .abortSignal(AbortSignal.timeout(10000));
        if (wallet.error?.code === "42501") throw new Error("developer_owner_required");
        if (wallet.error) throw new Error("developer_storage_unavailable");
        return developerJson({ enabled: true, wallet: wallet.data, page });
      }
      const limitsPage = Number(params.get("limitsPage") ?? 0);
      const usagePage = Number(params.get("usagePage") ?? 0);
      const summaryRequested = params.get("usageSummary") === "1";
      const exportRequested = params.get("usageExport") === "1";
      if (summaryRequested && exportRequested) throw new Error("developer_input_invalid");
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
      let consumerCreditSharing = false;
      if (workspaceV2) {
        const preference = await db
          .from("developer_credit_sharing_preferences")
          .select("allow_consumer_usage")
          .eq("owner_id", caller.userId)
          .maybeSingle();
        if (preference.error) throw new Error("developer_storage_unavailable");
        consumerCreditSharing = preference.data?.allow_consumer_usage === true;
      }
      if (!ids.length)
        return developerJson({
          enabled: developerEnabled(),
          workspaceV2,
          moderationEnabled: developerModerationEnabled(),
          transcriptionEnabled: developerTranscriptionEnabled(),
          speechEnabled: developerSpeechEnabled(),
          decisionsEnabled: developerDecisionsEnabled(),
          analysisEnabled: developerAnalysisEnabled(),
          computerEnabled: developerComputerEnabled(),
          browserEnabled: developerBrowserEnabled(),
          consumerCreditSharing,
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
          ...(summaryRequested
            ? { summary: summarizeDeveloperUsage([]), summaryReadAt: new Date().toISOString() }
            : {}),
          ...(exportRequested ? { exportRows: [], exportReadAt: new Date().toISOString() } : {}),
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
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("developer_input_invalid");
        const date = new Date(value + "T00:00:00.000Z");
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
          throw new Error("developer_input_invalid");
        return date;
      };
      const from = dateBound("usageFrom");
      const through = dateBound("usageThrough");
      if (from && through && from > through) throw new Error("developer_input_invalid");
      if (
        (summaryRequested || exportRequested) &&
        (!from || !through || +through - +from > 92 * 86400000)
      )
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
        ![
          "reserved",
          "dispatched",
          "settled",
          "uncertain",
          "reconciliation_required",
          "rejected",
        ].includes(usageStatus)
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
      if (summaryRequested || exportRequested) {
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
          request.signal.throwIfAborted();
          const page = await query
            .range(offset, offset + batchSize - 1)
            .abortSignal(AbortSignal.timeout(10000));
          if (page.error || !page.data) throw new Error("developer_storage_unavailable");
          if (history.length + page.data.length > maximumRows)
            throw new Error("developer_summary_range_too_large");
          history.push(...page.data);
          if (page.data.length < batchSize)
            return developerJson(
              exportRequested
                ? {
                    exportRows: history.map(publicUsage),
                    exportReadAt: cutoff,
                  }
                : {
                    summary: summarizeDeveloperUsage(history),
                    summaryReadAt: cutoff,
                  },
            );
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
        workspaceV2,
        moderationEnabled: developerModerationEnabled(),
        transcriptionEnabled: developerTranscriptionEnabled(),
        speechEnabled: developerSpeechEnabled(),
        decisionsEnabled: developerDecisionsEnabled(),
        analysisEnabled: developerAnalysisEnabled(),
        computerEnabled: developerComputerEnabled(),
        browserEnabled: developerBrowserEnabled(),
        consumerCreditSharing,
        accounts: accounts.data,
        projects: rows[0].data,
        keys: rows[1].data,
        limits: rows[2].data?.slice(0, 100),
        limitsPage,
        limitsHasMore: (rows[2].data?.length ?? 0) > 100,
        usage: rows[3].data?.slice(0, 100).map(publicUsage),
        usagePage,
        usageHasMore: (rows[3].data?.length ?? 0) > 100,
        balances: rows[4].data,
      });
    }
    const body = await readBoundedJsonObject(request, 8192);
    const operation = String(body.operation);
    if (operation === "refresh_credit_wallet") {
      if (runtimeEnv("KOVA_DEVELOPER_CREDIT_LOTS_V2") !== "true")
        throw new Error("developer_workspace_upgrade_unavailable");
      const wallet = await db
        .rpc("developer_refresh_wallet_v2", {
          p_owner: caller.userId,
          p_account: developerUuid(body.accountId),
        })
        .abortSignal(AbortSignal.timeout(10000));
      if (wallet.error?.code === "42501") throw new Error("developer_owner_required");
      if (wallet.error?.message === "developer_credit_legacy_reconciliation_required")
        throw new Error("developer_credit_legacy_reconciliation_required");
      if (wallet.error) throw new Error("developer_storage_unavailable");
      return developerJson({ enabled: true, wallet: wallet.data, page: 0 });
    }
    let input: Record<string, unknown>;
    let secret: string | undefined;
    if (
      ["ensure_workspace", "create_project", "rename_project", "set_credit_sharing"].includes(
        operation,
      )
    ) {
      if (!workspaceV2) throw new Error("developer_workspace_upgrade_unavailable");
      if (operation === "set_credit_sharing" && typeof body.enabled !== "boolean")
        throw new Error("developer_input_invalid");
      const input =
        operation === "ensure_workspace"
          ? {}
          : operation === "set_credit_sharing"
            ? { enabled: body.enabled }
            : {
                accountId: developerUuid(body.accountId),
                projectId: developerUuid(body.projectId),
                name:
                  typeof body.name === "string" && body.name.trim() && body.name.length <= 80
                    ? body.name.trim()
                    : null,
              };
      if ("name" in input && !input.name) throw new Error("developer_input_invalid");
      const result = await db.rpc("manage_developer_workspace_v2", {
        p_owner: caller.userId,
        p_operation: operation,
        p_input: input,
      });
      if (result.error) {
        if (result.error.code === "42501") throw new Error("developer_owner_required");
        if (result.error.message === "developer_project_conflict")
          throw new Error("developer_project_conflict");
        throw new Error("developer_change_unavailable");
      }
      return developerJson(result.data);
    }
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
          body.scopes.some(
            (value) => typeof value !== "string" || !DEVELOPER_SCOPES.includes(value),
          ) ||
          new Set(body.scopes).size !== body.scopes.length ||
          (body.scopes.includes("moderation") && !developerModerationEnabled()) ||
          (body.scopes.includes("audio_transcription") && !developerTranscriptionEnabled()) ||
          (body.scopes.includes("audio_speech") && !developerSpeechEnabled()) ||
          (body.scopes.includes("decisions") && !developerDecisionsEnabled()) ||
          (body.scopes.includes("file_analysis") && !developerAnalysisEnabled()) ||
          (body.scopes.includes("computer_use") && !developerComputerEnabled()) ||
          (body.scopes.includes("cloud_browser") && !developerBrowserEnabled())
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
