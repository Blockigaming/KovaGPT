import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  MAX_MANAGEMENT_QUERY_LENGTH,
  MAX_PROJECT_OPENED_ENTRIES,
  migrateProjectListPreferences,
  parseProjectListPreferences,
  parseProjectOpenedHistory,
  PROJECT_LIST_STORAGE_BASE,
} from "../../src/lib/management-list-preferences.mjs";
import {
  clearPrincipalBrowserStorage,
  isPrincipalBrowserStorageClearedEvent,
  principalScopedStorageKey,
} from "../../src/lib/principal-browser-storage.mjs";

const defaults = { query: "", sort: "opened", scope: "all", archived: false, view: "grid" };
const canonical = (owner) => principalScopedStorageKey(PROJECT_LIST_STORAGE_BASE, owner);
const legacy = (owner) => `kova-project-list:${owner}`;
function memoryStorage(entries = []) {
  const values = new Map(entries);
  const writes = [];
  return {
    writes,
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      writes.push([key, value]);
      values.set(key, value);
    },
    removeItem: (key) => values.delete(key),
  };
}

test("Projects validates all preferences and strips records, owner data and malformed fields", () => {
  for (const raw of [null, "null", "[]", "{", " ".repeat(4097)]) {
    assert.deepEqual(parseProjectListPreferences(raw), defaults);
  }
  assert.deepEqual(
    parseProjectListPreferences(
      JSON.stringify({
        query: "a".repeat(700),
        sort: "name",
        scope: "owned",
        archived: true,
        view: "list",
        owner: "A",
        projects: [{ id: "secret" }],
        opened: { secret: 123 },
      }),
    ),
    {
      query: "a".repeat(MAX_MANAGEMENT_QUERY_LENGTH),
      sort: "name",
      scope: "owned",
      archived: true,
      view: "list",
    },
  );
  assert.deepEqual(
    parseProjectListPreferences(
      JSON.stringify({
        query: {},
        sort: "unknown",
        scope: "unknown",
        archived: "true",
        view: "unknown",
      }),
    ),
    defaults,
  );
});

test("same-owner legacy migration preserves bounded filters and never adopts global view", () => {
  const owner = "account/a:encoded";
  const storage = memoryStorage([
    [
      legacy(owner),
      '{"query":"my private query","sort":"updated","scope":"shared","archived":true}',
    ],
    [legacy("B"), '{"query":"other account"}'],
    [legacy(null), '{"query":"guest"}'],
    ["kova-projects-view", "list"],
  ]);
  migrateProjectListPreferences(storage, owner);
  assert.deepEqual(JSON.parse(storage.getItem(canonical(owner))), {
    query: "my private query",
    sort: "updated",
    scope: "shared",
    archived: true,
    view: "grid",
  });
  assert.equal(storage.getItem(legacy(owner)), null);
  assert.equal(storage.getItem(legacy("B")), '{"query":"other account"}');
  assert.equal(storage.getItem(legacy(null)), '{"query":"guest"}');
  assert.equal(storage.getItem("kova-projects-view"), "list");
  migrateProjectListPreferences(storage, owner);
  assert.equal(storage.writes.length, 1, "effect replay must not overwrite the canonical value");
});

test("existing canonical preferences win and unresolved auth cannot access any storage", () => {
  const storage = memoryStorage([
    [canonical("A"), '{"query":"new"}'],
    [legacy("A"), '{"query":"old"}'],
  ]);
  migrateProjectListPreferences(storage, "A");
  assert.equal(storage.getItem(canonical("A")), '{"query":"new"}');
  assert.equal(storage.getItem(legacy("A")), null);
  assert.equal(storage.writes.length, 0);
  migrateProjectListPreferences(
    {
      getItem() {
        assert.fail("unresolved auth read storage");
      },
    },
    undefined,
  );
  migrateProjectListPreferences(null, "A");
});

test("migration sanitizes malformed legacy state and retains recoverable data on denied writes", () => {
  const malformed = memoryStorage([[legacy("A"), "null"]]);
  migrateProjectListPreferences(malformed, "A");
  assert.deepEqual(JSON.parse(malformed.getItem(canonical("A"))), defaults);
  const denied = memoryStorage([[legacy("A"), '{"query":"keep until saved"}']]);
  denied.setItem = () => {
    throw new Error("Storage denied");
  };
  migrateProjectListPreferences(denied, "A");
  assert.equal(denied.getItem(legacy("A")), '{"query":"keep until saved"}');
  assert.equal(denied.getItem(canonical("A")), null);
});

test("Last opened history preserves valid timestamps while rejecting malformed and oversized data", () => {
  for (const raw of [null, "null", "[]", "{", " ".repeat(1024 * 1024 + 1)])
    assert.deepEqual(parseProjectOpenedHistory(raw), {});
  const old = { first: 1700000000000, second: 1800000000000 };
  assert.deepEqual(parseProjectOpenedHistory(JSON.stringify(old)), old);
  assert.deepEqual(
    parseProjectOpenedHistory(
      '{"good":123,"bad":"456","negative":-1,"huge":9e16,"nan":null,"__proto__":5}',
    ),
    { good: 123 },
  );
  const many = Object.fromEntries(
    Array.from({ length: MAX_PROJECT_OPENED_ENTRIES + 2 }, (_, i) => [`p${i}`, i]),
  );
  const bounded = parseProjectOpenedHistory(JSON.stringify(many));
  assert.equal(Object.keys(bounded).length, MAX_PROJECT_OPENED_ENTRIES);
  assert.equal(bounded.p0, undefined);
  assert.equal(bounded.p1, undefined);
  assert.equal(bounded[`p${MAX_PROJECT_OPENED_ENTRIES + 1}`], MAX_PROJECT_OPENED_ENTRIES + 1);
});

