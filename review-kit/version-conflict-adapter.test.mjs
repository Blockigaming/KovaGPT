import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import * as catalog from "./review-state-fixtures.mjs";
import {
  BACKEND_ORIGIN,
  BACKEND_PREFIX,
  FIXTURE_ORIGIN,
  REVIEW_OWNER,
  createFixtureSession,
  createPrivateReviewServer,
  initialStorage,
  loadReviewPackage,
  reviewConversations,
} from "./private-http-review.mjs";
import {
  VERSION_CONFLICT_REVIEW_OPTIONS,
  VERSION_CONFLICT_CHAT_ID as chatId,
  VERSION_CONFLICT_MESSAGE_ID as messageId,
  VERSION_CONFLICT_DOCUMENT_ID as documentId,
  VERSION_CONFLICT_LIBRARY_ID as libraryId,
  VERSION_CONFLICT_LIBRARY_GENERATION as generation,
  VERSION_CONFLICT_INITIAL_CONTENT as initialContent,
  VERSION_CONFLICT_CURRENT_CONTENT as currentContent,
  versionConflictConversation,
  versionConflictLibraryItem,
} from "./version-conflict-review-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
assert.ok(process.env.KOVA_REVIEW_PACKAGE, "Set KOVA_REVIEW_PACKAGE to an existing review package");
const pkg = { ...(await loadReviewPackage(process.env.KOVA_REVIEW_PACKAGE)), state: catalog };
const defaults = {
  account: "pro",
  theme: "dark",
  state: "populated",
  path: "/",
  size: "phone",
  scenario: "result-version-conflict",
};
const sessionFor = (overrides = {}) => createFixtureSession(pkg, { ...defaults, ...overrides });
const tokenFor = (session) =>
  JSON.parse(initialStorage(session.selection, session.authIssuedAt)["sb-127-auth-token"])
    .access_token;
const request = (session, url, { method = "GET", body, headers = {} } = {}) =>
  session.registry.dispatch({
    url,
    method,
    body: body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body)),
    headers: {
      authorization: `Bearer ${tokenFor(session)}`,
      "x-kova-owner": REVIEW_OWNER,
      "content-type": "application/json",
      ...headers,
    },
  });
const rpc = (session, operation, data, options = {}) =>
  request(session, BACKEND_ORIGIN + "/rest/v1/rpc/collaboration_rpc", {
    method: "POST",
    body: { p_operation: operation, p_data: data },
    ...options,
  });
const open = { chatId, messageId, projectId: null, content: initialContent };
const save = { documentId, expectedRevision: 1, content: "Fictional unsaved integration draft." };
const libraryUrl = FIXTURE_ORIGIN + "/api/library/items";
const itemQuery = `?id=${libraryId}&generation=${generation}`;

test("conflict scenarios register only signed-in HTTP choices and Result history matches the active browser seed", async () => {
  for (const option of VERSION_CONFLICT_REVIEW_OPTIONS) {
    assert.deepEqual(
      catalog.REVIEW_STATE_OPTIONS.find((entry) => entry.id === option.id),
      option,
    );
    await assert.rejects(sessionFor({ account: "guest", scenario: option.id }), /requires/);
    await assert.rejects(catalog.installReviewState({}, option.id, "pro"), /HTTP review adapter/);
  }
  for (const account of ["free", "plus", "pro"]) {
    const session = await sessionFor({ account });
    assert.equal(session.selection.path, "/");
    const storage = initialStorage(session.selection, session.authIssuedAt);
    assert.equal(storage[`nova-gpt-pending-active:v2:user:${REVIEW_OWNER}`], chatId);
    const expected = reviewConversations("result-version-conflict");
    assert.deepEqual(expected.slice(0, 2), reviewConversations());
    assert.deepEqual(expected.at(-1), versionConflictConversation());
    assert.deepEqual(
      JSON.parse(storage[`nova-gpt-conversations-v3:user:${REVIEW_OWNER}`]),
      expected,
    );
    const records = [];
    let query = "";
    while (true) {
      const page = (await request(session, FIXTURE_ORIGIN + "/api/chat/history" + query)).json;
      records.push(...page.records);
      if (!page.hasMore) break;
      query = `?epoch=${page.epoch}&cursor=${page.nextCursor}`;
    }
    assert.deepEqual(
      records.map((record) => record.payload),
      expected,
    );
    assert.ok(records.every((record) => record.revision === 1));
    assert.deepEqual(reviewConversations("result-version-conflict", "empty"), expected);
    session.dispose();
  }
});

