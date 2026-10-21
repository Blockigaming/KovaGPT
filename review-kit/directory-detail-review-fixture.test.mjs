import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  createDirectoryPluginReviewHandler,
  DIRECTORY_PLUGIN_REVIEW_OPTIONS,
  DIRECTORY_REVIEW_DETAIL_ID as id,
  DIRECTORY_PLUGIN_REVIEW_OWNER as owner,
} from "./directory-plugin-review-fixture.mjs";
import {
  FIXTURE_ORIGIN,
  BACKEND_ORIGIN,
  FixtureRegistry,
  createFixtureSession,
  loadReviewPackage,
} from "./private-http-review.mjs";
import * as catalog from "./review-state-fixtures.mjs";
import { fetchForPrincipal } from "../src/lib/chat-summary-snapshot.mjs";
const scenario = "assistant-directory-detail";
const directory = "/api/kovas/directory";
const detail = `/api/kovas?scope=read&id=${id}`;
const headers = { "x-kova-owner": owner };
const source = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
function fixture(account = "pro") {
  const registry = new FixtureRegistry();
  const state = { active: true };
  registry.route(
    "**/*",
    createDirectoryPluginReviewHandler(scenario, account, new Map(), {
      isActive: () => state.active,
      wait: () => assert.fail("This completed read must not use a hold"),
    }),
  );
  return { registry, state };
}
const read = (review, path, extra = {}) =>
  review.registry.dispatch({ url: FIXTURE_ORIGIN + path, headers, ...extra });
const assertError = (value, status) => {
  assert.equal(value.status, status);
  assert.deepEqual(Object.keys(value.json), ["error"]);
};

test("one public directory card maps through the ordinary route to an exact non-owner read DTO", async () => {
  const review = fixture();
  const result = await read(review, directory, { headers: {} });
  assert.equal(result.status, 200);
  assert.equal(result.json.rows.length, 1);
  const card = result.json.rows[0];
  assert.equal(card.id, id);
  assert.equal(card.owned, false);
  assert.equal(card.config.allowFork, false);
  assert.match(card.config.description, /Synthetic read-only/);
  assert.match(card.config.description, /Not a published assistant/);
  const detailResult = await read(review, detail);
  assert.equal(detailResult.status, 200);
  assert.equal(detailResult.headers["Cache-Control"], "no-store");
  assert.deepEqual(detailResult.json, {
    id: card.id,
    owned: false,
    revision: card.revision,
    visibility: card.visibility,
    blocked: card.blocked,
    versionId: card.version_id,
    publicationVersion: card.version_id,
    config: card.config,
    knowledge: [],
  });
  assert.deepEqual(card.config.tools, []);
  assert.deepEqual(card.config.apps, []);
  assert.deepEqual(card.config.starters, []);
  for (const key of ["instructions", "knowledge"])
    assert.equal(Object.hasOwn(card.config, key), false);
  assert.deepEqual((await read(review, "/api/kovas?scope=owned")).json, { rows: [] });
  card.config.name = "changed response copy";
  detailResult.json.knowledge.push({ title: "untrusted copy" });
  assert.notEqual((await read(review, detail)).json.config.name, card.config.name);
  assert.deepEqual((await read(review, detail)).json.knowledge, []);
  const page = source("src/routes/assistants.tsx");
  assert.ok(page.includes('to={"/kovas" as never}'));
  assert.ok(page.includes("search={{ id: item.id } as never}"));
  const workspace = source("src/routes/kovas.tsx");
  assert.ok(workspace.includes("`/api/kovas?scope=read&id=${id}`"));
  assert.match(workspace, /else void select\(initialId\)/);
  assert.match(workspace, /if \(!initialId \|\| !ownerId\) return/);
  const sql = source("supabase/migrations/20260905031401_custom_conversational_kovas.sql");
  assert.ok(sql.includes("ELSE v.config-'instructions'-'knowledge' END"));
  assert.ok(sql.includes("'versionId',v.id,'publicationVersion',k.publication_version"));
});

test("actual captured-principal transport keeps directory anonymous and detail account-bound with no external call", async () => {
  const review = fixture();
  const calls = [];
  const dependencies = {
    getSession: async () => ({
      data: { session: { user: { id: owner }, access_token: "synthetic-in-process-only" } },
    }),
    fetchImpl: async (path, init) => {
      calls.push({ path, credentials: init.credentials, owner: init.headers.get("X-Kova-Owner") });
      const response = await read(review, path, {
        method: init.method ?? "GET",
        headers: Object.fromEntries(init.headers),
        signal: init.signal,
      });
      return Response.json(response.json, { status: response.status });
    },
  };
  const card = (await (await fetchForPrincipal(null, directory, {}, dependencies)).json()).rows[0];
  assert.equal(card.id, id);
  const result = await fetchForPrincipal(owner, detail, {}, dependencies);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).id, card.id);
  assert.deepEqual(calls, [
    { path: directory, credentials: "omit", owner: null },
    { path: detail, credentials: "same-origin", owner },
  ]);
});

