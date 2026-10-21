import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
test("core proposals remain standalone review code with no live service path", () => {
  const entry = readFileSync("review-kit/core-preview.tsx", "utf8");
  for (const name of [
    "SupportRequestPreview",
    "SharedConversationPreview",
    "SessionsPreview",
    "BillingManagementPreview",
    "LibraryOrganizationPreview",
  ])
    assert.ok(entry.includes(name));
  assert.doesNotMatch(entry, /useServerFn|fetch\(|localStorage|sessionStorage/);
});
test("Library organization preserves failure drafts and uses explicit delete confirmation and undo", () => {
  const s = readFileSync("review-kit/components/LibraryOrganizationPreview.tsx", "utf8");
  assert.match(s, /Proposed item-renaming interface/);
  assert.match(s, /Sample save failed/);
  assert.match(s, /Delete sample file\?/);
  assert.match(s, /Undo sample deletion/);
  assert.match(s, /!draft.trim\(\)/);
  assert.doesNotMatch(s, /fetch\(|useServerFn|localStorage|sessionStorage/);
});
test("all proposed core interfaces compile together without entering production routes", () => {
  const result = buildSync({
    entryPoints: ["review-kit/core-preview.tsx"],
    bundle: true,
    write: false,
    // CSS imports produce a separate in-memory output alongside the review entry.
    outdir: "review-kit/.test-build",
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    loader: { ".svg": "dataurl" },
    logLevel: "silent",
  });
  assert.ok(result.outputFiles.some((file) => file.path.endsWith(".js") && file.text.length > 0));
  assert.ok(result.outputFiles.some((file) => file.path.endsWith(".css") && file.text.length > 0));
});

test("Library modal can recover failure without closing and losing its draft", () => {
  const source = readFileSync("review-kit/components/LibraryOrganizationPreview.tsx", "utf8");
  const modal = source.slice(source.indexOf("<DialogContent"), source.indexOf("</DialogContent>"));
  assert.match(modal, /Simulate save failure for this action/);
  assert.match(modal, /onChange=\{\(event\) => setFail\(event.target.checked\)\}/);
  assert.match(modal, /aria-describedby=\{error \? errorId : undefined\}/);
  assert.match(modal, /id=\{errorId\} role="alert"/);
});
test("Library row actions have item-specific names and restore focus after dismissal or deletion", () => {
  const source = readFileSync("review-kit/components/LibraryOrganizationPreview.tsx", "utf8");
  assert.match(
    source,
    /aria-label=\{`\$\{a\[0\]\.toUpperCase\(\) \+ a.slice\(1\)\} \$\{i.name\}`\}/,
  );
  assert.match(source, /triggerRef.current = event.currentTarget/);
  assert.match(source, /triggerRef.current\?\.isConnected/);
  assert.match(source, /undoRef.current \?\? headingRef.current/);
  assert.match(source, /target\?\.focus\(\)/);
});
