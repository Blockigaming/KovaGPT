import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";

const read = (path) =>
  readFileSync(new URL(`../../src/routes/${path}.tsx`, import.meta.url), "utf8");
function handler(source, start, end, environment) {
  const body = source.slice(source.indexOf(start) + start.length, source.indexOf(end));
  const code = transformSync(`async function execute() {${body}`, {
    loader: "ts",
    target: "es2022",
  }).code;
  return new Function(...Object.keys(environment), `${code}; return execute;`)(
    ...Object.values(environment),
  );
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function contextSetup() {
  const pending = deferred();
  const calls = [];
  const environment = {
    creatingRef: { current: false },
    dataReady: true,
    isSignedIn: true,
    generationRef: { current: 1 },
    principalRef: { current: "user:a" },
    principal: "user:a",
    draftRef: { current: { name: "Original", description: "", selected: ["file:1"] } },
    candidates: [{ key: "file:1", type: "file", id: "1", title: "Source", content: "Text" }],
    selected: ["file:1"],
    name: "Original",
    description: "",
    create: () => {
      calls.push("create");
      return pending.promise;
    },
    setCreating: (value) => calls.push(["busy", value]),
    setPacks: () => calls.push("packs"),
    setName: () => calls.push("name"),
    setDescription: () => calls.push("description"),
    setSelected: () => calls.push("selected"),
    toast: { success: () => calls.push("success"), error: () => calls.push("error") },
  };
  const execute = handler(
    read("context-packs"),
    "  const submit = async () => {",
    "  useLayoutEffect(() => {",
    environment,
  );
  return { environment, calls, pending, execute };
}

test("Context save completion from an old account cannot change current state or show success", async () => {
  const { environment, calls, pending, execute } = contextSetup();
  const task = execute();
  environment.principalRef.current = "user:b";
  environment.generationRef.current += 1;
  pending.resolve({ id: "saved" });
  await task;
  assert.deepEqual(calls, [["busy", true], "create"]);
});

test("Context save preserves drafts edited in flight and prevents duplicate requests", async () => {
  const { environment, calls, pending, execute } = contextSetup();
  const task = execute();
  await execute();
  environment.draftRef.current = { ...environment.draftRef.current, name: "New draft" };
  pending.resolve({ id: "saved" });
  await task;
  assert.deepEqual(calls, [["busy", true], "create", "packs", "success", ["busy", false]]);
  assert.equal(environment.creatingRef.current, false);
});

test("Context save clears an unchanged submitted draft", async () => {
  const { calls, pending, execute } = contextSetup();
  const task = execute();
  pending.resolve({ id: "saved" });
  await task;
  assert.deepEqual(calls, [
    ["busy", true],
    "create",
    "packs",
    "name",
    "description",
    "selected",
    "success",
    ["busy", false],
  ]);
});

test("Prompt save keeps new edits and their persisted draft after an older save returns", async () => {
  const pending = deferred();
  const calls = [];
  const environment = {
    creatingRef: { current: false },
    dataReady: true,
    dataGeneration: 1,
    generationRef: { current: 1 },
    principalRef: { current: "user:a" },
    principal: "user:a",
    draftRef: { current: { name: "Original", body: "Initial body" } },
    name: "Original",
    body: "Initial body",
    category: "General",
    folder: "Unfiled",
    projectId: "",
    packId: "",
    variables: () => [],
    save: () => {
      calls.push("save");
      return pending.promise;
    },
    setCreating: (value) => calls.push(["busy", value]),
    setItems: () => calls.push("items"),
    setName: () => calls.push("name"),
    setBody: () => calls.push("body"),
    draftKey: "draft",
    safeBrowserStorage: () => ({ removeItem: () => calls.push("remove") }),
    toast: { success: () => calls.push("success"), error: () => calls.push("error") },
  };
  const execute = handler(
    read("prompt-studio"),
    "  const create = async () => {",
    "  const launch =",
    environment,
  );
  const task = execute();
  await execute();
  environment.draftRef.current = { name: "New draft", body: "Edited body" };
  pending.resolve({ id: "saved" });
  await task;
  assert.deepEqual(calls, [["busy", true], "save", "items", "success", ["busy", false]]);
});

test("Prompt dialog mutations carry the inspection identity and preserve edited evaluation notes", () => {
  const text = read("prompt-studio");
  const revision = text.slice(
    text.indexOf('aria-label="Current prompt"'),
    text.indexOf("Previous versions</h3>"),
  );
  assert.match(revision, /const request = inspectionRequestRef.current/);
  assert.match(revision, /if \(request === inspectionRequestRef.current\) \{/);
  assert.match(revision, /if \(editBodyRef.current === editBody\) setInspecting\(null\)/);
  const evaluation = text.slice(text.indexOf('aria-label="Evaluation notes"'));
  assert.match(evaluation, /request !== inspectionRequestRef.current/);
  assert.match(evaluation, /setNotes\(\(current\) => \(current === notes \? "" : current\)\)/);
});

test("cancelled Prompt launch cannot navigate later or leave a pending handoff", async () => {
  const pending = deferred();
  const calls = [];
  const environment = {
    dataReady: true,
    dataGeneration: 1,
    generationRef: { current: 1 },
    principalRef: { current: "user:a" },
    principal: "user:a",
    testingRequestRef: { current: 3 },
    launchingRef: { current: null },
    setLaunching: (value) => calls.push(["launching", value]),
    item: { id: "prompt", body: "Review this", variables: [] },
    values: {},
    packs: [],
    update: () => {
      calls.push("update");
      return pending.promise;
    },
    writePrincipalHandoff: () => {
      calls.push("handoff");
      return { ok: true };
    },
    safeBrowserStorage: () => ({}),
    isLoaded: true,
    userKey: "a",
    navigate: () => calls.push("navigate"),
    toast: { warning: () => calls.push("warning"), error: () => calls.push("error") },
  };
  const execute = handler(
    read("prompt-studio"),
    "  const launch = async (item: PromptTemplate) => {",
    "  return (\n    <AppShell>",
    environment,
  );
  const task = execute();
  await execute();
  environment.testingRequestRef.current += 1;
  pending.resolve({ ok: true });
  await task;
  assert.deepEqual(calls, [["launching", true], "update"]);
});
