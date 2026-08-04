import assert from "node:assert/strict";
import test from "node:test";

import {
  PUBLIC_SITEMAP_ENTRIES,
  isPublicIndexableRoute,
  normalizePathname,
  robotsDirectiveForRoute,
} from "../../src/lib/seo-policy.mjs";

test("only intentional public routes are indexable", () => {
  for (const pathname of ["/", "/pricing", "/chatgpt-alternative", "/blog/best-ai-assistants"]) {
    assert.equal(isPublicIndexableRoute(pathname), true, pathname);
    assert.equal(robotsDirectiveForRoute(pathname), "index, follow", pathname);
  }

  for (const pathname of [
    "/api/chat",
    "/apps",
    "/chat/abc",
    "/projects",
    "/projects/abc/chat/def",
    "/settings",
    "/account",
    "/unknown-page",
  ]) {
    assert.equal(isPublicIndexableRoute(pathname), false, pathname);
    assert.equal(robotsDirectiveForRoute(pathname), "noindex, nofollow", pathname);
  }
});

test("route failures and not-found responses are never indexable", () => {
  for (const status of ["error", "notFound", "redirected"]) {
    assert.equal(robotsDirectiveForRoute("/", [status]), "noindex, nofollow", status);
    assert.equal(
      robotsDirectiveForRoute("/chatgpt-alternative", ["success", status]),
      "noindex, nofollow",
      status,
    );
  }
});

test("path normalization is conservative and deterministic", () => {
  assert.equal(normalizePathname("/pricing/"), "/pricing");
  assert.equal(normalizePathname("/pricing?from=test"), "/pricing");
  assert.equal(normalizePathname("/pricing#plans"), "/pricing");
  assert.equal(normalizePathname("//pricing"), "");
  assert.equal(normalizePathname("https://kovagpt.com/pricing"), "");
});

test("the public sitemap is unique and contains no private or service endpoints", () => {
  const paths = PUBLIC_SITEMAP_ENTRIES.map((entry) => entry.path);
  assert.equal(new Set(paths).size, paths.length);

  const privatePrefixes = [
    "/api",
    "/account",
    "/apps",
    "/chat",
    "/checkout",
    "/projects",
    "/settings",
    "/work",
  ];

  for (const path of paths) {
    assert.match(path, /^\/(?:[^?#]*)$/u);
    assert.equal(
      privatePrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
      false,
      path,
    );
  }
});
