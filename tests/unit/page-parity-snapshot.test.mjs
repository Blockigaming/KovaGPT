import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const inventory = JSON.parse(readFileSync("docs/page-parity/source-inventory.json", "utf8"));
const reconciliation = JSON.parse(
  readFileSync("docs/page-parity/reconciliation-data.json", "utf8"),
);

test("Appendix A and B snapshot counts are exact and URLs are unique", () => {
  assert.equal(inventory.rows.filter((row) => row.sourceDomain === "openai.com").length, 35);
  assert.equal(inventory.rows.filter((row) => row.sourceDomain === "chatgpt.com").length, 97);
  assert.equal(new Set(inventory.rows.map((row) => row.sourceUrl)).size, 132);
  assert.equal(new Set(inventory.rows.map((row) => row.sourceId)).size, 132);
});

test("all 132 exact URLs have one allowed disposition", () => {
  const allowed = new Set([
    "implemented_existing",
    "implemented_new",
    "dynamic_template",
    "localized_variant",
    "redirected",
    "intentionally_excluded",
    "blocked_external_dependency",
    "requires_admin_content",
    "requires_legal_review",
  ]);
  assert.equal(reconciliation.length, 132);
  for (const source of inventory.rows) {
    const matches = reconciliation.filter((row) => row.sourceUrl === source.sourceUrl);
    assert.equal(matches.length, 1, source.sourceUrl);
    assert.ok(allowed.has(matches[0].kovaDisposition), matches[0].kovaDisposition);
  }
});

test("third-party public GPT rows map without copying to the assistant template", () => {
  const gpts = reconciliation.filter((row) => row.pageType === "public_gpt_detail");
  assert.equal(gpts.length, 19);
  for (const row of gpts) {
    assert.equal(row.kovaDisposition, "intentionally_excluded");
    assert.equal(row.kovaCanonicalRoute, "/assistants/$assistantSlug");
    assert.equal(row.kovaTemplateFamily, "assistant-directory");
    assert.match(row.reason, /without copying/);
  }
});

test("all unreviewed locale roots remain non-indexable architecture mappings", () => {
  const locales = reconciliation.filter((row) => row.pageType === "locale_root");
  assert.equal(locales.length, 63);
  for (const row of locales) {
    assert.equal(row.kovaDisposition, "intentionally_excluded");
    assert.equal(row.indexingState, "noindex");
  }
});

test("Arabic direction is supported without publishing an Arabic locale", () => {
  const config = readFileSync("src/i18n/config.ts", "utf8");
  assert.match(config, /ar: "rtl"/);
  assert.match(config, /SUPPORTED_LOCALES = \["en"\]/);
});
