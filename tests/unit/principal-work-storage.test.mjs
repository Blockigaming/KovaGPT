import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  agentWorkspaceStorageKey,
  loadAgentRuns,
  loadWorkTasks,
  loadWorkTemplates,
  saveAgentRuns,
  saveWorkTasks,
  saveWorkTemplates,
  workStoragePrincipal,
  workTasksStorageKey,
  workTemplatesStorageKey,
} from "../../src/lib/work-store.ts";

const LEGACY_TASKS_KEY = "kova-work-tasks-v1";
const LEGACY_TEMPLATES_KEY = "kova-work-templates-v1";
const LEGACY_AGENT_KEY = "kova-agent-workspace-v1";

class MemoryStorage {
  #values = new Map();

  reads = [];
  failNextSet = false;

  getItem(key) {
    this.reads.push(String(key));
    return this.#values.has(String(key)) ? this.#values.get(String(key)) : null;
  }

  peek(key) {
    return this.#values.has(String(key)) ? this.#values.get(String(key)) : null;
  }

  setItem(key, value) {
    if (this.failNextSet) {
      this.failNextSet = false;
      throw new Error("quota exceeded");
    }
    this.#values.set(String(key), String(value));
  }

  removeItem(key) {
    this.#values.delete(String(key));
  }

  clear() {
    this.#values.clear();
    this.reads = [];
    this.failNextSet = false;
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });

const workTask = (id) => ({
  id,
  objective: `Objective ${id}`,
  context: "",
  steps: [],
  deliverables: [],
  status: "planning",
  createdAt: 1,
  updatedAt: 1,
});

const workTemplate = (id) => ({
  id,
  name: `Template ${id}`,
  objective: "Objective",
  context: "",
  plan: [],
  updatedAt: 1,
});

const agentRun = (id) => ({
  id,
  name: `Run ${id}`,
  objective: "Objective",
  instructions: "",
  project: "",
  context: [],
  tools: [],
  steps: [],
  approvalSteps: [],
  status: "ready",
  log: [],
  createdAt: 1,
  updatedAt: 1,
});

beforeEach(() => storage.clear());

test("account A, account B, and guest keep every work payload isolated", () => {
  const fixtures = {
    "account-a": {
      tasks: [workTask("task-a")],
      templates: [workTemplate("template-a")],
      runs: [agentRun("run-a")],
    },
    "account-b": {
      tasks: [workTask("task-b")],
      templates: [workTemplate("template-b")],
      runs: [agentRun("run-b")],
    },
    guest: {
      tasks: [workTask("task-guest")],
      templates: [workTemplate("template-guest")],
      runs: [agentRun("run-guest")],
    },
  };

  saveWorkTasks("account-a", fixtures["account-a"].tasks);
  saveWorkTemplates("account-a", fixtures["account-a"].templates);
  saveAgentRuns("account-a", fixtures["account-a"].runs);

  assert.deepEqual(loadWorkTasks("account-b"), []);
  assert.deepEqual(loadWorkTemplates("account-b"), []);
  assert.deepEqual(loadAgentRuns("account-b"), []);
  assert.deepEqual(loadWorkTasks(null), []);
  assert.deepEqual(loadWorkTemplates(null), []);
  assert.deepEqual(loadAgentRuns(null), []);

  saveWorkTasks("account-b", fixtures["account-b"].tasks);
  saveWorkTemplates("account-b", fixtures["account-b"].templates);
  saveAgentRuns("account-b", fixtures["account-b"].runs);
  saveWorkTasks(null, fixtures.guest.tasks);
  saveWorkTemplates(null, fixtures.guest.templates);
  saveAgentRuns(null, fixtures.guest.runs);

  for (const [principal, fixture] of [
    ["account-a", fixtures["account-a"]],
    ["account-b", fixtures["account-b"]],
    [null, fixtures.guest],
  ]) {
    assert.deepEqual(loadWorkTasks(principal), fixture.tasks);
    assert.deepEqual(loadWorkTemplates(principal), fixture.templates);
    assert.deepEqual(loadAgentRuns(principal), fixture.runs);
  }
});

