import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";
import { readFileSync, readdirSync } from "node:fs";
import {
  BACKEND_ORIGIN,
  BACKEND_PREFIX,
  FIXTURE_ORIGIN,
  REVIEW_OWNER,
  REVIEW_ACCOUNT_HOLD_MS,
  REVIEW_LOADING_MAX_PENDING,
  REVIEW_FONT_PATHS,
  REVIEW_FONT_FAILURE_PREFIX,
  REVIEW_FONT_FAILURE_DISCLOSURE,
  REVIEW_FONT_FALLBACK_RULES,
  REVIEW_SPACING_PATH,
  REVIEW_SPACING_CSS,
  createReviewCompletionHold,
  createReviewFontFailure,
  createFixtureSession,
  createPrivateReviewServer,
  loadReviewPackage,
  initialStorage,
  reviewConversations,
} from "./private-http-review.mjs";
import * as catalog from "./review-state-fixtures.mjs";
import { normalizeChatHistory } from "../src/lib/chat-history-policy.mjs";
import {
  createChatHistoryState,
  seedChatHistory,
  applyChatHistoryPage,
  visibleChatHistory,
} from "../src/lib/chat-history-state.mjs";
import { searchConversations } from "../src/lib/conversation-search.ts";

assert.ok(process.env.KOVA_REVIEW_PACKAGE, "Set KOVA_REVIEW_PACKAGE to an existing review package");
const sourceRoot = new URL("../", import.meta.url);
const pkg = { ...(await loadReviewPackage(process.env.KOVA_REVIEW_PACKAGE)), state: catalog };
const defaults = {
  account: "pro",
  theme: "dark",
  path: "/",
  size: "laptop",
  state: "populated",
  scenario: "default",
};
const ownerHeaders = { "x-kova-owner": REVIEW_OWNER };
const authRead = (session, signal) =>
  session.registry.dispatch({ url: BACKEND_ORIGIN + "/auth/v1/user", signal });
const planRead = (session, signal) =>
  session.registry.dispatch({
    url: BACKEND_ORIGIN + "/rest/v1/rpc/current_subscription_summary",
    method: "POST",
    body: Buffer.from("{}"),
    signal,
  });
