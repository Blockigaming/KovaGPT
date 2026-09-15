import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHookHarness, elements, loadUiModule, text } from "../helpers/ui-state-harness.mjs";
const read = (path) => readFileSync(path, "utf8");

test("shared FAQ is a native, labelled disclosure without invented content", () => {
  const hooks = createHookHarness();
  const { PublicFaq } = loadUiModule("src/components/public/PublicFaq.tsx", { react: hooks.react });
  const tree = hooks.render(() => PublicFaq({ items: [{ q: "Question", a: "Original answer" }] }));
  assert.equal(elements(tree, (n) => n.type === "details").length, 1);
  const summary = elements(tree, (n) => n.type === "summary")[0];
  assert.match(summary.props.className, /min-h-11/);
  assert.equal(text(summary).replace("+", "").trim(), "Question");
  const title = elements(tree, (n) => n.type === "h2")[0];
  assert.equal(tree.props["aria-labelledby"], title.props.id);
  assert.match(text(tree), /Original answer/);
  assert.equal(
    hooks.render(() => PublicFaq({ items: [] })),
    null,
  );
});
test("both public content renderers use the same FAQ primitive", () => {
  for (const path of ["src/components/SeoLanding.tsx", "src/components/public/PublicSite.tsx"]) {
    assert.match(read(path), /@\/components\/public\/PublicFaq/);
    assert.match(read(path), /<PublicFaq/);
    assert.doesNotMatch(read(path), /<details/);
  }
});
test("loading, empty, unavailable and error states retain semantics without new main landmarks or network calls", () => {
  const { PublicState } = loadUiModule("src/components/public/PublicState.tsx", {
    "@tanstack/react-router": { Link: "Link" },
  });
  for (const kind of ["loading", "empty", "unavailable", "error"]) {
    const tree = PublicState({
      kind,
      title: "State",
      children: "Actual message",
      action: { label: "Return", to: "/" },
    });
    assert.equal(elements(tree, (n) => n.type === "main").length, 0);
    assert.equal(tree.props["aria-busy"], kind === "loading" ? true : undefined);
    assert.equal(
      elements(tree, (n) => n.props.role === (kind === "error" ? "alert" : "status")).length,
      1,
    );
    assert.equal(elements(tree, (n) => n.type === "Link").length, kind === "loading" ? 0 : 1);
  }
  assert.doesNotMatch(
    read("src/components/public/PublicState.tsx"),
    /fetch\(|useEffect|window\.|document\./,
  );
});
test("public-only CSS handles reading width, native marker, forced colors and reduced motion", () => {
  const css = read("src/components/public/public-foundation.css");
  assert.match(css, /\[data-public-shell\]/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /forced-colors: active/);
  assert.match(css, /scroll-margin-block-start/);
  assert.match(css, /summary::-webkit-details-marker/);
  const shell = read("src/components/public/PublicShell.tsx");
  assert.match(shell, /observer\.observe\(header\)/);
  assert.match(shell, /observer\.disconnect\(\)/);
  assert.match(shell, /removeEventListener\("resize", update\)/);
  assert.doesNotMatch(shell, /text-\[15px\]/);
});

test("mobile navigation keeps its scroll container out of the sequential link order", () => {
  const shell = read("src/components/public/PublicShell.tsx");
  assert.match(shell, /id="public-mobile-navigation"\s+tabIndex=\{-1\}/);
  assert.match(shell, /aria-label="Mobile public navigation"/);
});
