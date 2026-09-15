import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("legal and SEO helpers wrap references and keep keyboard controls discoverable", () => {
  const legal = read("src/components/LegalArticle.tsx");
  const seo = read("src/components/SeoLanding.tsx");
  for (const source of [legal, seo]) {
    assert.match(source, /min-w-0/);
    assert.match(source, /\[overflow-wrap:anywhere\]/);
    assert.match(source, /focus-visible/);
  }
  assert.match(legal, /text-\[0\.9375rem\]/);
  assert.doesNotMatch(legal, /text-\[15px\]/);
  assert.match(seo, /<summary className="flex min-h-11/);
  assert.match(seo, /aria-label="Related pages"/);
  assert.match(seo, /aria-hidden="true"[\s\S]*shrink-0/);
});

test("every dynamically loaded public detail family is included in browser rendering", () => {
  const fixture = read("tests/ui-foundations/fixture/public-pages.tsx");
  const routes = readdirSync(new URL("../../src/routes", import.meta.url)).filter(
    (file) => file.startsWith("$section") && file.endsWith(".tsx"),
  );
  assert.ok(routes.length >= 3);
  const families = new Set();
  for (const file of routes) {
    for (const match of read(`src/routes/${file}`).matchAll(/@\/lib\/(public-[a-z-]+-content)/g))
      families.add(match[1]);
  }
  assert.ok(families.size >= 8);
  for (const family of families)
    assert.ok(fixture.includes(`@/lib/${family}`), `Missing ${family}`);
});

test("sales keeps native validation and the existing unsent email-draft boundary", () => {
  const source = read("src/components/EnterpriseContactDialog.tsx");
  assert.match(source, /<DialogFooter/);
  assert.match(source, /openerRef\.current\?\.isConnected/);
  assert.match(source, /onCloseAutoFocus/);
  assert.match(source, /type="email"/);
  assert.match(source, /mailto:\$\{SALES_EMAIL\}/);
  assert.match(source, /Nothing has been sent by KovaGPT/);
  assert.doesNotMatch(source, /fetch\(/);
});