test("canonical and legacy Projects cleanup preserves another account and guest state", () => {
  const owners = ["A", "B", null];
  const sessionStorage = memoryStorage(
    owners.flatMap((owner) => [
      [canonical(owner), "private"],
      [legacy(owner), "legacy"],
    ]),
  );
  const localStorage = memoryStorage(
    owners.map((owner) => [`kova-project-opened:${owner}`, "history"]),
  );
  clearPrincipalBrowserStorage("A", { sessionStorage, localStorage });
  assert.equal(sessionStorage.getItem(canonical("A")), null);
  assert.equal(sessionStorage.getItem(legacy("A")), null);
  assert.equal(localStorage.getItem("kova-project-opened:A"), null);
  for (const owner of ["B", null]) {
    assert.equal(sessionStorage.getItem(canonical(owner)), "private");
    assert.equal(sessionStorage.getItem(legacy(owner)), "legacy");
    assert.equal(localStorage.getItem(`kova-project-opened:${owner}`), "history");
  }
});

const source = readFileSync(new URL("../../src/routes/projects.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "projects.tsx",
  source,
  ts.ScriptTarget.ESNext,
  true,
  ts.ScriptKind.TSX,
);
function find(predicate) {
  let found;
  function visit(node) {
    if (predicate(node)) found = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found, "expected route node exists");
  return found;
}
function compile(expression, args) {
  const code = ts.transpileModule(`return (${expression});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(args), code)(...Object.values(args));
}

test("Projects retains actual Last opened ordering and last-activity fallback", () => {
  const declaration = find(
    (node) => ts.isVariableDeclaration(node) && node.name.getText(ast) === "sortFn",
  );
  const records = [
    { id: "older-visit", name: "Alpha", updated_at: "2026-01-03" },
    { id: "newer-visit", name: "Beta", updated_at: "2026-01-01" },
    { id: "never-opened", name: "Gamma", updated_at: "2026-01-04" },
  ];
  const sort = compile(declaration.initializer.getText(ast), {
    sortBy: "opened",
    openedProjects: { "older-visit": 10, "newer-visit": 20 },
  });
  assert.deepEqual(
    [...records].sort(sort).map((item) => item.id),
    ["newer-visit", "older-visit", "never-opened"],
  );
  const fallback = compile(declaration.initializer.getText(ast), {
    sortBy: "opened",
    openedProjects: {},
  });
  assert.deepEqual(
    [...records].sort(fallback).map((item) => item.id),
    ["never-opened", "older-visit", "newer-visit"],
  );
});

test("opening after cleanup cannot resurrect the old mounted visit history", () => {
  const link = find(
    (node) =>
      ts.isJsxOpeningElement(node) &&
      node.attributes.properties.some(
        (prop) =>
          ts.isJsxAttribute(prop) &&
          prop.name.getText(ast) === "className" &&
          prop.initializer?.getText(ast) === '"kova-project-file-link"',
      ),
  );
  const onClick = link.attributes.properties.find(
    (prop) => ts.isJsxAttribute(prop) && prop.name.getText(ast) === "onClick",
  );
  const storage = memoryStorage();
  let state;
  const currentUserKeyRef = { current: "A" };
  const open = compile(onClick.initializer.expression.getText(ast), {
    isLoaded: true,
    userKey: "A",
    currentUserKeyRef,
    safeBrowserStorage: () => storage,
    parseProjectOpenedHistory,
    setOpenedHistory: (next) => {
      state = next;
    },
    p: { id: "new-visit" },
    Date: { now: () => 2000 },
  });
  open();
  assert.deepEqual(JSON.parse(storage.getItem("kova-project-opened:A")), { "new-visit": 2000 });
  assert.deepEqual(state, { userKey: "A", entries: { "new-visit": 2000 } });
  currentUserKeyRef.current = "B";
  open();
  assert.equal(
    storage.writes.length,
    1,
    "an outgoing account handler cannot write after the switch",
  );
});

test("mounted history cleanup resets only the current resolved owner without a storage write", () => {
  const declaration = find(
    (node) => ts.isVariableDeclaration(node) && node.name.getText(ast) === "reset",
  );
  const currentUserKeyRef = { current: "A" };
  let state;
  const reset = compile(declaration.initializer.getText(ast), {
    userKey: "A",
    currentUserKeyRef,
    isPrincipalBrowserStorageClearedEvent,
    setOpenedHistory: (next) => {
      state = next;
    },
  });
  reset({ detail: { principal: "user:B" } });
  assert.equal(state, undefined);
  reset({ detail: { principal: "user:A" } });
  assert.deepEqual(state, { userKey: "A", entries: {} });
  state = undefined;
  currentUserKeyRef.current = "B";
  reset({ detail: { principal: "user:A" } });
  assert.equal(state, undefined);
});

test("route migrates before hydration and no longer uses global view or raw session persistence", () => {
  assert.ok(
    source.indexOf("if (isLoaded) migrateProjectListPreferences") <
      source.indexOf("usePrincipalSessionPreferences(", source.indexOf("function ProjectsPage")),
  );
  assert.match(source, /isLoaded \? userKey : undefined/);
  assert.match(source, /maxLength=\{MAX_MANAGEMENT_QUERY_LENGTH\}/);
  assert.match(source, /isPrincipalBrowserStorageClearedEvent\(event, userKey\)/);
  assert.doesNotMatch(
    source,
    /kova-projects-view|\bsessionStorage\.(getItem|setItem)|\blocalStorage\.(getItem|setItem)/,
  );
  assert.doesNotMatch(source, /setSortBy\("opened"\)|setScope\("all"\)|setShowArchived\(false\)/);
});