test("explicit RPC review sessions pin one synthetic token across delayed refresh; defaults keep current-time behavior", async () => {
  const normal = await sessionFor({ scenario: "default" });
  assert.equal(normal.authIssuedAt, undefined);
  normal.dispose();
  const originalNow = Date.now;
  try {
    Date.now = () => 1792400000000;
    for (const scenario of [
      "result-version-conflict",
      "library-version-conflict",
      "project-populated-archive-review",
    ]) {
      const session = await sessionFor({ scenario });
      const token = tokenFor(session);
      Date.now = () => session.authIssuedAt + 60_000;
      const refreshed = await session.registry.dispatch({
        url: BACKEND_ORIGIN + "/auth/v1/token?grant_type=refresh_token",
        method: "POST",
      });
      assert.equal(refreshed.status, 200);
      assert.ok(
        refreshed.json.access_token === token,
        "Refresh must retain this fixture's exact synthetic token",
      );
      const decoded = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
      assert.equal(decoded.iss, "private-local-review");
      assert.equal(decoded.sub, REVIEW_OWNER);
      assert.equal(decoded.iat, Math.floor(session.authIssuedAt / 1000));
      assert.equal(decoded.exp - decoded.iat, 86400);
      session.dispose();
    }
  } finally {
    Date.now = originalNow;
  }
});

test("registered Result RPC yields fixed revision 2 only after rejection and rejects wrong identity, token and stale session", async () => {
  const session = await sessionFor();
  assert.equal((await rpc(session, "open", open)).json.document.revision, 1);
  const failed = await rpc(session, "save", save);
  assert.equal(failed.status, 409);
  assert.equal(failed.json.code, "40001");
  assert.doesNotMatch(JSON.stringify(failed), /unsaved integration draft/);
  const current = await rpc(session, "get", { documentId });
  assert.equal(current.json.document.revision, 2);
  assert.equal(current.json.document.content, currentContent);
  assert.equal((await rpc(session, "open", { ...open, chatId: libraryId })).status, 400);
  assert.equal(
    (
      await rpc(
        session,
        "get",
        { documentId },
        { headers: { authorization: "Bearer other-synthetic-session" } },
      )
    ).status,
    401,
  );
  assert.equal((await rpc(session, "comment", { documentId, text: "No write" })).status, 503);
  assert.equal(
    (await request(session, FIXTURE_ORIGIN + "/api/chat", { method: "POST", body: {} })).status,
    503,
  );
  session.dispose();
  assert.equal((await rpc(session, "get", { documentId })).status, 401);
  const reset = await sessionFor();
  assert.equal((await rpc(reset, "open", open)).json.document.revision, 1);
  reset.dispose();
});

test("Library rejection preserves draft bytes while reopening and list reads expose fixed revision 2", async () => {
  const baseline = await sessionFor({ scenario: "default" });
  const listRequest = {
    method: "POST",
    body: { operation: "list", query: "", folder: "all", cursor: null },
  };
  const normal = await request(baseline, libraryUrl, listRequest);
  baseline.dispose();
  for (const account of ["free", "plus", "pro"]) {
    const session = await sessionFor({ account, scenario: "library-version-conflict" });
    assert.equal(session.selection.path, "/library");
    const list = await request(session, libraryUrl, listRequest);
    assert.deepEqual(
      list.json.items.filter((item) => item.id !== libraryId),
      normal.json.items,
    );
    assert.deepEqual(
      list.json.items.find((item) => item.id === libraryId),
      versionConflictLibraryItem(),
    );
    const before = await request(session, libraryUrl + itemQuery);
    assert.deepEqual(before.json, versionConflictLibraryItem());
    assert.equal(
      (await request(session, libraryUrl + itemQuery + "&history=1")).json.versions[0].revision,
      1,
    );
    const body = {
      operation: "replace_text",
      id: libraryId,
      generation,
      revision: 1,
      text: "Fictional Library draft.",
    };
    for (let attempt = 0; attempt < 2; attempt++)
      assert.equal((await request(session, libraryUrl, { method: "POST", body })).status, 409);
    const current = (await request(session, libraryUrl + itemQuery)).json;
    assert.deepEqual(current, versionConflictLibraryItem(2));
    assert.notEqual(current.content_text, body.text);
    assert.doesNotMatch(JSON.stringify(current), /Fictional Library draft/);
    assert.deepEqual(
      (await request(session, libraryUrl + itemQuery + "&revision=1")).json,
      before.json,
    );
    const refreshed = await request(session, libraryUrl, listRequest);
    assert.deepEqual(
      refreshed.json.items.find((item) => item.id === libraryId),
      current,
    );
    assert.deepEqual(
      refreshed.json.items.filter((item) => item.id !== libraryId),
      normal.json.items,
    );
    assert.deepEqual(
      (await request(session, libraryUrl + itemQuery + "&history=1")).json.versions.map(
        ({ revision }) => revision,
      ),
      [2, 1],
    );
    assert.equal(
      (await request(session, libraryUrl, { method: "POST", body: { ...body, revision: 2 } }))
        .status,
      409,
    );
    assert.deepEqual((await request(session, libraryUrl + itemQuery)).json, current);
    assert.equal(
      (
        await request(session, libraryUrl, {
          method: "POST",
          body: { ...body, operation: "delete" },
        })
      ).status,
      503,
    );
    assert.equal(
      (await request(session, libraryUrl + itemQuery, { headers: { "x-kova-owner": "other" } }))
        .status,
      401,
    );
    await session.registry.dispatch({ url: BACKEND_ORIGIN + "/auth/v1/logout", method: "POST" });
    assert.equal((await request(session, libraryUrl + itemQuery)).status, 401);
  }
  const reset = await sessionFor({ scenario: "library-version-conflict" });
  assert.deepEqual(
    (await request(reset, libraryUrl + itemQuery)).json,
    versionConflictLibraryItem(),
  );
  reset.dispose();
});

