import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  ACCOUNT_EXPORT_DIRECT_TABLES,
  ACCOUNT_EXPORT_MAX_BYTES,
  ACCOUNT_EXPORT_PROJECT_TABLES,
} from "../../src/lib/account-export-policy.mjs";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
const [
  chat,
  auth,
  ingress,
  chatStore,
  resolver,
  digestTypes,
  functions,
  panel,
  apps,
  retryPolicy,
  home,
  mobileTopBar,
  storage,
  exportServer,
  exportPolicy,
  migration,
  manifest,
] = await Promise.all([
  read("src/routes/api/chat.ts"),
  read("src/components/auth/ClerkSafe.tsx"),
  read("src/lib/chat-ingress.server.mjs"),
  read("src/lib/chat-store.ts"),
  read("src/lib/workflow-skills.server.ts"),
  read("src/lib/workflow-skills-digest.server.d.mts"),
  read("src/lib/workflow-skills.functions.ts"),
  read("src/components/WorkflowSkillsPanel.tsx"),
  read("src/routes/apps.tsx"),
  read("src/lib/workflow-skills-retry.mjs"),
  read("src/routes/index.tsx"),
  read("src/components/MobileTopBar.tsx"),
  read("src/lib/principal-browser-storage.mjs"),
  read("src/lib/account-export.server.ts"),
  read("src/lib/account-export-policy.mjs"),
  read("supabase/migrations/20260910210000_workflow_skill_packages.sql"),
  read("release-migrations.json"),
]);

test("workflow skills resolve server-side from owner installation and exact version IDs", () => {
  assert.match(ingress, /normalizeWorkflowSkillSelection\(value\.skill\)/u);
  assert.match(resolver, /p_installation_id: selection\.installationId/u);
  assert.match(resolver, /p_version_id: selection\.versionId/u);
  assert.match(digestTypes, /toolPlanningBlock: string/u);
  assert.match(resolver, /AbortSignal\.any\(\[signal, AbortSignal\.timeout\(10_000\)\]\)/u);
  assert.match(resolver, /pending\.abortSignal\(deadline\)/u);
  assert.match(resolver, /error\.message === "workflow_skill_denied"/u);
  assert.match(resolver, /error\.message === "workflow_skill_selection_changed"/u);
  assert.match(migration, /installation\.owner_id = p_actor/u);
  assert.match(migration, /installation\.version_id = p_version_id/u);
  assert.match(migration, /workflow_skill_selection_changed/u);
});

test("skill package text cannot expand chat tools credentials models or entitlements", () => {
  assert.match(chat, /Resolving one never changes tools, credentials/u);
  assert.match(chat, /\(workflowSkill\?\.block \?\? ""\)/u);
  assert.doesNotMatch(functions, /allowedTools|accessToken|refreshToken|credential/u);
  assert.doesNotMatch(migration, /\b(?:allowed_tools|access_token|refresh_token)\b/u);
  assert.match(panel, /cannot grant tools, credentials, account access, or model/u);
});

