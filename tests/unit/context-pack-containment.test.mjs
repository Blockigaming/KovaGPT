import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { contextPackContainment } from "../helpers/context-pack-containment.mjs";
import { eventAttributes } from "../helpers/workspace-layout-preservation.mjs";
test("Context containment changes only declared classes, preserving all data, handlers and vertical scrolling", () => {
  const path = "src/routes/context-packs.tsx",
    source = readFileSync(path, "utf8");
  const before = execFileSync("git", ["show", "bbe26d6b7228d5295bf4236e446c303c3c31df21:" + path], {
    encoding: "utf8",
  });
  const compile = (s) =>
    ts.transpileModule(s, {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
  assert.equal(compile(source), compile(contextPackContainment(before)));
  assert.deepEqual(eventAttributes(source), eventAttributes(before));
  assert.match(source, /className="mt-3 max-h-80 overflow-y-auto rounded-xl border"/);
  assert.doesNotMatch(source, /overflow-x-hidden|overflow-hidden/);
});

test("Timeline containment preserves graph view, data, handlers and all text", async () => {
  const { timelineContainment } = await import("../helpers/context-pack-containment.mjs");
  const path = "src/routes/knowledge-graph.tsx",
    source = readFileSync(path, "utf8");
  const before = execFileSync("git", ["show", "bbe26d6b7228d5295bf4236e446c303c3c31df21:" + path], {
    encoding: "utf8",
  });
  const compile = (s) =>
    ts.transpileModule(s, {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
  assert.equal(compile(source), compile(timelineContainment(before)));
  assert.deepEqual(eventAttributes(source), eventAttributes(before));
  const graphStart = '<div className="grid gap-4 lg:grid-cols-[1fr_18rem]">';
  assert.equal(
    source.slice(source.indexOf(graphStart)),
    before.slice(before.lastIndexOf(graphStart)),
  );
});
