import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
  PATHS,
  FIXTURE_ORIGIN,
  createFixtureSession,
  loadReviewPackage,
  reviewNavigationScript,
} from "./private-http-review.mjs";
import * as catalog from "./review-state-fixtures.mjs";
import { PUBLIC_SOLUTION_PAGE_BY_KEY } from "../src/lib/public-solution-content.ts";
import { PUBLICATIONS, PUBLICATION_BY_KEY, PUBLICATION_SECTIONS } from "../src/lib/publications.ts";
import { resolveLocale, RTL_LOCALES, translations } from "../src/lib/locales.ts";
const source = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");
const paths = [
  "/solutions/industries/government",
  "/build",
  "/news",
  "/product-updates",
  "/academy",
  "/bot",
  "/legal",
  "/ai-writer",
  "/ar/home",
];
assert.ok(process.env.KOVA_REVIEW_PACKAGE, "Set KOVA_REVIEW_PACKAGE to an existing review package");
const pkg = { ...(await loadReviewPackage(process.env.KOVA_REVIEW_PACKAGE)), state: catalog };

test("nine exact controller paths map to existing public source content and routing", () => {
  for (const path of paths) assert.equal(PATHS.filter((item) => item === path).length, 1);
  const government = PUBLIC_SOLUTION_PAGE_BY_KEY.get("solutions/industries/government");
  assert.equal(government.title, "KovaGPT workflows for government");
  assert.equal(government.section + "/" + government.slug, paths[0].slice(1));
  const detailRoute = source("src/routes/$section.$category.$articleSlug.tsx");
  assert.match(detailRoute, /createFileRoute\("\/\$section\/\$category\/\$articleSlug"\)/);
  assert.match(detailRoute, /PUBLIC_SOLUTION_PAGE_BY_KEY\.get\(key\)/);
  const slugRoute = source("src/routes/$slug.tsx");
  assert.match(slugRoute, /build: "\/code-helper"/);
  assert.match(slugRoute, /throw redirect\(\{ to: aliases\[params.slug\]/);
  assert.match(source("src/routes/code-helper.tsx"), /createFileRoute\("\/code-helper"\)/);
  assert.ok(PUBLICATION_SECTIONS.includes("news"));
  assert.ok(PUBLICATION_SECTIONS.includes("product-updates"));
  const article = PUBLICATION_BY_KEY.get("product-updates/workspace-foundations");
  assert.ok(PUBLICATIONS.filter((item) => item.section === "product-updates").includes(article));
  assert.equal(article.title, "A clearer foundation for the KovaGPT workspace");
  assert.ok(article.body.length > 0);
  assert.match(
    slugRoute,
    /items: PUBLICATIONS\.filter\(\(item\) => item\.section === params\.slug\)/,
  );
  assert.ok(slugRoute.includes("to={`/${item.section}/${item.slug}` as never}"));
  const publicationRoute = source("src/routes/$section.$articleSlug.tsx");
  assert.match(publicationRoute, /createFileRoute\("\/\$section\/\$articleSlug"\)/);
  assert.match(publicationRoute, /PUBLICATION_BY_KEY\.get\(key\)/);

  assert.match(slugRoute, /PUBLICATION_SECTIONS as readonly string\[\]\)\.includes\(params.slug\)/);
  assert.match(source("src/routes/academy.tsx"), /createFileRoute\("\/academy"\)/);
  assert.match(source("src/routes/academy.tsx"), /PUBLIC_ACADEMY_PAGES/);
  assert.ok(slugRoute.includes('["review", "bot", "legal"].includes(params.slug)'));
  assert.ok(
    slugRoute.includes(
      'params.slug === "bot" ? "assistant" : params.slug === "legal" ? "legal" : undefined',
    ),
  );
  assert.match(source("src/routes/ai-writer.tsx"), /createFileRoute\("\/ai-writer"\)/);
  assert.match(source("src/routes/ai-writer.tsx"), /label: "Start Writing Free", to: "\/"/);
  assert.equal(resolveLocale("ar"), "ar");
  assert.equal(RTL_LOCALES.has("ar"), true);
  assert.ok(translations.ar.title);
  const localeRoute = source("src/routes/$locale.home.tsx");
  assert.match(localeRoute, /createFileRoute\("\/\$locale\/home"\)/);
  assert.match(localeRoute, /resolveLocale\(params.locale\)/);
  assert.match(localeRoute, /RTL_LOCALES.has\(locale\) \? "rtl" : "ltr"/);
});

test("Guest and signed-in default sessions accept these paths without enabling a service fixture", async () => {
  for (const account of ["guest", "pro"]) {
    const baseline = await createFixtureSession(pkg, {
      account,
      path: "/",
      theme: "light",
      size: "desktop",
      state: "populated",
      scenario: "default",
    });
    const request = { url: FIXTURE_ORIGIN + "/api/chat", method: "POST", body: Buffer.from("{}") };
    const expected = await baseline.registry.dispatch(request);
    for (const path of paths) {
      const session = await createFixtureSession(pkg, {
        account,
        path,
        theme: "light",
        size: "desktop",
        state: "populated",
        scenario: "default",
      });
      assert.equal(session.selection.path, path);
      assert.equal(session.selection.scenario, "default");
      assert.equal(session.authActive, account !== "guest");
      const result = await session.registry.dispatch(request);
      assert.deepEqual(result, expected);
      session.dispose();
    }
    baseline.dispose();
  }
});

test("preserve-session navigation reaches only the exact added paths without reset or service access", () => {
  const nodes = {
    product: { src: "/" },
    "review-path": { value: paths[0] },
    "review-navigation-status": { textContent: "" },
    "navigate-selected-path": {},
  };
  const script = reviewNavigationScript();
  assert.doesNotMatch(
    script,
    /fetch\(|localStorage|sessionStorage|indexedDB|submit\(|review-account|review-scenario/,
  );
  runInNewContext(script, {
    document: {
      getElementById(id) {
        assert.ok(Object.hasOwn(nodes, id));
        return nodes[id];
      },
    },
  });
  for (const path of paths) {
    nodes["review-path"].value = path;
    nodes["navigate-selected-path"].onclick();
    assert.equal(nodes.product.src, path);
    assert.match(
      nodes["review-navigation-status"].textContent,
      /Active account, scenario and local data preserved/,
    );
  }
  for (const path of [
    ...paths.map((path) => path + "?account=other"),
    "https://outside.invalid/news",
    "//outside.invalid/build",
    "/ar/home/extra",
  ]) {
    nodes["review-path"].value = path;
    nodes["navigate-selected-path"].onclick();
    assert.equal(nodes.product.src, "/ar/home");
    assert.match(nodes["review-navigation-status"].textContent, /Choose a listed relative path/);
  }
});
