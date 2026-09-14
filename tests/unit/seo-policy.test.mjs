import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PUBLIC_ECOSYSTEM_PATHS,
  PUBLIC_FORM_PATHS,
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

test("successful reviewed pages remain followable without becoming indexable", () => {
  for (const pathname of [
    "/ar",
    "/fr-FR",
    "/pt-BR",
    "/en/home",
    "/ar/home",
    "/apps",
    "/policies/privacy-policy",
    "/business/plugins/google-drive",
    "/business/partners/accenture",
    "/form/model-behavior-feedback",
  ]) {
    assert.equal(isPublicIndexableRoute(pathname), false, pathname);
    assert.equal(robotsDirectiveForRoute(pathname), "noindex, follow", pathname);
  }

  assert.equal(robotsDirectiveForRoute("/ar", ["notFound"]), "noindex, nofollow");
});

test("the declaration exposes the followable noindex directive", () => {
  const declaration = readFileSync("src/lib/seo-policy.d.mts", "utf8");
  assert.match(declaration, /"index, follow" \| "noindex, follow" \| "noindex, nofollow"/u);
});

test("ecosystem compatibility paths are complete and remain out of the public sitemap", () => {
  assert.equal(PUBLIC_ECOSYSTEM_PATHS.length, 177);
  assert.equal(new Set(PUBLIC_ECOSYSTEM_PATHS).size, 177);
  assert.equal(
    PUBLIC_ECOSYSTEM_PATHS.filter((path) => path.startsWith("/business/plugins")).length,
    101,
  );
  assert.equal(
    PUBLIC_ECOSYSTEM_PATHS.filter((path) => path.startsWith("/business/partners")).length,
    76,
  );
  const sitemapPaths = new Set(PUBLIC_SITEMAP_ENTRIES.map(({ path }) => path));
  for (const path of PUBLIC_ECOSYSTEM_PATHS) {
    assert.equal(sitemapPaths.has(path), false, path);
    assert.equal(robotsDirectiveForRoute(path), "noindex, follow", path);
  }
});

test("form compatibility paths are complete, followable, and excluded from the sitemap", () => {
  assert.equal(PUBLIC_FORM_PATHS.length, 43);
  assert.equal(new Set(PUBLIC_FORM_PATHS).size, 43);
  assert.ok(PUBLIC_FORM_PATHS.every((path) => path.startsWith("/form/")));
  const sitemapPaths = new Set(PUBLIC_SITEMAP_ENTRIES.map(({ path }) => path));
  for (const path of PUBLIC_FORM_PATHS) {
    assert.equal(sitemapPaths.has(path), false, path);
    assert.equal(robotsDirectiveForRoute(path), "noindex, follow", path);
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
    "/chat",
    "/checkout",
    "/projects",
    "/settings",
    "/work",
  ];
  const publicAppDetails = new Set([
    "/apps/google-drive",
    "/apps/gmail",
    "/apps/google-calendar",
    "/apps/github",
    "/apps/canva",
    "/apps/powerpoint",
    "/apps/spotify",
  ]);

  for (const path of paths) {
    assert.match(path, /^\/(?:[^?#]*)$/u);
    assert.equal(
      privatePrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
      false,
      path,
    );
    if (path === "/apps" || path.startsWith("/apps/")) {
      assert.equal(publicAppDetails.has(path), true, path);
    }
  }
});
