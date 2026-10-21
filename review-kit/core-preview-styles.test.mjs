import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";
test("only the control sheet removes the host width cap for selected viewport review", () => {
  const source = readFileSync(new URL("./core-preview.tsx", import.meta.url), "utf8");
  assert.match(source, /screen === "Control sheet" \? "w-full" : "max-w-5xl"/);
});
test("core preview links its emitted shared component stylesheet after base styles", () => {
  const source = readFileSync(new URL("./build-plugin-preview.mjs", import.meta.url), "utf8");
  assert.match(source, /entryPoints: \[join\(root, "review-kit\/core-preview.tsx"\)\]/);
  assert.match(source, /href="\/review\/core-preview.css"/);
  const component = readFileSync(
    new URL("../src/components/ResponseMarkdown.tsx", import.meta.url),
    "utf8",
  );
  assert.match(component, /import "\.\/response-output-blocks.css"/);
});

test("private HTTP adapter serves the emitted core stylesheet as CSS with shared output rules", async () => {
  const { createPrivateReviewServer, loadReviewPackage } =
    await import("./private-http-review.mjs");
  assert.ok(process.env.KOVA_REVIEW_PACKAGE, "Set KOVA_REVIEW_PACKAGE to the exact candidate");
  const pkg = await loadReviewPackage(process.env.KOVA_REVIEW_PACKAGE);
  let upstreamCalls = 0;
  const review = createPrivateReviewServer({
    pkg,
    port: 6209,
    fetchImpl: async () => {
      upstreamCalls++;
      throw new Error("Unexpected upstream read");
    },
  });
  await review.listen();
  try {
    const response = await fetch(review.origin + "/review/core-preview.css");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/css/);
    const css = await response.text();
    assert.match(css, /\.kova-response-output\s*\{/);
    assert.match(css, /grid-template-areas:/);
    assert.match(css, /\.kova-response-copy-panel\s*\{/);
    assert.match(css, /border-radius: var\(--kova-radius-output\)/);
    const base = await fetch(review.origin + "/review/plugin-preview.css");
    assert.equal(base.status, 200);
    assert.match(base.headers.get("content-type"), /^text\/css/);
    const geometry = await base.text();
    assert.match(geometry, /--kova-radius-button:\s*9999px/);
    assert.match(geometry, /--kova-radius-output:\s*16px/);
    assert.match(geometry, /--kova-radius-card:\s*20px/);
    const sheet = postcss.parse(geometry);
    let focusedFieldBorder = false;
    let keyboardFieldOutline = false;
    let optionTargetMinimum = false;
    sheet.walkRules((rule) => {
      const selector = rule.selector.replace(/\s+/g, " ");
      if (selector.split(", ").includes('body [role="option"]'))
        optionTargetMinimum = rule.nodes.some(
          (node) => node.prop === "min-height" && node.value === "44px",
        );
      if (selector === ":is(input, textarea, select):focus") {
        focusedFieldBorder = rule.nodes.some(
          (node) => node.prop === "border-color" && node.value === "var(--ring)",
        );
      }
      if (
        selector.includes(":is(input, textarea, select)") &&
        selector.endsWith(":focus-visible")
      ) {
        if (
          rule.nodes.some(
            (node) => node.prop === "outline" && node.value === "2px solid var(--ring)",
          )
        )
          keyboardFieldOutline = true;
      }
      if (!/:is\(input,\s*textarea,\s*select\):focus/.test(selector)) return;
      rule.walkDecls(/^(outline|box-shadow|border-color)$/, (decl) =>
        assert.ok(!decl.important, `Compiled field focus must not be suppressed: ${decl}`),
      );
    });
    assert.ok(focusedFieldBorder, "Compiled CSS retains the pointer-focused field border");
    assert.ok(keyboardFieldOutline, "Compiled CSS retains the keyboard-focused field outline");
    assert.ok(optionTargetMinimum, "Compiled CSS gives shared listbox options a 44px minimum");
    assert.equal(upstreamCalls, 0);
  } finally {
    review.dispose();
    await new Promise((resolve) => review.server.close(resolve));
  }
});

test("review rejection diagnostics retain codes without logging request headers or cookie state", () => {
  const source = readFileSync(new URL("./private-http-review.mjs", import.meta.url), "utf8");
  assert.match(source, /console\.warn\("PRIVATE_REVIEW_ORIGIN_REJECTED"\)/);
  assert.match(source, /console\.warn\("PRIVATE_REVIEW_CSRF_REJECTED"\)/);
  assert.doesNotMatch(source, /cookieHeaderPresent:|formCookiePresent:|refererOrigin,/);
});