test("signed-in principals never read or claim ownerless legacy work", () => {
  const records = [
    {
      legacyKey: LEGACY_TASKS_KEY,
      scopedKey: workTasksStorageKey,
      load: loadWorkTasks,
      value: [workTask("legacy-task")],
    },
    {
      legacyKey: LEGACY_TEMPLATES_KEY,
      scopedKey: workTemplatesStorageKey,
      load: loadWorkTemplates,
      value: [workTemplate("legacy-template")],
    },
    {
      legacyKey: LEGACY_AGENT_KEY,
      scopedKey: agentWorkspaceStorageKey,
      load: loadAgentRuns,
      value: [agentRun("legacy-run")],
    },
  ];

  for (const record of records) {
    const raw = JSON.stringify(record.value);
    storage.setItem(record.legacyKey, raw);
    storage.reads = [];

    assert.deepEqual(record.load("account-a"), []);
    assert.deepEqual(storage.reads, [
      "kova-work-sync-v1:user:account-a",
      record.scopedKey("account-a"),
    ]);
    assert.equal(storage.peek(record.legacyKey), raw);
    assert.equal(storage.peek(record.scopedKey("account-a")), null);
  }
});

test("only guest migrates all three valid legacy payloads", () => {
  const records = [
    {
      legacyKey: LEGACY_TASKS_KEY,
      scopedKey: workTasksStorageKey,
      load: loadWorkTasks,
      value: [workTask("legacy-task")],
    },
    {
      legacyKey: LEGACY_TEMPLATES_KEY,
      scopedKey: workTemplatesStorageKey,
      load: loadWorkTemplates,
      value: [workTemplate("legacy-template")],
    },
    {
      legacyKey: LEGACY_AGENT_KEY,
      scopedKey: agentWorkspaceStorageKey,
      load: loadAgentRuns,
      value: [agentRun("legacy-run")],
    },
  ];

  for (const record of records) {
    const raw = JSON.stringify(record.value);
    storage.setItem(record.legacyKey, raw);

    assert.deepEqual(record.load(null), record.value);
    assert.equal(storage.peek(record.scopedKey(null)), raw);
    assert.equal(storage.peek(record.legacyKey), null);
  }
});

test("invalid or unwritable legacy work is never destructively migrated", () => {
  const records = [
    {
      legacyKey: LEGACY_TASKS_KEY,
      scopedKey: workTasksStorageKey,
      load: loadWorkTasks,
      value: [workTask("legacy-task")],
    },
    {
      legacyKey: LEGACY_TEMPLATES_KEY,
      scopedKey: workTemplatesStorageKey,
      load: loadWorkTemplates,
      value: [workTemplate("legacy-template")],
    },
    {
      legacyKey: LEGACY_AGENT_KEY,
      scopedKey: agentWorkspaceStorageKey,
      load: loadAgentRuns,
      value: [agentRun("legacy-run")],
    },
  ];

  for (const record of records) {
    storage.clear();
    storage.setItem(record.legacyKey, "not-json");
    assert.deepEqual(record.load(null), []);
    assert.equal(storage.peek(record.legacyKey), "not-json");
    assert.equal(storage.peek(record.scopedKey(null)), null);

    storage.clear();
    const raw = JSON.stringify(record.value);
    storage.setItem(record.legacyKey, raw);
    storage.failNextSet = true;
    assert.deepEqual(record.load(null), record.value);
    assert.equal(storage.peek(record.legacyKey), raw);
    assert.equal(storage.peek(record.scopedKey(null)), null);
  }
});

test("every principal receives distinct deterministic work keys", () => {
  const principals = [null, "account-a", "account-b"];

  assert.equal(new Set(principals.map(workStoragePrincipal)).size, principals.length);
  assert.equal(new Set(principals.map(workTasksStorageKey)).size, principals.length);
  assert.equal(new Set(principals.map(workTemplatesStorageKey)).size, principals.length);
  assert.equal(new Set(principals.map(agentWorkspaceStorageKey)).size, principals.length);
});
