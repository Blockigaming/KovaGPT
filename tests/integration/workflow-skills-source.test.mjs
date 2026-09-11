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
  read("src/lib/principal-browser-storage.mjs"),
  read("src/lib/account-export-policy.mjs"),
  read("supabase/migrations/20260910210000_workflow_skill_packages.sql"),
  read("release-migrations.json"),
]);

test("workflow skills resolve server-side from owner installation and exact version IDs", () => {
  assert.match(ingress, /normalizeWorkflowSkillSelection\(value\.skill\)/u);
  assert.match(resolver, /p_installation_id: selection\.installationId/u);
  assert.match(resolver, /p_version_id: selection\.versionId/u);
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
  assert.doesNotMatch(home, /skill:\s*\{[^}]*instructions/su);
});

test("workflow skills remain usable across durable chat, image requests, and available updates", () => {
  assert.match(chat, /handleImageRequest\(lastText, logContext, workflowSkill\?\.block\)/u);
  assert.match(chat, /prompt: prompt \+ workflowSkillBlock/u);
  assert.match(chat, /workflowSkillBlock: workflowSkill\?\.block/u);
  assert.match(chat, /normalizeChatPreflightFailure\("selected_context", error\)/u);
  assert.match(chat, /if \(contextFailure\) throw error;[\s\S]{0,100}mapProviderError\(error\)/u);
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
  assert.match(panel, /retryEnvelopes\.current\.delete\(retryKey\)/u);
  assert.match(migration, /on conflict \(owner_id, skill_id\) do update/u);
  assert.match(migration, /public\.effective_user_plan_tier\(actor\)/u);
  assert.match(migration, /public\.try_add_storage_bytes\(actor, payload_bytes, storage_limit\)/u);
  assert.match(migration, /public\.release_project_storage_bytes\(actor, payload_bytes\)/u);
  assert.deepEqual(manifestEntry.functions, [
    "kova_private",
    "list_workflow_skills",
    "mutate_workflow_skill",
    "resolve_workflow_skill",
  ]);
  assert.match(exportPolicy, /\["workflow_skill_versions", "owner_id"\]/u);
  assert.match(panel, /Workflow skills/u);
  assert.match(panel, /Save new version/u);
  assert.match(panel, /Install update/u);
  assert.match(panel, /Use installed v/u);
});
