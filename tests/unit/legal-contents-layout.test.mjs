import { restoreLegalTracking } from "../helpers/legal-tracking-preservation.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { eventAttributes } from "../helpers/workspace-layout-preservation.mjs";
const base = "8780a186ad1280f7b98c89501cacf4c0c7c86e19";
const old = (p) => execFileSync("git", ["show", base + ":" + p], { encoding: "utf8" });
test("Semantic ordered list/accessibility retained; contents labels, targets and behavior are otherwise byte-identical", () => {
  const path = "src/components/public/LegalDoc.tsx",
    source = readFileSync(path, "utf8");
  assert.match(source, /<ol className="legal-toc-list" role="list">/);
  assert.equal(
    restoreLegalTracking(source, old(path)),
    old(path).replace(
      '<ol className="legal-toc-list">',
      '<ol className="legal-toc-list" role="list">',
    ),
  );
  assert.deepEqual(eventAttributes(source), eventAttributes(old(path)));
});
test("All legal document source and words remain exact", () => {
  for (const path of ["src/routes/privacy.tsx", "src/routes/terms.tsx", "src/routes/refund.tsx"])
    assert.equal(readFileSync(path, "utf8"), old(path));
});
test("Only scoped contents CSS changed", () => {
  const path = "src/components/public/public-foundation.css";
  const expected = old(path)
    .replace(
      "[data-public-shell] .legal-toc-mobile {\n  border:",
      "[data-public-shell] .legal-toc-mobile {\n  margin-block-end: 1rem;\n  border:",
    )
    .replace("[data-public-shell] .legal-toc-list {", "[data-public-shell] ol.legal-toc-list {")
    .replace(
      "[data-public-shell] .legal-toc-list a {",
      "[data-public-shell] .legal-toc-list > li {\n  list-style: none;\n}\n[data-public-shell] .legal-toc-list a {",
    )
    .replace(
      "[data-public-shell] .legal-toc-index {\n",
      "[data-public-shell] .legal-toc-index {\n  flex-shrink: 0;\n  white-space: nowrap;\n",
    );
  assert.equal(readFileSync(path, "utf8"), expected);
});
