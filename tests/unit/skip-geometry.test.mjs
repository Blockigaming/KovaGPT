import { shellLogic, eventAttributes } from "../helpers/workspace-layout-preservation.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import postcss from "postcss";
import { jsxContract as js } from "../helpers/jsx-contract.mjs";
const base = "91ae7a20b06ee008f44ac83fda97df62e3a76a70";
const old = (p) => execFileSync("git", ["show", base + ":" + p], { encoding: "utf8" });
test("Graph presentation, inline handlers, node hits, focus and Timeline links preserved", () => {
  const p = "src/routes/knowledge-graph.tsx",
    s = readFileSync(p, "utf8");
  assert.equal(
    js(s.replaceAll("kova-graph-mode ", "").replace("kova-graph-filters ", "")),
    js(old(p)),
  );
  assert.equal((s.match(/kova-graph-mode/g) || []).length, 2);
});
test("Skip offset shares actual header/safe-area tokens and visibility breakpoint", () => {
  const css = postcss.parse(readFileSync("src/styles/core-pages.css", "utf8"));
  let rule;
  css.walkRules((r) => {
    if (r.selector === ".kova-app-shell main#main-content") rule = r;
  });
  assert.ok(rule);
  assert.equal(rule.parent.params, "(max-width: 1023px)");
  assert.equal(rule.nodes[0].prop, "scroll-margin-top");
  assert.equal(rule.nodes[0].value, "calc(var(--parity-topbar-height) + var(--safe-top))");
  const parity = readFileSync("src/styles/chatgpt-parity.css", "utf8");
  assert.match(
    parity,
    /min-height: calc\(var\(--parity-topbar-height\) \+ var\(--safe-top\)\) !important/,
  );
  assert.match(
    readFileSync("src/components/MobileTopBar.tsx", "utf8"),
    /kova-topbar sticky top-0 z-30 lg:hidden/,
  );
});
test("Existing header/skip behavior, mention permissions and Artifact History checkpoint unchanged", () => {
  for (const p of [
    "src/routes/__root.tsx",
    "src/components/MobileTopBar.tsx",
    "src/components/ProjectCollaboration.tsx",
    "src/components/ArtifactEditorSurface.tsx",
    "src/components/ArtifactHistoryPanel.tsx",
    "src/lib/artifact-history-status.ts",
  ])
    assert.equal(readFileSync(p, "utf8"), old(p), p);
});

test("Project outcome branches and content retain focusable main targets and role forwarding", () => {
  const source = readFileSync("src/routes/projects.$projectId.tsx", "utf8");
  const mains = [...source.matchAll(/<main\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(mains.length > 0);
  for (const main of mains) {
    assert.match(main, /id="main-content"/);
    assert.match(main, /tabIndex=\{-1\}/);
  }
  assert.match(
    source,
    /<ProjectCollaboration projectId=\{projectId\} members=\{members\} role=\{project.role\}/,
  );
});

test("AppShell history, privacy, focus handlers survive header utility relocation", () => {
  const path = "src/components/AppShell.tsx";
  const prior = execFileSync("git", ["show", "ebd244977ac7250a291e71f08a1d802f383868c5:" + path], {
    encoding: "utf8",
  });
  const current = readFileSync(path, "utf8");
  assert.equal(shellLogic(current), shellLogic(prior));
  assert.deepEqual(eventAttributes(current), eventAttributes(prior));
});
