import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
const files = readdirSync("dist/client/assets");
const css = [
  files.find((n) => /^styles-.*\.css$/.test(n)),
  files.find((n) => /^PublicShell-.*\.css$/.test(n)),
]
  .map((n) => readFileSync("dist/client/assets/" + n, "utf8"))
  .join("\n");
const sources = [
  "src/routes/scheduled-tasks.tsx",
  "src/routes/apps.tsx",
  "src/routes/work.tsx",
  "src/routes/academy.tsx",
  "src/components/DiscoveryWorkspace.tsx",
  "src/components/WorkExecutionPanel.tsx",
  "src/components/public/AcademyPractice.tsx",
  "src/components/auth/MfaChallengeDialog.tsx",
  "src/components/auth/ForgotPasswordDialog.tsx",
  "src/components/SettingsDialog.tsx",
];
test("required form entrypoints opt into scoped Kova controls", () => {
  for (const path of sources)
    assert.match(readFileSync(path, "utf8"), /kova-adapted-controls/, path);
});
for (const [width, coarse] of [
  [390, true],
  [667, true],
  [822, true],
  [1188, false],
])
  test(`Kova adapted control cascade ${width} coarse=${coarse}`, () => {
    const c = compiledCascade(css, width, coarse),
      root = element("html"),
      page = element("main", "kova-core-page kova-adapted-controls", root),
      button = element("button", "h-10 whitespace-nowrap", page),
      select = element("select", "ml-2", page),
      actions = element("div", "kova-task-actions", page),
      task = element("button", "", actions);
    assert.equal(c.value(button, "min-height"), "44px");
    assert.equal(c.value(button, "height"), "auto");
    assert.equal(c.value(button, "white-space"), "normal");
    assert.equal(c.value(button, "overflow-wrap"), "anywhere");
    assert.equal(c.value(select, "max-width"), "100%");
    assert.equal(c.value(select, "border-radius"), "12px");
    assert.equal(c.value(task, "min-height"), "44px");
    if (width < 768) {
      assert.equal(c.value(select, "width"), "100%");
      assert.equal(c.value(select, "margin-inline"), "0");
    }
    if (coarse) assert.equal(c.value(select, "min-height"), "44px");
    const check = element("input", "", page, { type: "checkbox" });
    assert.equal(c.value(check, "min-height"), undefined, "do not resize checkbox tracks");
    const publicShell = element("div", "", root, { "data-public-shell": "" }),
      toc = element("ol", "legal-toc-list", publicShell),
      link = element("a", "", toc);
    assert.equal(c.value(link, "min-height"), coarse ? "44px" : "36px");
    const billing = element("div", "kova-billing-details", root),
      card = element("div", "flex", billing);
    assert.equal(c.value(card, "flex-wrap"), "wrap");
  });
