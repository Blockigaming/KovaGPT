import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const sourceRoot = resolve(repositoryRoot, "src");

const callerPaths = [
  "src/components/AgentWorkspace.tsx",
  "src/components/WorkspaceIntelligence.tsx",
  "src/routes/context-packs.tsx",
  "src/routes/library.tsx",
];

async function walkSource(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkSource(path)));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

async function findWorkStoreCallers() {
  const callers = [];
  for (const path of await walkSource(sourceRoot)) {
    if (path.endsWith("/src/lib/work-store.ts")) continue;
    const source = await readFile(path, "utf8");
    if (/from\s+["'][^"']*work-store["']|import\(["'][^"']*work-store["']\)/.test(source)) {
      callers.push({ path: relative(repositoryRoot, path), source });
    }
  }
  return callers;
}

test("all work-store APIs require an explicit principal and migrate only for guest", async () => {
  const store = await read("src/lib/work-store.ts");

  for (const name of [
    "loadWorkTasks",
    "saveWorkTasks",
    "loadWorkTemplates",
    "saveWorkTemplates",
    "loadAgentRuns",
    "saveAgentRuns",
  ]) {
    assert.match(store, new RegExp(`export function ${name}\\(\\s*userKey: WorkStorageUserKey`));
  }

  assert.match(store, /if \(currentRaw !== null \|\| userKey !== null\)/);
  assert.match(store, /const LEGACY_WORK_TASKS_KEY = "kova-work-tasks-v1"/);
  assert.match(store, /const LEGACY_WORK_TEMPLATES_KEY = "kova-work-templates-v1"/);
  assert.match(store, /const LEGACY_AGENT_WORKSPACE_KEY = "kova-agent-workspace-v1"/);
  assert.match(store, /localStorage\.setItem\(key, legacyRaw\)/);
  assert.match(store, /localStorage\.removeItem\(legacyKey\)/);
});

test("every direct work-store caller supplies the resolved user key", async () => {
  const [agent, intelligence, contextPacks, library] = await Promise.all(callerPaths.map(read));

  assert.match(agent, /const principal = isLoaded \? workStoragePrincipal\(userKey\) : null/);
  assert.match(agent, /runState\.principal === principal/);
  assert.match(agent, /runState\.generation === storageGenerationRef\.current/);
  assert.match(agent, /const runs = principalReady \? runState\.items : EMPTY_AGENT_RUNS/);
  assert.match(
    agent,
    /useEffect\(\(\) => \{[\s\S]{0,220}setName\("Research and deliver"\);\s*setObjective\(""\);\s*setInstructions\(""\);\s*setProject\(""\);\s*setContext\(""\);\s*setSteps\(DEFAULT_STEPS\);\s*setApprovalSteps\(\[2\]\);\s*setTools\(\["web", "files"\]\);\s*setValidation\(\[\]\)/,
  );
  assert.match(
    agent,
    /setRunState\(\{ principal, generation, items: loadAgentRuns\(userKey\) \}\)/,
  );
  assert.match(agent, /if \(!principalReady \|\| principal === null\) return/);
  assert.match(agent, /if \(generation !== storageGenerationRef\.current\) return/);
  assert.match(agent, /saveAgentRuns\(userKey, next\)/);
  assert.match(agent, /PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT/);
  assert.match(agent, /setRunState\(\{ principal, generation, items: \[\] \}\)/);
  assert.match(agent, /\) : !principalReady \? \(\s*<p[^>]+role="status">/);
  assert.match(agent, /\{available && principalReady && \(/);

  assert.match(intelligence, /loadWorkTasks\(userKey\)/);
  assert.match(intelligence, /remoteState\.principal === principal/);
  assert.match(intelligence, /if \(!isLoaded \|\| !isSignedIn\) return \[\]/);

  assert.match(contextPacks, /loadWorkTasks\(userKey\)/);
  assert.match(contextPacks, /dataPrincipal === principal/);
  assert.match(contextPacks, /if \(!dataReady\) return \[\]/);

  assert.equal((library.match(/loadWorkTasks\(userKey\)/g) ?? []).length, 3);
  assert.equal((library.match(/saveWorkTasks\(\s*userKey,/g) ?? []).length, 2);
  assert.match(library, /itemState\.principal === principal/);
  assert.match(library, /principalRef\.current !== principal/);
});

test("every discovered work-store caller passes its verified principal to every storage call", async () => {
  const callers = await findWorkStoreCallers();
  const discoveredPaths = callers.map(({ path }) => path);
  for (const expected of callerPaths) assert.ok(discoveredPaths.includes(expected), expected);

  for (const { path, source } of callers) {
    // The coordinator captures a validated UUID owner for its whole lifecycle.
    // UI callers still use the resolved userKey; arbitrary aliases are rejected.
    const principalName = path === "src/lib/work-sync-client.ts" ? "ownerId" : "userKey";
    if (principalName === "ownerId") {
      assert.match(source, /export function startWorkSync\(ownerId: string\)/);
      assert.match(source, /session\?\.user\.id !== ownerId/);
      assert.match(
        source,
        /if \(!alive\(\)\) return;\s*const initial = createWorkSyncState\(ownerId/,
      );
    }
    for (const name of [
      "loadWorkTasks",
      "saveWorkTasks",
      "loadWorkTemplates",
      "saveWorkTemplates",
      "loadAgentRuns",
      "saveAgentRuns",
    ]) {
      const allCalls = (source.match(new RegExp(`\\b${name}\\s*\\(`, "g")) ?? []).length;
      const scopedCalls = (
        source.match(new RegExp(`\\b${name}\\s*\\(\\s*${principalName}(?=\\s*[,\\)])`, "g")) ?? []
      ).length;
      assert.equal(scopedCalls, allCalls, `${path}: ${name} must receive ${principalName} first`);
    }
  }
});
