import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MAX_MANAGEMENT_PREFERENCES_LENGTH,
  MAX_MANAGEMENT_QUERY_LENGTH,
  parsePluginListPreferences,
  parseScheduledTaskListPreferences,
  PLUGIN_LIST_STORAGE_BASE,
  SCHEDULED_TASK_LIST_STORAGE_BASE,
} from "../../src/lib/management-list-preferences.mjs";
import {
  browserStoragePrincipal,
  clearPrincipalBrowserStorage,
  listPrincipalBrowserStorageKeys,
  principalScopedStorageKey,
  purgeUnscopedPrivateBrowserStorage,
} from "../../src/lib/principal-browser-storage.mjs";

const categories = ["Email", "Development", "Storage & Files"];
const taskDefaults = { query: "", filter: "active" };
const pluginDefaults = { query: "", category: "all", connectionFilter: "all" };

test("missing, malformed and oversized preferences fail closed to bounded defaults", () => {
  for (const raw of [
    null,
    undefined,
    "",
    "{bad",
    "null",
    "[]",
    "true",
    "42",
    '"query"',
    " ".repeat(MAX_MANAGEMENT_PREFERENCES_LENGTH + 1),
  ]) {
    assert.deepEqual(parseScheduledTaskListPreferences(raw), taskDefaults);
    assert.deepEqual(parsePluginListPreferences(raw, categories), pluginDefaults);
  }
});

test("task preferences retain only a bounded query and the supported filter", () => {
  for (const filter of ["active", "paused", "all"]) {
    assert.deepEqual(
      parseScheduledTaskListPreferences(
        JSON.stringify({
          query: "private query ".repeat(60),
          filter,
          tasks: [{ id: "task", status: "running" }],
          status: "running",
          count: 42,
          account: "A",
        }),
      ),
      { query: "private query ".repeat(60).slice(0, MAX_MANAGEMENT_QUERY_LENGTH), filter },
    );
  }
  assert.deepEqual(
    parseScheduledTaskListPreferences(JSON.stringify({ query: {}, filter: "running" })),
    taskDefaults,
  );
});

test("plugin preferences allow current catalog categories without retaining provider data", () => {
  assert.deepEqual(
    parsePluginListPreferences(
      JSON.stringify({
        query: "drive",
        category: "Storage & Files",
        connectionFilter: "connected",
        accounts: [{ email: "private@example.invalid", scope: "read" }],
        status: "connected",
        count: 2,
        scopes: ["read"],
      }),
      categories,
    ),
    { query: "drive", category: "Storage & Files", connectionFilter: "connected" },
  );
  for (const category of ["retired", {}, null, "x".repeat(121)]) {
    assert.deepEqual(
      parsePluginListPreferences(
        JSON.stringify({ category, connectionFilter: "failed" }),
        categories,
      ),
      pluginDefaults,
    );
  }
  assert.equal(
    parsePluginListPreferences(JSON.stringify({ query: "a".repeat(900) }), categories).query.length,
    MAX_MANAGEMENT_QUERY_LENGTH,
  );
});

function storage(entries) {
  const values = new Map(entries);
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
  };
}

function preferenceKeys(owner) {
  return {
    local: [`kova-project-opened:${owner}`],
    session: [
      principalScopedStorageKey(SCHEDULED_TASK_LIST_STORAGE_BASE, owner),
      principalScopedStorageKey(PLUGIN_LIST_STORAGE_BASE, owner),
      `kova-project-list:${owner}`,
      `kova-library-filters:${browserStoragePrincipal(owner)}`,
    ],
  };
}

test("cleanup registers new session preferences and exact legacy owner keys", () => {
  for (const owner of ["A", "account/a:odd", null]) {
    const plan = listPrincipalBrowserStorageKeys(owner, { purgeUnscopedPrivate: false });
    for (const key of preferenceKeys(owner).local) assert.ok(plan.localExact.includes(key));
    for (const key of preferenceKeys(owner).session) assert.ok(plan.sessionExact.includes(key));
  }
});

test("account and guest cleanup do not remove another principal's queries or device view", () => {
  const owners = ["A", "account/a:odd", null];
  for (const ownerToClear of owners) {
    const localStorage = storage([
      ...owners.flatMap((owner) => preferenceKeys(owner).local.map((key) => [key, "private"])),
      ["kova-projects-view", "list"],
      ["kova-library-view", "grid"],
    ]);
    const sessionStorage = storage(
      owners.flatMap((owner) => preferenceKeys(owner).session.map((key) => [key, "private query"])),
    );
    const options = { localStorage, sessionStorage };
    purgeUnscopedPrivateBrowserStorage(ownerToClear, options);
    for (const owner of owners) {
      for (const key of preferenceKeys(owner).session)
        assert.equal(sessionStorage.getItem(key), "private query");
    }
    clearPrincipalBrowserStorage(ownerToClear, options);
    for (const owner of owners) {
      for (const key of preferenceKeys(owner).session) {
        assert.equal(sessionStorage.getItem(key), owner === ownerToClear ? null : "private query");
      }
      for (const key of preferenceKeys(owner).local) {
        assert.equal(localStorage.getItem(key), owner === ownerToClear ? null : "private");
      }
    }
    assert.equal(localStorage.getItem("kova-projects-view"), "list");
    assert.equal(localStorage.getItem("kova-library-view"), "grid");
  }
});

test("routes use principal session preferences, bounded inputs and no identity-effect resets", () => {
  for (const route of ["scheduled-tasks", "apps"]) {
    const source = readFileSync(new URL(`../../src/routes/${route}.tsx`, import.meta.url), "utf8");
    assert.match(source, /usePrincipalSessionPreferences\(/);
    assert.match(source, /isLoaded \? userKey : undefined/);
    assert.match(source, /maxLength=\{MAX_MANAGEMENT_QUERY_LENGTH\}/);
    assert.doesNotMatch(source, /const \[query, setQuery\] = useState/);
    // The only remaining empty-query call is Plugins' explicit Clear filters action.
    assert.equal((source.match(/setQuery\(""\)/g) ?? []).length, route === "apps" ? 1 : 0);
  }
});
