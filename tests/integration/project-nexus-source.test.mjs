import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Nexus documents connector truth and hides unsupported connection claims", async () => {
  const [report, apps] = await Promise.all([
    read("docs/chatgpt-connector-parity.md"),
    read("src/routes/apps.tsx"),
  ]);
  assert.match(report, /Google Drive\s+\| \*\*Already implemented\*\*/);
  assert.match(report, /Microsoft SharePoint \/ OneDrive \| \*\*OAuth \+ backend needed\*\*/);
  assert.match(
    apps,
    /const WORKING_IDS = new Set<string>\(\[[\s\S]*"google"[\s\S]*"github"[\s\S]*\]\)/,
  );
});

test("Agent Workspace is plan-gated, approval-aware, local-only and explicit", async () => {
  const [component, store, route] = await Promise.all([
    read("src/components/AgentWorkspace.tsx"),
    read("src/lib/work-store.ts"),
    read("src/routes/work.tsx"),
  ]);
  assert.match(component, /tier === "plus" \|\| tier === "pro"/);
  assert.match(component, /Approval/);
  assert.match(component, /Continue in Chat/);
  assert.match(component, /No provider call was made/);
  assert.match(component, /Review scheduling/);
  assert.match(component, /Saved plans/);
  assert.match(component, /background execution and scheduling are unavailable/);
  assert.doesNotMatch(component, /Execution history/);
  assert.match(store, /type AgentRunStatus/);
  assert.match(store, /"approval_needed"/);
  assert.match(route, /useServerFn\(listWorkRuns\)/);
});

test("Nexus audit leaves no frontend item marked partial or missing", async () => {
  const audit = await read("docs/project-nexus-audit.md");
  assert.doesNotMatch(audit, /\| \*\*(PARTIAL|MISSING)\*\* \|/);
  assert.match(audit, /OPENAI INFRASTRUCTURE REQUIRED/);
  assert.match(audit, /BACKEND REQUIRED/);
  assert.match(audit, /PROVIDER REQUIRED/);
});
