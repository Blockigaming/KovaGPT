import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createHookHarness } from "../helpers/ui-state-harness.mjs";
import * as storagePolicy from "../../src/lib/principal-browser-storage.mjs";

const source = readFileSync("src/routes/library.tsx", "utf8");
const organizer = readFileSync("src/components/LibraryFolderOrganizer.tsx", "utf8");
function parsedNodes(source, name) {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nodes = [];
  const visit = (node) => {
    nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { file, nodes };
}
const route = parsedNodes(source, "library.tsx");
const folders = parsedNodes(organizer, "folders.tsx");
const effect = (parsed, marker) => {
  const matches = parsed.nodes.filter(
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText(parsed.file) === "useEffect" &&
      node.arguments[0]?.getText(parsed.file).includes(marker),
  );
  assert.equal(matches.length, 1, marker);
  return matches[0];
};
const compile = (code, deps) =>
  new Function(
    ...Object.keys(deps),
    ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
  )(...Object.values(deps));
const identityEffect = effect(route, "const savedFolder").getText(route.file);
const cleanupEffect = effect(route, "const reset = (event: Event)").getText(route.file);
const saveEffect = effect(route, "JSON.stringify({\n          query,").getText(route.file);
const preferenceNames = [
  "query",
  "searchQuery",
  "libraryCleared",
  "filter",
  "sourceFilter",
  "dateFilter",
  "sort",
  "folderScopeState",
  "folderScopeReady",
  "folderScope",
  "setFolderScope",
];
const preferenceStatements = route.nodes
  .filter((node) => {
    if (!ts.isVariableStatement(node)) return false;
    return node.declarationList.declarations.some((declaration) => {
      const name = ts.isArrayBindingPattern(declaration.name)
        ? declaration.name.elements[0].getText(route.file)
        : declaration.name.getText(route.file);
      return preferenceNames.includes(name);
    });
  })
  .map((node) => node.getText(route.file))
  .join("\n");
const uuid = route.nodes
  .find(
    (node) => ts.isVariableDeclaration(node) && node.name.getText(route.file) === "UUID_PATTERN",
  )
  .initializer.getText(route.file);
const folderA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const folderB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const key = (owner) => `kova-library-filters:${storagePolicy.browserStoragePrincipal(owner)}`;
const saved = (folder) => ({
  query: "invoice",
  filter: "documents",
  sort: "name",
  source: "upload",
  date: "30",
  folder,
});

function memoryStorage(entries = []) {
  const values = new Map(entries);
  const reads = [],
    writes = [];
  return {
    reads,
    writes,
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem(name) {
      reads.push(name);
      return values.get(name) ?? null;
    },
    setItem(name, value) {
      writes.push([name, value]);
      values.set(name, value);
    },
    removeItem: (name) => values.delete(name),
  };
}

// Execute the actual route's scoped state and hydration/write/cleanup effects.
// Unrelated item/detail/share setters are inert; no DOM, fetch, or browser runs.
function fixture(storage = memoryStorage(), owner = "A", loaded = true) {
  const hooks = createHookHarness();
  const listeners = new Map();
  const principalRef = { current: null };
  const refs = Object.fromEntries(
    [
      "lifecycleGenerationRef",
      "loadGenerationRef",
      "shareLoadGenerationRef",
      "retryReturnRef",
      "pageCursor",
      "previewReturnFocusRef",
      "versionReturnFocusRef",
      "bulkDeleteRef",
      "previewOriginRef",
      "detailHistoryRef",
    ].map((name) => [name, { current: 0 }]),
  );
  const noop = () => {};
  const setters = Object.fromEntries(
    [
      "setNextPage",
      "setVersionItem",
      "setBulkDeleteBusy",
      "setUploadOpen",
      "setPreviewItem",
      "setStorageDetailsOpen",
      "setSelected",
      "setLoadError",
      "setSharedPreview",
      "setPendingRevokeShare",
      "setRevokingShareId",
      "setShareState",
      "setFavorites",
      "setFavoritesPrincipal",
      "setItemState",
      "setLoading",
    ].map((name) => [name, noop]),
  );
  const dependencies = {
    ...hooks.react,
    ...refs,
    ...setters,
    ...storagePolicy,
    principalRef,
    pageRequests: { current: new Set() },
    safeBrowserStorage: () => storage,
    readFavorites: () => new Set(),
    window: {
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: (name) => listeners.delete(name),
    },
  };
  const renderPreferences = compile(
    `const UUID_PATTERN = ${uuid};
     return function({principal, userKey, isLoaded, principalReady}) {
       principalRef.current = principal;
       const favoritesKey = principal ? "fixture-favorites:" + principal : null;
       ${preferenceStatements}
       ${identityEffect};
       ${cleanupEffect};
       ${saveEffect};
       return {query, searchQuery, filter, sort, source: sourceFilter, date: dateFilter,
         folder: folderScope, folderScopeReady, libraryCleared, setFolderScope};
     };`,
    dependencies,
  );
  const props = {
    userKey: owner,
    principal: loaded ? storagePolicy.browserStoragePrincipal(owner) : null,
    isLoaded: loaded,
    principalReady: loaded,
  };
  return {
    storage,
    props,
    render: () => hooks.render(renderPreferences, props),
    switchOwner(next, resolved = true) {
      props.userKey = next;
      props.isLoaded = resolved;
      props.principal = resolved ? storagePolicy.browserStoragePrincipal(next) : null;
      props.principalReady = resolved;
    },
    clear(owner) {
      storagePolicy.clearPrincipalBrowserStorage(owner, {
        localStorage: memoryStorage(),
        sessionStorage: storage,
      });
      listeners.get(storagePolicy.PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT)?.({
        detail: { principal: storagePolicy.browserStoragePrincipal(owner) },
      });
    },
    resetCallback: () => listeners.get(storagePolicy.PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT),
    unmount: () => hooks.unmount(),
  };
}

function values(snapshot) {
  return Object.fromEntries(Object.keys(saved("all")).map((name) => [name, snapshot[name]]));
}

test("existing principal record restores folder and unchanged filters on same-owner remount/Back", () => {
  for (const scope of ["all", "unfiled", folderA]) {
    const storage = memoryStorage([[key("A"), JSON.stringify(saved(scope))]]);
    const f = fixture(storage);
    f.props.principalReady = false; // Item loading/error must not own preference hydration.
    assert.equal(f.render().folder, "all");
    assert.equal(storage.writes.length, 0, "initial render cannot erase the saved scope");
    assert.deepEqual(values(f.render()), saved(scope));
    f.render().setFolderScope(folderB);
    assert.deepEqual(values(f.render()), saved(folderB));
    f.unmount();
    const back = fixture(storage);
    back.render();
    assert.deepEqual(values(back.render()), saved(folderB));
    assert.equal(JSON.parse(storage.getItem(key("A"))).folder, folderB);
  }
});

test("account change hides old folder before effects and rejects outgoing callbacks", () => {
  const storage = memoryStorage([
    [key("A"), JSON.stringify(saved(folderA))],
    [key("B"), JSON.stringify({ ...saved(folderB), query: "B query" })],
  ]);
  const f = fixture(storage);
  f.render();
  const staleSetScope = f.render().setFolderScope;
  const staleReset = f.resetCallback();
  f.switchOwner("B");
  const writesBeforeSwitch = storage.writes.length;
  const changed = f.render();
  assert.equal(changed.folder, "all");
  assert.equal(changed.folderScopeReady, false);
  assert.equal(storage.writes.length, writesBeforeSwitch);
  staleSetScope(folderA);
  staleReset({ detail: { principal: storagePolicy.browserStoragePrincipal("A") } });
  assert.equal(f.render().folder, folderB);
  assert.equal(f.render().libraryCleared, false);
  assert.equal(f.render().searchQuery, "B query");
  assert.equal(JSON.parse(storage.getItem(key("B"))).folder, folderB);
  f.switchOwner(null);
  assert.equal(f.render().folder, "all");
  assert.equal(f.render().folder, "all");
});

test("unresolved auth never reads preferences or writes incoming defaults", () => {
  const storage = memoryStorage([[key("A"), JSON.stringify(saved(folderA))]]);
  const f = fixture(storage, "A", false);
  f.render();
  assert.equal(f.render().folder, "all");
  assert.equal(storage.reads.length, 0);
  assert.equal(storage.writes.length, 0);
  f.switchOwner("A");
  assert.equal(f.render().folderScopeReady, false);
  assert.equal(storage.writes.length, 0);
  assert.equal(f.render().folder, folderA);
});

test("malformed or unsupported saved scopes default safely; canonical durable IDs restore", () => {
  for (const raw of [
    "{",
    "null",
    "[]",
    "42",
    '"text"',
    "{}",
    ...["retired", "chat:private", "../../private", "A".repeat(10000), 42, null, {}, []].map(
      (folder) => JSON.stringify({ folder }),
    ),
  ]) {
    const f = fixture(memoryStorage([[key("A"), raw]]));
    assert.doesNotThrow(() => f.render());
    assert.equal(f.render().folder, "all", raw.slice(0, 100));
  }
  const f = fixture(memoryStorage([[key("A"), JSON.stringify(saved(folderA.toUpperCase()))]]));
  f.render();
  assert.equal(f.render().folder, folderA);
  const guest = fixture(memoryStorage([[key(null), JSON.stringify(saved(folderA))]]), null);
  guest.render();
  assert.equal(guest.render().folder, "all");
});

test("owned-folder validator clears missing/deleted/foreign IDs only after successful load", () => {
  const validator = effect(folders, 'scope !== "all"').arguments[0].getText(folders.file);
  const storage = memoryStorage([[key("A"), JSON.stringify(saved(folderA))]]);
  const f = fixture(storage);
  f.render();
  const validate = (changes = {}) => {
    const state = f.render();
    compile(`return (${validator});`, {
      scope: state.folder,
      folders: [{ id: folderA }],
      foldersLoaded: true,
      loading: false,
      error: null,
      onScopeChange: state.setFolderScope,
      ...changes,
    })();
  };
  validate();
  assert.equal(f.render().folder, folderA);
  for (const change of [
    { foldersLoaded: false },
    { loading: true },
    { error: "Folder service unavailable" },
  ]) {
    validate({ folders: [], ...change });
    assert.equal(f.render().folder, folderA, "incomplete/failed load is not proof of deletion");
  }
  for (const missing of [folderA, folderB]) {
    f.render().setFolderScope(missing);
    validate({ folders: [] });
    assert.equal(f.render().folder, "all");
    assert.equal(JSON.parse(storage.getItem(key("A"))).folder, "all");
  }
  for (const scope of ["all", "unfiled"]) {
    f.render().setFolderScope(scope);
    validate({ folders: [] });
    assert.equal(f.render().folder, scope);
  }
  assert.match(source, /<LibraryFolderOrganizer\s+key=\{principal\}/);
  assert.match(
    organizer,
    /if \(generationRef.current !== generation\) return;\s*setFolders\(next\)/,
  );
  const service = readFileSync("src/routes/api/library/folders.ts", "utf8");
  assert.match(service, /\.eq\("user_id", auth.userId\)/);
});

test("matching cleanup resets all filter state without recreating the deleted record", () => {
  const storage = memoryStorage([
    [key("A"), JSON.stringify(saved(folderA))],
    [key("B"), JSON.stringify(saved(folderB))],
  ]);
  const f = fixture(storage);
  f.render();
  f.render();
  f.clear("B");
  assert.equal(f.render().folder, folderA);
  f.clear("A");
  const writesBeforeReset = storage.writes.length;
  const reset = f.render();
  assert.deepEqual(values(reset), {
    query: "",
    filter: "all",
    sort: "newest",
    source: "all",
    date: "all",
    folder: "all",
  });
  assert.equal(reset.libraryCleared, true);
  assert.equal(reset.searchQuery, "");
  f.render();
  assert.equal(storage.writes.length, writesBeforeReset);
  assert.equal(storage.getItem(key("A")), null);
  const remounted = fixture(storage);
  remounted.render();
  assert.equal(remounted.render().folder, "all");
});

test("unavailable preference storage remains optional and requests await current hydration", () => {
  for (const storage of [
    null,
    {
      getItem() {
        throw Error("denied");
      },
      setItem() {
        throw Error("denied");
      },
    },
  ]) {
    const f = fixture(storage);
    assert.doesNotThrow(() => f.render());
    assert.equal(f.render().folder, "all");
    f.render().setFolderScope(folderA);
    assert.equal(f.render().folder, folderA);
  }
  const load = route.nodes.find(
    (node) => ts.isVariableDeclaration(node) && node.name.getText(route.file) === "load",
  ).initializer.arguments[0];
  const firstStatements = load.body.statements.slice(0, 2).map((node) => node.getText(route.file));
  const guard = compile(`return () => { ${firstStatements.join("\n")} return "loaded"; };`, {
    loadGenerationRef: { current: 0 },
    isLoaded: true,
    principal: "user:B",
    folderScopeReady: false,
    libraryCleared: false,
    isSignedIn: true,
    userKey: "B",
  });
  assert.equal(guard(), undefined);
  assert.match(load.getText(route.file), /folder: folderScope/);
  assert.match(load.getText(route.file), /cursor: more \? pageCursor.current : null/);
});
