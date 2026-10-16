import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadUiModule, elements, text } from "../helpers/ui-state-harness.mjs";
for (const withUtility of [false, true]) {
  test(`shared header preserves actions and optional utility slot: ${withUtility}`, () => {
    const utility = withUtility ? { type: "Timer", props: { children: "Timers" } } : null;
    const { WorkspacePageHeader } = loadUiModule("src/components/WorkspacePageHeader.tsx", {
      react: { useContext: () => utility },
      "@/components/WorkspacePageUtilities": { WorkspacePageUtilities: {} },
    });
    const action = { type: "button", props: { children: "Refresh", onClick: () => "refresh" } };
    const tree = WorkspacePageHeader({
      title: "Library",
      description: "Saved files",
      titleId: "library-title",
      actions: action,
    });
    assert.equal(tree.props["aria-labelledby"], "library-title");
    assert.ok(text(tree).includes("Library"));
    assert.equal(elements(tree, (n) => n.type === "Timer").length, withUtility ? 1 : 0);
    assert.equal(elements(tree, (n) => n.type === "button")[0].props.onClick(), "refresh");
  });
}
test("shared-header integration is explicit and fallback pages retain Timers", () => {
  const shell = readFileSync("src/components/AppShell.tsx", "utf8");
  assert.match(shell, /utilitiesInHeader = false/);
  assert.match(shell, /!utilitiesInHeader \? \(/);
  assert.match(shell, /value=\{utilitiesInHeader \? utilities : null\}/);
  assert.equal((shell.match(/<TimersWidget/g) ?? []).length, 1);
  for (const path of [
    "goals",
    "omega",
    "memory",
    "library",
    "projects",
    "prompt-studio",
    "apps",
    "images",
    "scheduled-tasks",
    "notifications",
    "files",
  ])
    assert.match(
      readFileSync(`src/routes/${path}.tsx`, "utf8"),
      /<AppShell utilitiesInHeader>/,
      path,
    );
  for (const path of ["SitesPage", "OrganizationAdminPage"])
    assert.match(
      readFileSync(`src/components/${path}.tsx`, "utf8"),
      /<AppShell utilitiesInHeader>/,
      path,
    );
});

test("all13 opted-in pages preserve existing event handlers", async () => {
  const { eventAttributes } = await import("../helpers/workspace-layout-preservation.mjs");
  const { execFileSync } = await import("node:child_process");
  const paths = [
    ...[
      "goals",
      "omega",
      "memory",
      "library",
      "projects",
      "prompt-studio",
      "apps",
      "images",
      "scheduled-tasks",
      "notifications",
      "files",
    ].map((n) => `src/routes/${n}.tsx`),
    ...["SitesPage", "OrganizationAdminPage"].map((n) => `src/components/${n}.tsx`),
  ];
  for (const path of paths)
    assert.deepEqual(
      eventAttributes(readFileSync(path, "utf8")),
      eventAttributes(
        execFileSync("git", ["show", "ebd244977ac7250a291e71f08a1d802f383868c5:" + path], {
          encoding: "utf8",
        }),
      ),
      path,
    );
});
