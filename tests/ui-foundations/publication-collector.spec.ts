import { expect, test } from "@playwright/test";
import { collectRenderFacts } from "../../scripts/publication/render.mjs";
import { validateRenderedFacts } from "../../scripts/publication/contract.mjs";

// Synthetic intercepted pages test the collector itself, not product readiness.
const record = {
  path: "/collector-fixture",
  title: "Collector fixture",
  description: "Synthetic browser evidence for the publication collector regression tests.",
};
const html = (extra = "") => `<!doctype html>
<html data-kova-hydration="ready"><head>
<title>${record.title} | KovaGPT</title>
<meta name="description" content="${record.description}">
<link rel="canonical" href="https://kovagpt.com${record.path}">
</head><body><nav aria-label="Public navigation"><a href="${record.path}">Home</a></nav>
<main><h1>${record.title}</h1><p>${record.description}</p></main><footer>Footer</footer>
<script type="application/ld+json">{"@type":"WebPage"}</script>${extra}</body></html>`;

test("publication collector reads actual DOM and HTTP facts from a complete fixture", async ({
  page,
}) => {
  await page.route("**/*", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: html() }),
  );
  const facts = await collectRenderFacts(page, record, [record.path]);
  expect(validateRenderedFacts(facts, record)).toEqual([]);
});

test("publication collector preserves HTTP failure even when the document looks valid", async ({
  page,
}) => {
  await page.route("**/*", (route) =>
    route.fulfill({ status: 404, contentType: "text/html", body: html() }),
  );
  const facts = await collectRenderFacts(page, record, [record.path]);
  expect(facts.status).toBe(404);
  expect(validateRenderedFacts(facts, record)).toContain("http-not-200");
});

test("publication collector detects broken content instead of manufacturing passing facts", async ({
  page,
}) => {
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).pathname !== record.path) return route.abort();
    return route.fulfill({
      status: 200,
      contentType: "text/html",
      body: html(`<main><h1>Duplicate</h1></main>
<a href="/not-registered">Missing route</a><a href="#absent">Missing anchor</a>
<img src="/broken-image" alt="Broken fixture">
<div style="width:100000px">Overflow fixture</div>
<script type="application/ld+json">{invalid}</script>
<script>throw new Error("Synthetic collector failure");</script>`),
    });
  });
  const facts = await collectRenderFacts(page, record, [record.path]);
  const errors = validateRenderedFacts(facts, record);
  for (const error of [
    "invalid-main-or-h1",
    "broken-or-unchecked-links",
    "broken-or-unchecked-images",
    "runtime-errors-unchecked-or-present",
    "horizontal-overflow",
    "structured-data-unchecked-or-invalid",
  ])
    expect(errors).toContain(error);
  expect(facts.brokenLinks).toEqual(expect.arrayContaining(["/not-registered", "#absent"]));
  expect(facts.runtimeErrors).toContain("Synthetic collector failure");
});