test("detail requires signed-in matching principal while Guest retains only the public sample", async () => {
  for (const account of ["free", "plus", "pro"]) {
    const review = fixture(account);
    assert.equal((await read(review, detail)).status, 200);
    for (const bad of [{}, { "x-kova-owner": "other" }]) {
      assertError(await read(review, detail, { headers: bad }), 401);
      assertError(await read(review, "/api/kovas?scope=owned", { headers: bad }), 401);
    }
  }
  const guest = fixture("guest");
  assert.equal((await read(guest, directory, { headers: {} })).json.rows.length, 1);
  assertError(await read(guest, detail), 401);
  assertError(await read(guest, "/api/kovas?scope=owned"), 401);
});

test("unknown identity, scope, pagination, duplicate queries, bodies and methods are rejected", async () => {
  const review = fixture();
  for (const bad of ["unknown", owner, "91919191-9191-4919-8919-000000000002"])
    assertError(await read(review, "/api/kovas?scope=read&id=" + bad), 404);
  for (const path of [
    "/api/kovas",
    "/api/kovas?scope=read",
    detail + "&id=" + id,
    detail + "&scope=read",
    detail + "&versionId=" + id,
    detail + "&after=" + id,
    "/api/kovas?scope=versions&id=" + id,
    "/api/kovas?scope=version&id=" + id,
    "/api/kovas?scope=knowledge",
    "/api/kovas?scope=owned&id=" + id,
    directory + "?after=" + id,
    directory + "?query=Writing",
  ])
    assertError(await read(review, path), 400);
  for (const path of [directory, detail, "/api/kovas?scope=owned"]) {
    assertError(await read(review, path, { body: Buffer.from("{}") }), 400);
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"])
      assertError(await read(review, path, { method }), 405);
  }
  const abort = new AbortController();
  abort.abort();
  assertError(await read(review, detail, { signal: abort.signal }), 499);
  review.state.active = false;
  assertError(await read(review, detail), 401);
  assertError(await read(review, directory, { headers: {} }), 401);
});

test("all custom Kova mutations and provider/chat routes remain blocked without changing the detail", async () => {
  const review = fixture();
  const before = await read(review, detail);
  for (const action of [
    "create",
    "save",
    "restore",
    "deleteVersion",
    "publish",
    "unpublish",
    "delete",
    "fork",
    "claimLink",
    "report",
  ])
    assertError(
      await read(review, "/api/kovas", {
        method: "POST",
        body: Buffer.from(JSON.stringify({ action, id, revision: 1, payload: {} })),
      }),
      405,
    );
  for (const path of [
    "/api/kovas/detail",
    "/api/admin/kovas",
    "/api/chat",
    "/api/chat/confirm",
    "/api/google/auth",
    "/api/google/status",
    "/api/auth/google/start",
    "/api/github/auth",
  ])
    for (const method of ["GET", "POST"])
      assertError(
        await read(review, path, {
          method,
          body: method === "POST" ? Buffer.from("{}") : Buffer.alloc(0),
        }),
        503,
      );
  assert.deepEqual(await read(review, detail), before);
});

assert.ok(process.env.KOVA_REVIEW_PACKAGE, "Set KOVA_REVIEW_PACKAGE to an existing review package");
const pkg = { ...(await loadReviewPackage(process.env.KOVA_REVIEW_PACKAGE)), state: catalog };
const selection = {
  scenario,
  account: "pro",
  theme: "light",
  path: "/",
  size: "desktop",
  state: "populated",
};

test("packaged registry and scenario catalog install only the labeled detail overlay and close on reset/logout", async () => {
  const option = DIRECTORY_PLUGIN_REVIEW_OPTIONS.find((value) => value.id === scenario);
  assert.equal(option.path, "/assistants");
  assert.match(option.label, /one synthetic card and read-only detail/);
  await assert.rejects(catalog.installReviewState({}, scenario, "pro"), /private HTTP/);
  assert.match(source("review-kit/package.mjs"), /"directory-plugin-review-fixture.mjs"/);
  for (const account of option.accounts) {
    const session = await createFixtureSession(pkg, { ...selection, account });
    assert.equal(session.selection.path, "/assistants");
    assert.equal((await read(session, directory, { headers: {} })).json.rows.length, 1);
    assert.equal((await read(session, detail)).status, account === "guest" ? 401 : 200);
    session.dispose();
    assertError(await read(session, detail), 401);
  }
  const session = await createFixtureSession(pkg, selection);
  session.authActive = false;
  assertError(await read(session, detail), 401);
  session.dispose();
  const logout = await createFixtureSession(pkg, selection);
  await logout.registry.dispatch({ url: BACKEND_ORIGIN + "/auth/v1/logout", method: "POST" });
  assertError(await read(logout, detail), 401);
  const reset = await createFixtureSession(pkg, selection);
  assert.equal((await read(reset, detail)).status, 200);
  reset.dispose();
  const unchanged = await createFixtureSession(pkg, {
    ...selection,
    scenario: "assistant-directory-populated",
  });
  assert.equal((await read(unchanged, directory)).json.rows.length, 21);
  assertError(await read(unchanged, detail), 503);
  unchanged.dispose();
});
