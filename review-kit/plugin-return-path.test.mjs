import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as catalog from "./review-state-fixtures.mjs";
import {
  PATHS,
  createFixtureSession,
  loadReviewPackage,
  reviewNavigationScript,
} from "./private-http-review.mjs";

const path = "/apps?google_connected=1";
assert.ok(process.env.KOVA_REVIEW_PACKAGE, "Set KOVA_REVIEW_PACKAGE to an existing review package");
const pkg = { ...(await loadReviewPackage(process.env.KOVA_REVIEW_PACKAGE)), state: catalog };
const selection = { account: "pro", theme: "dark", state: "populated", size: "desktop", path };

test("only the exact authored provider-return path is selectable and remains the scenario's effective URL", async () => {
  assert.equal(PATHS.filter((value) => value === path).length, 1);
  assert.match(
    readFileSync(new URL("../src/routes/apps.tsx", import.meta.url), "utf8"),
    /google_connected/,
  );
  for (const scenario of ["plugin-health-return-unverified", "plugin-health-return-verified"]) {
    assert.equal(catalog.REVIEW_STATE_OPTIONS.find((option) => option.id === scenario).path, path);
    for (const initial of ["/apps", path]) {
      const session = await createFixtureSession(pkg, { ...selection, path: initial, scenario });
      assert.equal(session.selection.path, path);
      assert.equal(session.selection.scenario, scenario);
      assert.equal(session.authActive, true);
      session.dispose();
    }
    for (const invalid of [
      "/apps?google_connected=0",
      path + "&extra=1",
      path + "&google_connected=1",
      "/apps?google_connected=true",
      "/apps?google_connected=1#extra",
      "https://outside.invalid/apps?google_connected=1",
    ])
      await assert.rejects(
        createFixtureSession(pkg, { ...selection, path: invalid, scenario }),
        /Invalid review option/,
      );
  }
});

test("preserve-session navigation accepts the exact return path without OAuth calls or reset", () => {
  const nodes = {
    "navigate-selected-path": {},
    "review-path": { value: path },
    "review-navigation-status": { textContent: "" },
    product: { src: "/apps" },
  };
  const script = reviewNavigationScript();
  assert.doesNotMatch(script, /fetch\(|localStorage|sessionStorage|indexedDB|submit\(|oauth/);
  runInNewContext(script, {
    document: {
      getElementById(id) {
        return nodes[id];
      },
    },
  });
  nodes["navigate-selected-path"].onclick();
  assert.equal(nodes.product.src, path);
  assert.match(
    nodes["review-navigation-status"].textContent,
    /Active account, scenario and local data preserved/,
  );
  nodes["review-path"].value = path + "&extra=1";
  nodes["navigate-selected-path"].onclick();
  assert.equal(nodes.product.src, path);
  assert.match(nodes["review-navigation-status"].textContent, /Choose a listed relative path/);
});

function testClock() {
  const timers = new Map();
  let next = 0;
  return {
    timers,
    setTimeout(callback, delay) {
      const id = ++next;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    expire() {
      for (const timer of [...timers.values()]) timer.callback();
    },
  };
}
const googleRead = (session, signal) =>
  session.registry.dispatch({
    url: "http://127.0.0.1:4189/api/google/status",
    method: "GET",
    headers: { "x-kova-owner": "22222222-2222-4222-8222-222222222222" },
    signal,
  });

test("only provider-return sessions settle their fixed status after 5 seconds, before the real 15-second deadline", async () => {
  assert.match(
    readFileSync(new URL("../src/lib/google-client.ts", import.meta.url), "utf8"),
    /setTimeout\(\(\) => controller\.abort\(\), 15_000\)/,
  );
  for (const scenario of ["plugin-health-return-unverified", "plugin-health-return-verified"]) {
    const clock = testClock();
    const session = await createFixtureSession(
      pkg,
      { ...selection, scenario },
      { loadingClock: clock },
    );
    const response = googleRead(session);
    await new Promise(setImmediate);
    assert.equal(session.providerReturn.pendingCount, 1);
    assert.equal(session.loading.pendingCount, 0);
    assert.deepEqual(
      [...clock.timers.values()].map(({ delay }) => delay),
      [5_000],
    );
    clock.expire();
    const result = await response;
    assert.equal(result.status ?? 200, 200);
    assert.equal(
      result.json.state,
      scenario.endsWith("unverified") ? "reauthorization_required" : "connected",
    );
    assert.equal(result.json.accounts.length, 1);
    assert.equal(clock.timers.size, 0);
    session.dispose();
  }
  const clock = testClock();
  const session = await createFixtureSession(
    pkg,
    { ...selection, path: "/apps", scenario: "plugin-status-loading" },
    { loadingClock: clock },
  );
  assert.equal(session.providerReturn, null);
  const response = googleRead(session);
  await new Promise(setImmediate);
  assert.deepEqual(
    [...clock.timers.values()].map(({ delay }) => delay),
    [20_000],
  );
  clock.expire();
  assert.equal((await response).status, 503);
  session.dispose();
});

test("provider-return holds are session-owned and cancel on request abort, reset and sign-out", async () => {
  for (const action of ["abort", "reset", "logout"]) {
    const clock = testClock();
    const session = await createFixtureSession(
      pkg,
      { ...selection, scenario: "plugin-health-return-unverified" },
      { loadingClock: clock },
    );
    const controller = new AbortController();
    const response = googleRead(session, controller.signal);
    await new Promise(setImmediate);
    assert.equal(clock.timers.size, 1);
    if (action === "abort") controller.abort();
    else if (action === "reset") session.dispose();
    else
      await session.registry.dispatch({
        url: "https://mfbycmbjygcfkrsuepxf.supabase.co/auth/v1/logout",
        method: "POST",
      });
    assert.equal((await response).status, 499);
    assert.equal(clock.timers.size, 0);
    assert.equal(session.providerReturn.pendingCount, 0);
    session.dispose();
  }
});