test("workflow skill selection is principal-scoped and retained as IDs rather than package text", () => {
  assert.match(storage, /"kova-workflow-skill-chat"/u);
  assert.match(panel, /writePrincipalHandoff/u);
  assert.match(home, /consume<ConversationWorkflowSkill>\("kova-workflow-skill-chat"/u);
  assert.match(home, /installationId: selectedWorkflowSkill\.installationId/u);
  assert.match(home, /versionId: selectedWorkflowSkill\.versionId/u);
  const principalReset = home.slice(
    home.indexOf("// Load (or reload) settings"),
    home.indexOf("const loaded = loadSettings"),
  );
  assert.match(principalReset, /setPendingWorkflowSkill\(null\)/u);
  const existingConversationUpdate = home.slice(
    home.indexOf("const selectedWorkflowSkill = existingConversation"),
    home.indexOf("setActiveId(nextConvId)"),
  );
  assert.match(
    existingConversationUpdate,
    /selectedWorkflowSkill \? \{ skill: selectedWorkflowSkill \} : \{\}/u,
  );
  assert.doesNotMatch(home, /skill:\s*\{[^}]*instructions/su);
  const storedSelectionGuard = chatStore.slice(
    chatStore.indexOf("export function isConversationWorkflowSkill"),
    chatStore.indexOf("export type ComposerToolId"),
  );
  assert.match(storedSelectionGuard, /Object\.keys\(value\)/u);
  assert.match(storedSelectionGuard, /keys\.length !== CONVERSATION_WORKFLOW_SKILL_KEYS\.size/u);
  assert.match(
    storedSelectionGuard,
    /keys\.some\(\(key\) => !CONVERSATION_WORKFLOW_SKILL_KEYS\.has\(key\)\)/u,
  );
});

test("workflow skills remain usable across durable chat, image requests, and available updates", () => {
  const imageBranch = chat.slice(
    chat.indexOf("if (isImageRequest && auth)"),
    chat.indexOf("// Anonymous chat is allowed"),
  );
  assert.match(chat, /handleImageRequest\(imagePrompt, logContext\)/u);
  assert.ok(
    imageBranch.indexOf("boundedImageProviderPrompt") < imageBranch.indexOf("enforceQuota"),
  );
  const imageQuota = imageBranch.indexOf("enforceQuota");
  assert.ok(imageBranch.indexOf("assertSelectedContextsCurrent") < imageQuota);
  assert.ok(imageQuota < imageBranch.lastIndexOf("assertSelectedContextsCurrent"));
  const chatQuotaBranch = chat.slice(
    chat.indexOf("// Anonymous chat is allowed"),
    chat.indexOf("// SECURITY: Server-side tier enforcement"),
  );
  const contextBeforeChatQuota = chatQuotaBranch.indexOf("assertSelectedContextsCurrent");
  const chatQuota = chatQuotaBranch.indexOf('enforceQuota(auth, "chats"');
  assert.ok(
    contextBeforeChatQuota > -1 && contextBeforeChatQuota < chatQuota,
    "selected context must be current immediately before generic chat quota",
  );
  const researchDispatch = chat.indexOf('if (clientTool === "deep_research" && lastText)');
  const chatQuotaGlobal = chat.indexOf('enforceQuota(auth, "chats"');
  assert.ok(chatQuotaGlobal > -1 && chatQuotaGlobal < researchDispatch);
  assert.ok(chat.indexOf("assertSelectedContextsCurrent", researchDispatch) > researchDispatch);
  const toolHopLoop = chat.slice(
    chat.indexOf("for (let hop = 0; hop < MAX_TOOL_HOPS; hop++)"),
    chat.indexOf("if (hopFailed)"),
  );
  const hopResponseParsed = toolHopLoop.indexOf("if (!parsedHop)");
  const postHopCurrentness = toolHopLoop.indexOf(
    "await assertSelectedContextsCurrent(request.signal)",
    hopResponseParsed,
  );
  const toolCallsInspected = toolHopLoop.indexOf("const msg = parsedHop.message");
  assert.ok(
    hopResponseParsed > -1 &&
      hopResponseParsed < postHopCurrentness &&
      postHopCurrentness < toolCallsInspected,
    "selected workflow context must be revalidated after the model hop and before tool calls",
  );
  const perCallCurrentness = toolHopLoop.indexOf(
    "await assertSelectedContextsCurrent(request.signal)",
    toolCallsInspected,
  );
  assert.ok(
    perCallCurrentness > toolCallsInspected &&
      perCallCurrentness < toolHopLoop.indexOf("stagePendingAction"),
    "each returned tool call must be revalidated again immediately before processing",
  );
  assert.match(chat, /workflowSkillBlock: workflowSkill\?\.block/u);
  assert.match(chat, /workflowSkill\.toolPlanningBlock/u);
  const connectorGate = chat.slice(
    chat.indexOf("const googleContext ="),
    chat.indexOf("const availableTools ="),
  );
  assert.match(connectorGate, /!hasAttachments/u);
  assert.doesNotMatch(connectorGate, /!hasImages/u);
  const planningContext = chat.slice(
    chat.indexOf("const toolPlanningMessages"),
    chat.indexOf("const workingMessages"),
  );
  assert.match(planningContext, /\{ role: "user", content: lastText \}/u);
  assert.doesNotMatch(planningContext, /finalMessages\.map/u);
  assert.doesNotMatch(
    planningContext,
    /conversationSummary|memoryBlock|projectBlock|chatWorkspaceBlock/u,
  );
  const noMoreToolCalls = chat.slice(
    chat.indexOf("if (!msg.tool_calls || msg.tool_calls.length === 0)"),
    chat.indexOf("// Enforce total tool-call cap"),
  );
  assert.match(noMoreToolCalls, /!workflowSkill &&\s*toolsWereUsed/u);
  const finalToolContext = chat.slice(
    chat.indexOf("const finalBody ="),
    chat.indexOf("const activityCount ="),
  );
  assert.match(finalToolContext, /\[\.\.\.finalMessages, \.\.\.finalToolMessages\]/u);
  assert.match(chat, /normalizeChatPreflightFailure\("selected_context", error\)/u);
  assert.match(chat, /if \(contextFailure\) throw error;[\s\S]{0,100}mapProviderError\(error\)/u);
  assert.match(home, /skill: undefined, updatedAt: Date\.now\(\)/u);
  const clearSkill = home.slice(
    home.indexOf("const clearWorkflowSkill"),
    home.indexOf("useEffect(() =>", home.indexOf("const clearWorkflowSkill")),
  );
  assert.match(clearSkill, /clearRetryTimer\(retryTimerRef\)/u);
  assert.match(clearSkill, /retryGenerationRef\.current \+= 1/u);
  assert.match(clearSkill, /retryActionEpochRef\.current\.set/u);
  assert.match(home, /aria-label=\{`Clear workflow skill/u);
  assert.match(home, /skill=\{/u);
  assert.match(mobileTopBar, /aria-label=\{`Clear workflow skill/u);
  assert.match(panel, /\{skill\.installationId \? \(\s*<Button[\s\S]*?Uninstall/u);
});

test("workflow skill lifecycle is immutable replay-safe exportable and visible in Apps", () => {
  const manifestEntry = JSON.parse(manifest).migrations.find(
    (entry) => entry.filename === "20260910210000_workflow_skill_packages.sql",
  );
  assert.match(migration, /unique \(skill_id, version\)/u);
  assert.match(migration, /workflow_skill_idempotency_conflict/u);
  assert.match(migration, /set revision = revision \+ 1, updated_at = now\(\)/u);
  assert.match(panel, /reserveWorkflowSkillMutationEnvelope\(/u);
  assert.match(retryPolicy, /const existing = envelopes\.get\(retryKey\)/u);
  const pendingMutationCap = retryPolicy.indexOf(
    "envelopes.size >= MAX_PENDING_WORKFLOW_SKILL_MUTATIONS",
  );
  const newMutationEnvelope = retryPolicy.indexOf("const envelope = createEnvelope()");
  assert.ok(
    pendingMutationCap > -1 && pendingMutationCap < newMutationEnvelope,
    "new workflow mutations must fail closed at the pending cap before allocating an envelope",
  );
  assert.doesNotMatch(panel, /retryEnvelopes\.current\.clear\(\)/u);
  assert.doesNotMatch(retryPolicy, /\.clear\(/u);
  const reload = panel.slice(
    panel.indexOf("const reload = useCallback"),
    panel.indexOf("const mutate"),
  );
  const listGuard = reload.indexOf("generation !== loadGenerationRef.current");
  assert.match(panel, /const loadGenerationRef = useRef\(0\)/u);
  assert.ok(
    listGuard > -1 && listGuard < reload.indexOf("setSkills(result)"),
    "only the latest workflow-skill list response may replace panel state",
  );
  const responseCheck = panel.indexOf("parseWorkflowSkillMutationResult(result)");
  const envelopeCleanup = panel.indexOf("retryEnvelopes.current.delete(retryKey)");
  assert.ok(
    responseCheck > -1 && responseCheck < envelopeCleanup,
    "mutation response must be verified before its replay envelope is removed",
  );
  assert.match(panel, /retryEnvelopes\.current\.delete\(retryKey\)/u);
  assert.match(migration, /on conflict \(owner_id, skill_id\) do update/u);
  assert.match(migration, /public\.effective_user_plan_tier\(actor\)/u);
  assert.match(migration, /public\.try_add_storage_bytes\(actor, payload_bytes, storage_limit\)/u);
  assert.match(migration, /to_jsonb\(version_record\)::text/u);
  assert.match(migration, /workflow_skill_bytes > 32000000/u);
  const exportBudget = migration.slice(
    migration.indexOf("create or replace function kova_private.account_export_direct_row_bytes"),
    migration.indexOf("create or replace function public.list_workflow_skills"),
  );
  const directBudget = exportBudget.slice(
    exportBudget.indexOf("for export_source in"),
    exportBudget.indexOf("-- The exporter reserves"),
  );
  const directSources = [...directBudget.matchAll(/\('([^']+)', '([^']+)'\)/gu)].map(
    ([, table, ownerColumn]) => [table, ownerColumn],
  );
  assert.deepEqual(directSources, ACCOUNT_EXPORT_DIRECT_TABLES);
  const indirectBudget = exportBudget.slice(exportBudget.indexOf("-- The exporter reserves"));
  const budgetedIndirectTables = new Set(
    [...indirectBudget.matchAll(/^\s*\('([^']+)',/gmu)].map(([, table]) => table),
  );
  const exporterIndirectTables = new Set([
    ...ACCOUNT_EXPORT_PROJECT_TABLES,
    ...[...exportServer.matchAll(/readAll(?:Where|In)\(\s*budget,\s*"([^"]+)"/gu)].map(
      ([, table]) => table,
    ),
  ]);
  assert.deepEqual(
    [...budgetedIndirectTables].sort(),
    [...exporterIndirectTables].sort(),
    "the admission budget must cover every relationship-traversed exporter table",
  );
  assert.match(exportBudget, /security invoker/u);
  assert.doesNotMatch(exportBudget, /to_regclass/u);
  assert.match(exportBudget, /left join storage\.objects object/u);
  assert.match(exportBudget, /4 \* \(\(size_bytes \+ 2\) \/ 3\)/u);
  assert.match(exportBudget, /file_raw_bytes > 33554432/u);
  assert.match(exportBudget, /fixed_envelope_bytes constant bigint := 65536/u);
  assert.match(exportBudget, /from auth\.users auth_user/u);
  assert.match(exportBudget, /from auth\.identities identity_row/u);
  assert.match(exportBudget, /from auth\.mfa_factors factor_row/u);
  assert.match(
    migration,
    new RegExp(
      `account_export_direct_row_bytes\\(actor, ${ACCOUNT_EXPORT_MAX_BYTES}\\) > ${ACCOUNT_EXPORT_MAX_BYTES}`,
      "u",
    ),
  );
  assert.match(
    migration,
    /if p_action in \('create', 'version', 'install', 'uninstall'\)[\s\S]{0,180}account_export_direct_row_bytes/u,
  );
  assert.match(migration, /workflow_skill_export_limit/u);
  assert.match(migration, /public\.release_project_storage_bytes\(actor, payload_bytes\)/u);
  assert.match(migration, /workflow_skill_digest_mismatch/u);
  assert.match(migration, /instructions_text, p_payload->'resources', computed_digest/u);
  const mutation = migration.slice(
    migration.indexOf("create or replace function public.mutate_workflow_skill"),
    migration.indexOf("create or replace function public.resolve_workflow_skill"),
  );
  const deletionFenceLock = mutation.indexOf("hashtextextended(actor::text, 20260903204500)");
  const principalCheck = mutation.indexOf("workflow_skill_principal_current(actor)");
  const workflowLock = mutation.indexOf("hashtextextended(actor::text, 20260910210000)");
  assert.ok(
    deletionFenceLock > -1 && deletionFenceLock < principalCheck && principalCheck < workflowLock,
    "workflow mutation must hold the shared deletion fence before checking principal state",
  );
  const replayReturn = mutation.indexOf("return receipt.result");
  const accountScan = mutation.indexOf("account_export_direct_row_bytes");
  assert.ok(
    replayReturn > -1 && replayReturn < accountScan,
    "exact mutation replays must return before the account export scan",
  );
  assert.match(mutation, /actor uuid := p_actor/u);
  const authorization = migration.slice(
    migration.indexOf("create or replace function public.authorize_workflow_skill_mutation"),
    migration.indexOf("create or replace function public.mutate_workflow_skill"),
  );
  assert.match(authorization, /consume_diagnostic_rate_limit/u);
  assert.match(authorization, /'workflow_skill_mutation',\s*12,\s*3600/u);
  assert.match(authorization, /from public\.workflow_skill_mutations/u);
  assert.doesNotMatch(authorization, /account_export_direct_row_bytes/u);
  const serverMutation = functions.slice(
    functions.indexOf("async function runWorkflowSkillMutation"),
    functions.indexOf("async function draftPayload"),
  );
  const authorizationCall = serverMutation.indexOf(
    'await rpc(supabaseAdmin, "authorize_workflow_skill_mutation"',
  );
  const mutationCall = serverMutation.indexOf('await rpc(supabaseAdmin, "mutate_workflow_skill"');
  assert.ok(
    authorizationCall > -1 && authorizationCall < mutationCall,
    "the independently committed service preflight must finish before mutation begins",
  );
  assert.match(serverMutation, /client\.server/u);
  assert.match(functions, /workflow_skill_rate_limit/u);
  const listFunction = migration.slice(
    migration.indexOf("create or replace function public.list_workflow_skills"),
    migration.indexOf("create or replace function public.get_workflow_skill"),
  );
  const detailFunction = migration.slice(
    migration.indexOf("create or replace function public.get_workflow_skill"),
    migration.indexOf("create or replace function public.authorize_workflow_skill_mutation"),
  );
  assert.match(listFunction, /p_limit integer default 20/u);
  assert.match(listFunction, /p_limit is null[\s\S]{0,80}p_limit not between 1 and 20/u);
  assert.match(listFunction, /limit p_limit/u);
  assert.match(listFunction, /'nextCursor'/u);
  assert.doesNotMatch(listFunction, /version\.instructions|version\.resources/u);
  assert.match(detailFunction, /version\.instructions/u);
  assert.match(detailFunction, /version\.resources/u);
  assert.match(detailFunction, /skill\.owner_id = p_actor/u);
  assert.match(
    migration,
    /grant execute on function public\.get_workflow_skill\(uuid, uuid\)\s+to service_role/u,
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function public\.get_workflow_skill[^;]+to authenticated/u,
  );
  assert.match(functions, /rows: z\.array\(Card\)\.max\(20\)/u);
  assert.match(functions, /pageNumber < 5/u);
  assert.match(functions, /p_limit: 20/u);
  assert.match(functions, /await rpc\(supabaseAdmin, "get_workflow_skill"/u);
  const versionHistoryRead = functions.slice(
    functions.indexOf('from("workflow_skill_versions")'),
    functions.indexOf("return { ...parsed.data, versions: history.data }"),
  );
  assert.match(
    versionHistoryRead,
    /select\("id, version, name, digest:content_sha256, created_at"\)/u,
  );
  assert.match(versionHistoryRead, /eq\("owner_id", context\.userId\)/u);
  assert.match(versionHistoryRead, /eq\("skill_id", data\.id\)/u);
  assert.match(versionHistoryRead, /order\("version", \{ ascending: false \}\)/u);
  assert.match(versionHistoryRead, /limit\(30\)/u);
  assert.doesNotMatch(versionHistoryRead, /instructions|resources/u);
  const editorLoad = panel.slice(
    panel.indexOf("const openEditor = async"),
    panel.indexOf("const openChatWithSkill"),
  );
  assert.ok(
    editorLoad.indexOf("await get({ data: { id: skill.id } })") <
      editorLoad.indexOf("parseWorkflowSkillDetailResult(response)") &&
      editorLoad.indexOf("parseWorkflowSkillDetailResult(response)") <
        editorLoad.indexOf("setEditing(current)"),
    "the editor must load one authorized package body before populating the draft",
  );
  assert.match(apps, /primaryEmailAddress\?\.verification\?\.status === "verified"/u);
  assert.match(apps, /supabase\.auth\.resend\(\{ type: "signup", email \}\)/u);
  assert.match(apps, /Resend verification email/u);
  assert.match(auth, /u\.email_confirmed_at \? "verified" : "unverified"/u);
  assert.match(
    migration,
    /grant execute on function public\.mutate_workflow_skill\(uuid, text, uuid, bigint, jsonb, uuid, timestamptz\)\s+to service_role/u,
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function public\.mutate_workflow_skill[^;]+to authenticated/u,
  );
  assert.deepEqual(manifestEntry.functions, [
    "workflow_skill_utf16_length",
    "workflow_skill_principal_current",
    "account_export_direct_row_bytes",
    "list_workflow_skills",
    "get_workflow_skill",
    "authorize_workflow_skill_mutation",
    "mutate_workflow_skill",
    "resolve_workflow_skill",
  ]);
  assert.match(migration, /workflow_skill_utf16_length\(name_text\) not between 1 and 120/u);
  assert.match(
    migration,
    /workflow_skill_utf16_length\(resource_content\) not between 1 and 8000/u,
  );
  assert.match(exportPolicy, /\["workflow_skill_versions", "owner_id"\]/u);
  assert.match(panel, /Workflow skills/u);
  assert.match(panel, /Save new version/u);
  assert.match(panel, /Install update/u);
  assert.match(panel, /Use installed v/u);
  assert.match(panel, /Version history/u);
  assert.match(panel, /Roll back to v/u);
  assert.match(panel, /versionId: target\.id/u);
});
