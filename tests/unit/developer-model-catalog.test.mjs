import assert from "node:assert/strict";
import test from "node:test";
import {
  developerCatalogRows,
  filterDeveloperCatalog,
} from "../../src/lib/pricing/developer-model-catalog.mjs";
const row = {
  id: "kova-example",
  capability: "chat",
  reasoning_efforts: ["low"],
  web_search: false,
  inline_image_input: true,
  image_edits: false,
};
const catalog = (data) => ({ object: "list", pricingVersion: "version-1", data });
test("model catalog accepts scoped discovered contracts and filters exact capabilities", () => {
  const result = developerCatalogRows(catalog([row, { ...row, capability: "image_generation" }]));
  assert.equal(result.pricingVersion, "version-1");
  assert.deepEqual(filterDeveloperCatalog(result.rows, "example", "chat"), [row]);
  assert.equal(filterDeveloperCatalog(result.rows, "missing", "").length, 0);
  assert.deepEqual(developerCatalogRows(catalog([])).rows, []);
});
test("invalid and duplicate discovery results fail closed", () => {
  for (const value of [
    catalog([row, row]),
    catalog([{ ...row, web_search: "true" }]),
    catalog([{ ...row, id: "../x" }]),
    catalog([{ ...row, reasoning_efforts: ["unknown"] }]),
    { ...catalog([row]), pricingVersion: null },
  ])
    assert.throws(() => developerCatalogRows(value));
});
