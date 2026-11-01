import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";

const source = stripTypeScriptTypes(readFileSync("tests/e2e/authenticated-fixture.ts", "utf8"), {
  mode: "transform",
})
  .replace('import { functionNames } from "./server-function-fixture";', "")
  .replace(
    "export async function installAuthenticatedFixture",
    "async function installAuthenticatedFixture",
  );

function installer() {
  let sequence = 0;
  return vm.runInNewContext(`${source}\n({ installAuthenticatedFixture })`, {
    URL,
    crypto: { randomUUID: () => `fixture-${++sequence}` },
    functionNames: new Map([["fixture-owned-plan", "getMyPlanTier_fixture"]]),
  }).installAuthenticatedFixture;
}

async function pageFixture(install, context, options = { preserveStorageOnReload: true }) {
  const scripts = [];
  const routes = [];
  const page = {
    context: () => context,
    locator: () => ({ filter: () => ({}) }),
    addLocatorHandler: async () => {},
    addInitScript: async (run, args) => scripts.push({ run, args }),
    route: async (pattern, handler) => routes.push({ pattern, handler }),
  };
  await install(page, options);
  assert.equal(scripts.length, 1);
  return { script: scripts[0], routes };
}

function documentProfile(localValues = new Map(), sessionValues = new Map()) {
  let localClears = 0;
  class Storage {
    constructor(values, local) {
      this.values = values;
      this.local = local;
    }
    getItem(key) {
      return this.values.get(String(key)) ?? null;
    }
    setItem(key, value) {
      this.values.set(String(key), String(value));
    }
    clear() {
      if (this.local) localClears++;
      this.values.clear();
    }
  }
  const localStorage = new Storage(localValues, true);
  const sessionStorage = new Storage(sessionValues, false);
  return {
    localStorage,
    sessionValues,
    localClears: () => localClears,
    initialize({ run, args }) {
      // Playwright serializes this exact callback into each document. Give
      // tabs their own Storage prototype/session area and one shared origin.
      const callback = vm.runInNewContext(`(${run.toString()})`, {
        localStorage,
        sessionStorage,
        Storage,
        btoa,
      });
      callback(args);
    },
  };
}

test("opening another returning-user tab preserves the first tab's saved appearance", async () => {
  const install = installer(),
    context = {},
    local = new Map([["old-test-data", "discard"]]);
  const first = await pageFixture(install, context);
  const firstDocument = documentProfile(local);
  firstDocument.initialize(first.script);
  assert.equal(firstDocument.localClears(), 1);
  assert.equal(local.has("old-test-data"), false);
  const settingsKey = "nova-gpt-settings-v1:22222222-2222-4222-8222-222222222222";
  const saved = JSON.stringify({ mode: "light", readingSize: 18 });
  firstDocument.localStorage.setItem(settingsKey, saved);
  const second = await pageFixture(install, context);
  const secondDocument = documentProfile(local);
  secondDocument.initialize(second.script);
  assert.equal(
    secondDocument.localClears(),
    0,
    "a new tab must not clear a shared returning profile",
  );
  assert.equal(secondDocument.localStorage.getItem(settingsKey), saved);
});

test("reload retains the returning profile without depending on tab session storage", async () => {
  const install = installer(),
    local = new Map();
  const page = await pageFixture(install, {});
  const first = documentProfile(local);
  first.initialize(page.script);
  first.localStorage.setItem("saved-draft", "keep this draft");
  const reload = documentProfile(local, first.sessionValues);
  reload.initialize(page.script);
  assert.equal(reload.localClears(), 0);
  assert.equal(reload.localStorage.getItem("saved-draft"), "keep this draft");
});

test("concurrently registered tabs use one returning profile and do not erase each other", async () => {
  const install = installer(),
    context = {},
    local = new Map();
  const [first, second] = await Promise.all([
    pageFixture(install, context),
    pageFixture(install, context),
  ]);
  const a = documentProfile(local);
  a.initialize(first.script);
  a.localStorage.setItem("saved-preference", "large");
  const b = documentProfile(local);
  b.initialize(second.script);
  assert.equal(b.localClears(), 0);
  assert.equal(b.localStorage.getItem("saved-preference"), "large");
});

test("a different browser context still starts clean even if storage was copied", async () => {
  const install = installer(),
    local = new Map();
  const first = await pageFixture(install, {});
  const a = documentProfile(local);
  a.initialize(first.script);
  a.localStorage.setItem("other-test-data", "must not leak");
  const second = await pageFixture(install, {});
  const b = documentProfile(local);
  b.initialize(second.script);
  assert.equal(b.localClears(), 1);
  assert.equal(b.localStorage.getItem("other-test-data"), null);
});

test("nonpersistent fixtures continue to reset storage on every document", async () => {
  const install = installer(),
    local = new Map();
  const page = await pageFixture(install, {}, {});
  const a = documentProfile(local);
  a.initialize(page.script);
  a.localStorage.setItem("temporary", "discard on navigation");
  const b = documentProfile(local, a.sessionValues);
  b.initialize(page.script);
  assert.equal(b.localClears(), 1);
  assert.equal(b.localStorage.getItem("temporary"), null);
});

test("the fixture still blocks unsupported backend requests instead of reaching real services", async () => {
  const install = installer();
  const page = await pageFixture(install, {});
  let aborted = null;
  const requestUrl = "https://aaaaaaaaaaaaaaaaaaaa.supabase.co/not-a-mocked-path";
  const backend = page.routes.find(
    ({ pattern }) => typeof pattern?.test === "function" && pattern.test(requestUrl),
  );
  assert.ok(backend, "the backend isolation route must be installed");
  await backend.handler({
    request: () => ({ url: () => requestUrl }),
    abort: async (reason) => {
      aborted = reason;
    },
    fulfill: async () => {
      throw new Error("unsupported requests must not be fulfilled");
    },
  });
  assert.equal(aborted, "blockedbyclient");
});

for (const tier of ["free", "plus", "pro"]) {
  test(`the ${tier} fixture returns an account-bound plan without a real backend call`, async () => {
    const page = await pageFixture(installer(), {}, { tier });
    const server = page.routes.find(({ pattern }) => pattern === "**/_serverFn/**");
    assert.ok(server);
    let response;
    await server.handler({
      request: () => ({ url: () => "https://example.invalid/_serverFn/fixture-owned-plan" }),
      fulfill: async (value) => {
        response = value.json;
      },
      fallback: async () => {
        throw new Error("owned plan fixture must not reach a backend");
      },
    });
    assert.deepEqual(JSON.parse(JSON.stringify(response)), {
      result: { ownerId: "22222222-2222-4222-8222-222222222222", tier },
      context: {},
    });
  });
}
