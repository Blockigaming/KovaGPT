import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
const [
  chat,
  ingress,
  resolver,
  functions,
  panel,
  home,
  mobileTopBar,
  storage,
  exportPolicy,
  migration,
  manifest,
] = await Promise.all([
  read("src/routes/api/chat.ts"),
  read("src/lib/chat-ingress.server.mjs"),
  read("src/lib/workflow-skills.server.ts"),
  read("src/lib/workflow-skills.functions.ts"),
  read("src/components/WorkflowSkillsPanel.tsx"),
  read("src/routes/index.tsx"),
  read("src/components/MobileTopBar.tsx"),
  read("src/lib/principal-browser-storage.mjs"),
  read("src/lib/account-export-policy.mjs"),
  read("supabase/migrations/20260910210000_workflow_skill_packages.sql"),
  read("release-migrations.json"),
]);

test("workflow skills resolve server-side from owner installation and exact version IDs", () => {
  assert.match(ingress, /normalizeWorkflowSkillSelection\(value\.skill\)/u);
  assert.match(resolver, /p_installation_id: selection\.installationId/u);
  assert.match(resolver, /p_version_id: selection\.versionId/u);
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
  assert.match(chat, /workflowSkillBlock: workflowSkill\?\.block/u);
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
  assert.match(panel, /retryEnvelopes\.current\.get\(retryKey\)/u);
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
  assert.deepEqual(manifestEntry.functions, [
    "workflow_skill_utf16_length",
    "workflow_skill_principal_current",
    "list_workflow_skills",
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
});