test("ordinary controller bootstrap and mocked refresh carry the same pinned token accepted by the HTTP fixture", async () => {
  const review = createPrivateReviewServer({
    pkg,
    port: 4792,
    fetchImpl: async () => assert.fail("No upstream needed"),
  });
  try {
    await review.listen();
    const control = await fetch(review.origin + "/__local-review");
    const csrf = /name="csrf" value="([^"]+)"/.exec(await control.text())[1];
    const cookie = control.headers.get("set-cookie").split(";")[0];
    const started = await fetch(review.origin + "/__local-review/start", {
      method: "POST",
      headers: { origin: review.origin, cookie },
      body: new URLSearchParams({ ...defaults, csrf }),
    });
    assert.equal(started.status, 200);
    const sessionCookie = started.headers.get("set-cookie").split(";")[0];
    const html = await started.text();
    assert.match(html, /No authored draft is saved or echoed/);
    const serialized = /Object\.entries\((\{"kova-theme-mode"[^]*?)\)\)localStorage\.setItem/.exec(
      html,
    )?.[1];
    assert.ok(serialized, "Explicit controller bootstrap must carry its ordinary storage seed");
    const storage = JSON.parse(serialized);
    const token = JSON.parse(storage["sb-127-auth-token"]).access_token;
    const refreshed = await fetch(
      review.origin + BACKEND_PREFIX + "/auth/v1/token?grant_type=refresh_token",
      { method: "POST", headers: { origin: review.origin, cookie: sessionCookie } },
    );
    assert.ok((await refreshed.json()).access_token === token);
    const opened = await fetch(review.origin + BACKEND_PREFIX + "/rest/v1/rpc/collaboration_rpc", {
      method: "POST",
      headers: {
        origin: review.origin,
        cookie: sessionCookie,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_operation: "open", p_data: open }),
    });
    assert.equal(opened.status, 200);
    assert.equal((await opened.json()).document.revision, 1);
  } finally {
    review.dispose();
    if (review.server.listening) {
      review.server.closeAllConnections();
      await new Promise((done) => review.server.close(done));
    }
  }
});

test("portable packaging bundles conflict fixture and catalog without application imports", async () => {
  const packaging = readFileSync(resolve(root, "review-kit/package.mjs"), "utf8");
  assert.match(packaging, /"version-conflict-review-fixture\.mjs"/);
  for (const filename of ["version-conflict-review-fixture.mjs", "review-state-fixtures.mjs"]) {
    const result = await build({
      entryPoints: [resolve(root, "review-kit", filename)],
      bundle: true,
      platform: "node",
      format: "esm",
      write: false,
    });
    assert.ok(result.outputFiles[0].text.includes("result-version-conflict"));
    assert.doesNotMatch(result.outputFiles[0].text, /from ["']\.\.\/src\//);
  }
});
