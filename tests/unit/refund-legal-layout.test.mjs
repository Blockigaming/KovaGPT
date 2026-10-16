import { restoreLegalTracking } from "../helpers/legal-tracking-preservation.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import ts from "typescript";
import postcss from "postcss";
import { loadUiModule, jsxRuntime, elements, text } from "../helpers/ui-state-harness.mjs";
const base = "ac6008228625d1617cf9a931b422cd4782e7252d";
const { LegalArticle } = loadUiModule("src/components/LegalArticle.tsx", {});
function route(source) {
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: (id) => {
        if (id === "react/jsx-runtime") return jsxRuntime;
        if (id === "@tanstack/react-router")
          return { createFileRoute: () => (options) => options, Link: "Link" };
        if (id === "@/components/public/PublicShell") return { PublicShell: "PublicShell" };
        if (id === "@/components/LegalArticle") return { LegalArticle };
        throw new Error(id);
      },
    },
  );
  return module.exports.Route;
}
const current = route(readFileSync("src/routes/refund.tsx", "utf8")),
  prior = route(
    execFileSync("git", ["show", base + ":src/routes/refund.tsx"], { encoding: "utf8" }),
  );
test("Refund policy rendered wording, headings, links and metadata remain unchanged", () => {
  const before = prior.component(),
    after = current.component();
  assert.equal(text(after).replace(/\s+/g, " ").trim(), text(before).replace(/\s+/g, " ").trim());
  const links = (tree) =>
    elements(tree, (n) => n.type === "a" || n.type === "Link").map((n) => ({
      href: n.props.href,
      to: n.props.to,
      text: text(n),
    }));
  assert.deepEqual(links(after), links(before));
  assert.equal(links(after).length, 3);
  const headings = (tree) =>
    elements(tree, (n) => n.type === "h1" || n.type === "h2").map((n) => [n.type, text(n)]);
  assert.deepEqual(headings(after), headings(before));
  assert.equal(headings(after).length, 3);
  assert.equal(JSON.stringify(current.head()), JSON.stringify(prior.head()));
});
test("Refund uses shared LegalArticle main/article semantics without unavailable prose plugin", () => {
  const tree = current.component(),
    wrapper = elements(tree, (n) => n.type === LegalArticle)[0];
  assert.ok(wrapper);
  const main = LegalArticle(wrapper.props);
  assert.equal(main.type, "main");
  assert.equal(main.props.id, "main-content");
  assert.equal(main.props.tabIndex, -1);
  assert.equal(elements(main, (n) => n.type === "article").length, 1);
  assert.equal(
    elements(
      main,
      (n) => typeof n.props.className === "string" && /\bprose\b/.test(n.props.className),
    ).length,
    0,
  );
});
test("Terms, Privacy, shared legal composition and existing theme rules are unchanged", () => {
  for (const path of [
    "src/routes/terms.tsx",
    "src/routes/privacy.tsx",
    "src/components/LegalArticle.tsx",
    "src/components/public/LegalDoc.tsx",
  ]) {
    const prior = execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" });
    const source = readFileSync(path, "utf8");
    assert.equal(
      (path.endsWith("LegalDoc.tsx") ? restoreLegalTracking(source, prior) : source).replace(
        '<ol className="legal-toc-list" role="list">',
        '<ol className="legal-toc-list">',
      ),
      prior,
      path,
    );
  }
  const path = "src/components/public/public-foundation.css";
  const original = execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" });
  const current = readFileSync(path, "utf8")
    .replace(
      "[data-public-shell] .legal-toc-mobile {\n  margin-block-end: 1rem;\n  border:",
      "[data-public-shell] .legal-toc-mobile {\n  border:",
    )
    .replace("[data-public-shell] ol.legal-toc-list {", "[data-public-shell] .legal-toc-list {")
    .replace("[data-public-shell] .legal-toc-list > li {\n  list-style: none;\n}\n", "")
    .replace(
      "[data-public-shell] .legal-toc-index {\n  flex-shrink: 0;\n  white-space: nowrap;\n",
      "[data-public-shell] .legal-toc-index {\n",
    );
  assert.ok(
    current.startsWith(original),
    "existing shared theme/legal styles remain byte-identical",
  );
  postcss.parse(current.slice(original.length)).walkRules((rule) => {
    assert.ok(
      rule.selectors.every((selector) => selector.includes(".kova-public-article")),
      "additions must remain opt-in blog article rules",
    );
  });
});
