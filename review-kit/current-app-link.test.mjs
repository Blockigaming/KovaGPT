import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { observedReviewAppUrl, reviewCurrentAppLinkScript } from "./private-http-review.mjs";

// Plain in-process URL and DOM-contract checks. No browser, navigation, request,
// session mutation, popup or download is performed by this test.
const origin = "http://127.0.0.1:4191";
const projectChat =
  "/projects/33333333-3333-4333-8333-333333333333/chat/44444444-4444-4444-8444-444444444444";
const source = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");

test("only observed absolute same-origin ordinary app URLs are accepted, including the existing project-chat route", () => {
  assert.match(
    source("src/routes/projects.$projectId.chat.$chatId.tsx"),
    /createFileRoute\("\/projects\/\$projectId\/chat\/\$chatId"\)/,
  );
  for (const path of [
    "/",
    "/library",
    "/projects",
    projectChat,
    "/kovas?id=sample",
    "/product-updates/workspace-foundations#overview",
    "/developers/console",
    "/ar/home",
  ]) {
    const href = origin + path;
    assert.equal(observedReviewAppUrl(href, origin), href);
  }
  for (const href of [
    undefined,
    null,
    "",
    " ",
    "/projects",
    "//127.0.0.1:4191/projects",
    "about:blank",
    "javascript:alert(1)",
    "data:text/html,example",
    "blob:" + origin + "/sample",
    "https://outside.invalid/projects",
    "http://localhost:4191/projects",
    "http://127.0.0.1:4189/projects",
    "https://127.0.0.1:4191/projects",
    "http://name:password@127.0.0.1:4191/projects",
    " " + origin + "/projects",
  ]) {
    assert.equal(observedReviewAppUrl(href, origin), null, String(href));
  }
});

test("auth, private, service, encoded and asset URLs cannot become the new-tab target", () => {
  for (const path of [
    "/auth?email=review%40example.invalid",
    "/AUTH",
    "/auth/callback",
    "/reset-password",
    "/oauth/consent",
    "/~oauth/callback",
    "/developers/authorize",
    "/login",
    "/logout",
    "/sign-in",
    "/sign-up",
    "/signin",
    "/signup",
    "/callback",
    "/.well-known/oauth-authorization-server",
    "/api",
    "/api/chat/history",
    "/_serverFn/abc",
    "/__local-review",
    "/__local-review/start",
    "/__private-review/plugin-preview",
    "/__private-backend/auth/v1/user",
    "/assets/file.js",
    "/%61uth",
    "/%2561uth",
    "/%2fapi/chat",
    "//outside.invalid/path",
    "/?token=synthetic",
    "/?%63ode=synthetic",
    "/#access_token=synthetic",
    "/#%72efresh_token=synthetic",
    "/?PASSWORD=synthetic",
    "/?authorization=synthetic",
  ])
    assert.equal(observedReviewAppUrl(origin + path, origin), null, path);
});

function harness(initial = origin + "/") {
  let observed = initial;
  let inaccessible = false;
  const events = (node) =>
    Object.assign(node, {
      listeners: {},
      addEventListener(event, handler) {
        this.listeners[event] = handler;
      },
    });
  const link = events({
    attrs: { "aria-disabled": "true" },
    set href(value) {
      this.attrs.href = value;
    },
    get href() {
      return this.attrs.href;
    },
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    removeAttribute(name) {
      delete this.attrs[name];
    },
  });
  const product = events({
    get contentWindow() {
      if (inaccessible) throw new Error("Cross-origin frame is unreadable");
      return { location: { href: observed } };
    },
    set src(_) {
      assert.fail("The link must not navigate or reset the existing iframe");
    },
  });
  const status = { textContent: "" };
  const nodes = { product, "current-app-link": link, "current-app-url": status };
  runInNewContext(reviewCurrentAppLinkScript(), {
    URL,
    URLSearchParams,
    window: { location: { origin } },
    document: {
      getElementById(id) {
        assert.ok(Object.hasOwn(nodes, id));
        return nodes[id];
      },
    },
  });
  return {
    link,
    product,
    status,
    setUrl(value) {
      observed = value;
    },
    denyFrame() {
      inaccessible = true;
    },
  };
}

test("frame load and user focus, context menu or activation refresh the actual SPA location without invented routes", () => {
  const { link, product, status, setUrl } = harness();
  assert.equal(link.href, origin + "/");
  assert.equal(link.attrs["aria-disabled"], undefined);
  assert.equal(status.textContent, origin + "/");
  setUrl(origin + projectChat);
  product.listeners.load();
  assert.equal(link.href, origin + projectChat);
  for (const event of [
    "focus",
    "pointerenter",
    "pointerdown",
    "contextmenu",
    "click",
    "auxclick",
  ]) {
    const href = origin + projectChat + "?view=" + event;
    setUrl(href);
    // A SPA location can change without a frame load; read again at interaction.
    link.listeners[event]({
      preventDefault() {
        assert.fail("Valid ordinary link activation must remain native");
      },
    });
    assert.equal(link.href, href);
    assert.equal(status.textContent, href);
  }
});

test("an unavailable or changed forbidden location removes any stale target and prevents activation", () => {
  for (const value of [
    "about:blank",
    origin + "/auth",
    origin + "/__local-review/start",
    "https://outside.invalid/",
    null,
  ]) {
    const { link, status, setUrl, denyFrame } = harness(origin + projectChat);
    assert.equal(link.href, origin + projectChat);
    if (value === null) denyFrame();
    else setUrl(value);
    let prevented = 0;
    link.listeners.click({
      preventDefault() {
        prevented += 1;
      },
    });
    assert.equal(prevented, 1);
    assert.equal(link.href, undefined);
    assert.equal(link.attrs["aria-disabled"], "true");
    assert.equal(status.textContent, "No ordinary same-origin app URL is available.");
  }
  runInNewContext(reviewCurrentAppLinkScript(), {
    document: {
      getElementById() {
        return null;
      },
    },
  });
});

test("controller exposes a native noopener link and the URL/local-state distinction without auth, reset or popup work", () => {
  const adapter = source("review-kit/private-http-review.mjs");
  assert.match(
    adapter,
    /<a id="current-app-link" target="_blank" rel="noopener noreferrer" aria-disabled="true" tabindex="0">Open current app in new tab<\/a>/,
  );
  assert.match(adapter, /Main-chat selection is local state, not a chat-specific URL/);
  assert.match(
    adapter,
    /<script id="review-current-app-link">\$\{reviewCurrentAppLinkScript\(\)\}<\/script>/,
  );
  assert.doesNotMatch(
    reviewCurrentAppLinkScript(),
    /fetch\(|XMLHttpRequest|window\.open|location\s*=|\.src\s*=|localStorage|sessionStorage|indexedDB|submit\(|history\.|postMessage\(|innerHTML/,
  );
  assert.match(source("review-kit/package.mjs"), /"private-http-review\.mjs"/);
});