const settle = async () => {
  for (let index = 0; index < 16; index++) await Promise.resolve();
};
function fakeClock() {
  let sequence = 0;
  const timers = new Map();
  return {
    timers,
    setTimeout(callback, ms) {
      const id = ++sequence;
      timers.set(id, { callback, ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    expire() {
      for (const { callback } of [...timers.values()]) callback();
    },
  };
}

test("new scenarios are explicit HTTP-only selections with correct account restrictions", async () => {
  for (const scenario of [
    "account-loading",
    "account-plan-loading",
    "chat-many-history",
    "font-load-failure",
    "accessibility-text-spacing",
  ]) {
    await assert.rejects(
      catalog.installReviewState({}, scenario, "free"),
      /private HTTP review adapter/,
    );
    for (const account of ["free", "plus", "pro"])
      assert.ok(await catalog.installReviewState({}, scenario, account, { adapter: "http" }));
  }
  for (const scenario of ["account-loading", "account-plan-loading", "chat-many-history"])
    await assert.rejects(
      createFixtureSession(pkg, { ...defaults, account: "guest", scenario }),
      /requires/,
    );
  for (const scenario of ["font-load-failure", "accessibility-text-spacing"])
    assert.ok(await catalog.installReviewState({}, scenario, "guest", { adapter: "http" }));
});

test("manual completion hold is bounded, idempotent, abortable and disposes all owned resources", async () => {
  const clock = fakeClock(),
    hold = createReviewCompletionHold(clock),
    abort = new AbortController();
  const first = hold.wait(abort.signal),
    second = hold.wait();
  assert.equal(hold.pendingCount, 2);
  assert.equal(clock.timers.size, 1);
  assert.equal([...clock.timers.values()][0].ms, REVIEW_ACCOUNT_HOLD_MS);
  assert.equal(REVIEW_ACCOUNT_HOLD_MS, 120_000);
  abort.abort();
  assert.equal(await first, "aborted");
  assert.equal(getEventListeners(abort.signal, "abort").length, 0);
  assert.equal(hold.release(), true);
  assert.equal(await second, "released");
  assert.equal(await hold.wait(), "released");
  assert.equal(hold.release(), true);
  assert.equal(clock.timers.size, 0);
  hold.dispose();
  assert.equal(hold.release(), false);
  assert.equal(await hold.wait(), "disposed");
  const expired = createReviewCompletionHold(clock);
  const pending = expired.wait();
  clock.expire();
  assert.equal(await pending, "expired");
  assert.equal(expired.release(), false);
  assert.equal(await expired.wait(), "expired");
  const limited = createReviewCompletionHold(clock);
  const waits = Array.from({ length: REVIEW_LOADING_MAX_PENDING }, () => limited.wait());
  assert.equal(await limited.wait(), "capacity");
  limited.dispose();
  assert.ok((await Promise.all(waits)).every((result) => result === "disposed"));
  assert.equal(clock.timers.size, 0);
});

test("account identity read stays unresolved until manual release, then returns only the known synthetic profile", async () => {
  const clock = fakeClock();
  const session = await createFixtureSession(
    pkg,
    { ...defaults, scenario: "account-loading" },
    { loadingClock: clock },
  );
  let completed = false;
  const pending = authRead(session).then((result) => {
    completed = true;
    return result;
  });
  await settle();
  assert.equal(completed, false);
  assert.equal(session.accountCompletion.pendingCount, 1);
  session.accountCompletion.release();
  const profile = await pending;
  assert.equal(profile.status, 200);
  assert.equal(profile.json.id, REVIEW_OWNER);
  assert.equal(profile.json.user_metadata.full_name, "Private Review");
  assert.equal(profile.json.email, "private-review@example.invalid");
  assert.equal((await authRead(session)).json.id, REVIEW_OWNER);
  assert.equal(clock.timers.size, 0);
  assert.equal(
    initialStorage({ ...defaults, scenario: "account-loading" })["kova-sidebar-open"],
    "1",
  );
  const authSource = readFileSync(new URL("src/components/auth/ClerkSafe.tsx", sourceRoot), "utf8");
  assert.match(authSource, /supabase\.auth\.getUser\(candidate\.access_token\)/);
  assert.match(authSource, /const validatedSession = \{ \.\.\.candidate, user: validatedUser \}/);
});

test("plan-only hold leaves identity and unrelated routes intact; reset/logout/expiry never reveal stale identity", async () => {
  for (const end of ["dispose", "logout", "expire"]) {
    const clock = fakeClock();
    const session = await createFixtureSession(
      pkg,
      { ...defaults, scenario: "account-plan-loading" },
      { loadingClock: clock },
    );
    assert.equal((await authRead(session)).json.id, REVIEW_OWNER);
    const pending = planRead(session);
    await settle();
    assert.equal(session.accountCompletion.pendingCount, 1);
    assert.equal(
      (await session.registry.dispatch({ url: FIXTURE_ORIGIN + "/api/unconnected" })).status,
      503,
    );
    if (end === "dispose") session.dispose();
    else if (end === "logout")
      await session.registry.dispatch({ url: BACKEND_ORIGIN + "/auth/v1/logout", method: "POST" });
    else clock.expire();
    const result = await pending;
    assert.equal(result.status, end === "expire" ? 503 : 401);
    assert.equal(result.json.effectiveTier, undefined);
    assert.equal(session.accountCompletion.release(), false);
    assert.equal(clock.timers.size, 0);
  }
  const session = await createFixtureSession(pkg, {
    ...defaults,
    scenario: "account-plan-loading",
  });
  const pending = planRead(session);
  await settle();
  session.accountCompletion.release();
  assert.deepEqual((await pending).json, {
    effectiveTier: "pro",
    source: "private-review-fixture",
  });
  session.dispose();
  assert.equal((await planRead(session)).status, 401);
});

test("many-history seed and paginated model agree on nine unpinned plus two independent pinned chats", async () => {
  const selection = { ...defaults, scenario: "chat-many-history" };
  const samples = reviewConversations(selection.scenario);
  assert.equal(samples.length, 11);
  assert.equal(new Set(samples.map((chat) => chat.id)).size, 11);
  assert.equal(samples.filter((chat) => !chat.pinned).length, 9);
  assert.equal(samples.filter((chat) => chat.pinned).length, 2);
  assert.ok(samples.some((chat) => !chat.pinned && chat.title.length > 120));
  assert.deepEqual(samples, reviewConversations(selection.scenario));
  for (const chat of samples) assert.deepEqual(normalizeChatHistory(chat, REVIEW_OWNER), chat);
  const storage = initialStorage(selection);
  assert.deepEqual(JSON.parse(storage[`nova-gpt-conversations-v3:user:${REVIEW_OWNER}`]), samples);
  assert.equal(storage["kova-sidebar-open"], "1");
  assert.equal(reviewConversations().length, 2);
  assert.equal(reviewConversations(selection.scenario, "empty").length, 11);
  const session = await createFixtureSession(pkg, selection);
  let state = await seedChatHistory(createChatHistoryState(REVIEW_OWNER), samples, []),
    page;
  do {
    const response = await session.registry.dispatch({
      url:
        FIXTURE_ORIGIN +
        "/api/chat/history?cursor=" +
        state.cursor +
        (state.epoch ? "&epoch=" + state.epoch : ""),
      headers: ownerHeaders,
    });
    assert.equal(response.status, 200);
    page = response.json;
    state = await applyChatHistoryPage(state, page);
  } while (page.hasMore);
  assert.equal(visibleChatHistory(state).length, 11);
  assert.ok(Object.values(state.records).every((row) => !row.migration && !row.conflict));
  const ninth = searchConversations(visibleChatHistory(state), "in:title:09");
  assert.equal(ninth.length, 1);
  assert.equal(ninth[0].conversation.pinned, undefined);
  assert.equal(searchConversations(visibleChatHistory(state), "is:pinned").length, 2);
  const blocked = await session.registry.dispatch({
    url: FIXTURE_ORIGIN + "/api/chat/history",
    headers: { "x-kova-owner": "other" },
  });
  assert.equal(blocked.status, 401);
});

test("font list exactly matches declared app typography sources and spacing CSS has only the approved overrides", () => {
  const styles = ["src/styles/spec400-system.css", "src/styles/assistant.css"]
    .map((path) => readFileSync(new URL(path, sourceRoot), "utf8"))
    .join("\n");
  const declared = [...styles.matchAll(/url\("(\/fonts\/[^\"]+)"\)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(declared)].sort(), [...REVIEW_FONT_PATHS].sort());
  assert.equal(REVIEW_FONT_PATHS.length, 7);
  const declarations = [...REVIEW_SPACING_CSS.matchAll(/([a-z-]+):\s*([^;]+);/g)].map((match) => [
    match[1],
    match[2],
  ]);
  assert.deepEqual(declarations, [
    ["line-height", "1.5 !important"],
    ["letter-spacing", "0.12em !important"],
    ["word-spacing", "0.16em !important"],
    ["margin-bottom", "2em !important"],
  ]);
  assert.doesNotMatch(REVIEW_SPACING_CSS, /url\(|@import|display:|width:|font-size:/);
});

test("unique failed faces preserve product fallback declarations, selector priority and face descriptors", () => {
  const first = createReviewFontFailure("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  const second = createReviewFontFailure("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  assert.equal(first.fontPaths.length, 7);
  assert.equal(new Set(first.fontPaths).size, 7);
  assert.ok(first.fontPaths.every((path) => !second.fontPaths.includes(path)));
  assert.ok(
    Object.values(first.families).every((name) => !Object.values(second.families).includes(name)),
  );
  assert.notEqual(first.stylesheetPath, second.stylesheetPath);
  assert.throws(() => createReviewFontFailure('"; url(https://example.invalid)'), /Invalid/);
  assert.doesNotMatch(first.css, /local\(|@import|https?:|font-size:|line-height:|width:|height:/);
  const urls = [...first.css.matchAll(/url\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.deepEqual(urls, first.fontPaths);
  const normalize = (value) => value.replace(/\s+/g, "");
  const rootRule = REVIEW_FONT_FALLBACK_RULES.find(
    ({ source, selector }) =>
      source === "src/styles/spec400-system.css" && selector.startsWith(":root"),
  );
  // Product tokens now use :root. The private alias override retains its
  // repeated root selector and unlayered priority; it is not a product selector.
  assert.equal(rootRule?.selector, ":root:root");
  assert.equal(rootRule.layer, undefined);
  assert.ok(first.css.includes("\n:root:root {"));
  for (const {
    source,
    selector,
    declarations,
    themeProperty,
    layer,
  } of REVIEW_FONT_FALLBACK_RULES) {
    const css = normalize(readFileSync(new URL(source, sourceRoot), "utf8"));
    const sourceSelector = selector === rootRule.selector ? ":root" : selector;
    const block = css
      .split(normalize(themeProperty ? "@theme inline {" : `${sourceSelector} {`))[1]
      ?.split("}")[0];
    assert.ok(block, `${source}: ${sourceSelector} remains an actual production selector`);
    for (const [property, value] of Object.entries(declarations))
      assert.ok(
        block.includes(normalize(`${themeProperty ?? property}:${value};`)),
        `${source}: ${property} retains its full production fallback stack`,
      );
    const privateBlock = normalize(first.css)
      .split(normalize(`${selector} {`))[1]
      ?.split("}")[0];
    assert.ok(privateBlock, `${selector} retains its private override specificity`);
    for (const [property, value] of Object.entries(declarations)) {
      const aliased = value.replace(
        /"(IBM Plex Sans|IBM Plex Mono|Kova DM Sans)"/g,
        (_match, family) => `"${first.families[family]}"`,
      );
      assert.ok(
        privateBlock.includes(normalize(`${property}:${aliased};`)),
        `${selector}: ${property} changes only the named family, retaining fallback order and importance`,
      );
    }
    if (layer) assert.ok(first.css.includes(`@layer ${layer} { ${selector}`));
  }
  const production = ["src/styles/spec400-system.css", "src/styles/assistant.css"]
    .map((path) => readFileSync(new URL(path, sourceRoot), "utf8"))
    .join("\n");
  const actualFaces = [...first.css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map((match) => match[1]);
  assert.equal(actualFaces.length, 7);
  for (const [index, path] of REVIEW_FONT_PATHS.entries()) {
    const sourceFace = [...production.matchAll(/@font-face\s*\{([^}]+)\}/g)]
      .map((match) => match[1])
      .find((face) => face.includes(path));
    const family = /font-family:\s*"([^"]+)"/.exec(sourceFace)[1];
    assert.ok(actualFaces[index].includes(`font-family: "${first.families[family]}";`));
    for (const property of ["font-weight", "font-style", "font-display"]) {
      const sourceValue = new RegExp(`${property}:\\s*([^;]+);`).exec(sourceFace)[1];
      assert.ok(actualFaces[index].includes(`${property}: ${sourceValue};`));
    }
  }
});

test("HTTP release is origin/CSRF/session bound; font and spacing scenarios reset without touching other assets or fixtures", async () => {
  const calls = [];
  const review = createPrivateReviewServer({
    pkg,
    port: 6197,
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response(
        "<!doctype html><html><head><title>Mock app</title></head><body><p>Existing layout</p></body></html>",
        { headers: { "Content-Type": "text/html" } },
      );
    },
  });
  await review.listen();
  try {
    const origin = review.origin;
    const control = await fetch(origin + "/__local-review"),
      initialHTML = await control.text();
    const csrf = /name="csrf" value="([^"]+)"/.exec(initialHTML)[1];
    const csrfCookie = control.headers.get("set-cookie").split(";")[0];
    let sessionCookie = "",
      id;
    const open = async (scenario) => {
      const response = await fetch(origin + "/__local-review/start", {
        method: "POST",
        headers: { Origin: origin, Cookie: [csrfCookie, sessionCookie].filter(Boolean).join("; ") },
        body: new URLSearchParams({ ...defaults, scenario, csrf }),
      });
      assert.equal(response.status, 200);
      sessionCookie = response.headers.get("set-cookie").split(";")[0];
      id = sessionCookie.split("=")[1];
      return response.text();
    };
    const release = (body = {}, headers = {}) =>
      fetch(origin + "/__local-review/release-account", {
        method: "POST",
        headers: { Origin: origin, Cookie: csrfCookie + "; " + sessionCookie, ...headers },
        body: new URLSearchParams({ csrf, sessionId: id, ...body }),
      });
    assert.match(await open("account-loading"), /Release synthetic account identity/);
    const oldId = id;
    const pending = authRead(review.sessions.get(id));
    await settle();
    assert.equal((await release({}, { Origin: "https://outside.invalid" })).status, 403);
    assert.equal((await release({ csrf: "invalid" })).status, 403);
    assert.equal((await release({ sessionId: "wrong-session" })).status, 409);
    assert.equal(review.sessions.get(id).accountCompletion.pendingCount, 1);
    assert.equal((await release()).status, 200);
    assert.equal((await pending).json.id, REVIEW_OWNER);
    assert.equal((await release()).status, 200);
    await open("account-plan-loading");
    for (const path of REVIEW_FONT_PATHS)
      assert.equal(
        (await fetch(origin + path, { headers: { Cookie: sessionCookie } })).status,
        200,
      );
    const assets = readdirSync(pkg.root + "/dist/client/assets");
    const stylesPath = "/assets/" + assets.find((name) => /^styles-.*\.css$/.test(name));
    const pdfFontPath = "/assets/" + assets.find((name) => /^DejaVuSans-.*\.ttf$/.test(name));
    const originalStyles = await (
      await fetch(origin + stylesPath, { headers: { Cookie: sessionCookie } })
    ).text();
    const staleHold = planRead(review.sessions.get(id));
    await settle();
    assert.equal((await release({ sessionId: oldId })).status, 409);
    const fontControls = await open("font-load-failure");
    assert.ok(fontControls.includes(REVIEW_FONT_FAILURE_DISCLOSURE));
    assert.match(fontControls, /Adapter-observed private font GET failures: 0 of 7/);
    const firstFailure = review.sessions.get(id).fontFailure;
    const fontCookie = sessionCookie;
    assert.equal((await staleHold).status, 401);
    for (const path of REVIEW_FONT_PATHS) {
      const response = await fetch(origin + path, { headers: { Cookie: sessionCookie } });
      assert.equal(response.status, 503);
      assert.match(await response.text(), /Synthetic local typography font failure/);
    }
    const fontPage = await (
      await fetch(origin + "/", { headers: { Cookie: sessionCookie } })
    ).text();
    assert.ok(
      fontPage.includes(
        `<link rel="stylesheet" href="${firstFailure.stylesheetPath}" data-private-review="font-load-failure">`,
      ),
    );
    assert.doesNotMatch(fontPage, /accessibility-text-spacing/);
    const privateCSS = await fetch(origin + firstFailure.stylesheetPath, {
      headers: { Cookie: sessionCookie },
    });
    assert.equal(privateCSS.status, 200);
    assert.equal(privateCSS.headers.get("content-type"), "text/css");
    assert.equal(privateCSS.headers.get("cache-control"), "no-store");
    assert.equal(await privateCSS.text(), firstFailure.css);
    for (const path of firstFailure.fontPaths) {
      const response = await fetch(origin + path, { headers: { Cookie: sessionCookie } });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.match(await response.text(), /session-unique face/);
    }
    for (const path of [firstFailure.stylesheetPath, ...firstFailure.fontPaths]) {
      assert.equal((await fetch(origin + path)).status, 404);
      assert.equal(
        (await fetch(origin + path + "?unexpected=1", { headers: { Cookie: sessionCookie } }))
          .status,
        404,
      );
      assert.equal(
        (
          await fetch(origin + path, {
            method: "POST",
            headers: { Origin: origin, Cookie: sessionCookie },
          })
        ).status,
        405,
      );
    }
    assert.equal(
      (
        await fetch(origin + `${REVIEW_FONT_FAILURE_PREFIX}/${id}/unrelated.woff2`, {
          headers: { Cookie: sessionCookie },
        })
      ).status,
      404,
    );
    assert.equal(
      (await fetch(origin + "/fonts/unrelated.woff2", { headers: { Cookie: sessionCookie } }))
        .status,
      404,
    );
    assert.equal(
      (await fetch(origin + pdfFontPath, { headers: { Cookie: sessionCookie } })).status,
      200,
    );
    assert.equal(
      await (await fetch(origin + stylesPath, { headers: { Cookie: sessionCookie } })).text(),
      originalStyles,
    );
    const evidence = await (
      await fetch(origin + "/__local-review", { headers: { Cookie: sessionCookie } })
    ).text();
    assert.match(evidence, /Adapter-observed private font GET failures: 7 of 7/);
    assert.match(evidence, /HTTP response observations, not a rendered-font assertion/);
    assert.equal(
      (await fetch(origin + "/favicon.png", { headers: { Cookie: sessionCookie } })).status,
      200,
    );
    const auth = await fetch(origin + BACKEND_PREFIX + "/auth/v1/user", {
      headers: { Cookie: sessionCookie },
    });
    assert.equal((await auth.json()).id, REVIEW_OWNER);
    assert.equal(
      (await fetch(origin + REVIEW_SPACING_PATH, { headers: { Cookie: sessionCookie } })).status,
      404,
    );
    await open("font-load-failure");
    const secondFailure = review.sessions.get(id).fontFailure;
    assert.notEqual(secondFailure.stylesheetPath, firstFailure.stylesheetPath);
    assert.equal(secondFailure.requested.size, 0);
    assert.equal(firstFailure.requested.size, 0);
    for (const path of [firstFailure.stylesheetPath, ...firstFailure.fontPaths]) {
      assert.equal(
        (await fetch(origin + path, { headers: { Cookie: sessionCookie } })).status,
        404,
      );
      assert.equal((await fetch(origin + path, { headers: { Cookie: fontCookie } })).status, 404);
    }
    await open("accessibility-text-spacing");
    for (const path of [secondFailure.stylesheetPath, ...secondFailure.fontPaths])
      assert.equal(
        (await fetch(origin + path, { headers: { Cookie: sessionCookie } })).status,
        404,
      );
    const spacingPage = await (
      await fetch(origin + "/", { headers: { Cookie: sessionCookie } })
    ).text();
    assert.match(spacingPage, /data-private-review="accessibility-text-spacing"/);
    assert.doesNotMatch(spacingPage, /font-load-failure/);
    const css = await fetch(origin + REVIEW_SPACING_PATH, { headers: { Cookie: sessionCookie } });
    assert.equal(css.headers.get("content-type"), "text/css");
    assert.equal(await css.text(), REVIEW_SPACING_CSS);
    for (const path of REVIEW_FONT_PATHS)
      assert.equal(
        (await fetch(origin + path, { headers: { Cookie: sessionCookie } })).status,
        200,
      );
    await open("default");
    assert.equal(
      (await fetch(origin + REVIEW_FONT_PATHS[0], { headers: { Cookie: sessionCookie } })).status,
      200,
    );
    assert.equal(
      (await fetch(origin + REVIEW_SPACING_PATH, { headers: { Cookie: sessionCookie } })).status,
      404,
    );
    assert.doesNotMatch(
      await (await fetch(origin + "/", { headers: { Cookie: sessionCookie } })).text(),
      /accessibility-text-spacing|font-load-failure/,
    );
    assert.equal((await release()).status, 409);
    assert.ok(calls.every((url) => url === FIXTURE_ORIGIN + "/"));
  } finally {
    review.dispose();
    await new Promise((resolve) => review.server.close(resolve));
  }
});
