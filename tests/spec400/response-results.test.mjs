import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";
import {
  normalizeTaskCreatedReceipt,
  taskCreatedReceiptFromResult,
  taskCreationNotice,
} from "../../src/lib/task-created-receipt.mjs";
import { resultRevisionDiff, applyReviewedDiff } from "../../src/lib/result-revision-diff.mjs";
const id = "0ad66d37-b5ee-40bd-8e5c-069de38ada89";
test("396: only confirmed persisted create receipts produce success", () => {
  const receipt = taskCreatedReceiptFromResult({ id });
  assert.equal(receipt.taskId, id);
  assert.equal(normalizeTaskCreatedReceipt({ ...receipt, source: "synthetic-review" }), null);
  assert.equal(normalizeTaskCreatedReceipt({ ...receipt, taskId: "../../other" }), null);
  for (const status of ["running", "failed", "canceled"])
    assert.equal(
      taskCreationNotice({ tool: "scheduled_task", status, taskReceipt: receipt }).success,
      false,
    );
  assert.equal(
    taskCreationNotice({ tool: "scheduled_task", status: "done", label: "Scheduled task created" })
      .success,
    false,
  );
  assert.deepEqual(
    taskCreationNotice({ tool: "scheduled_task", status: "done", taskReceipt: receipt }),
    { success: true, text: "Scheduled task created", taskId: id },
  );
  assert.equal(
    taskCreationNotice({
      tool: "scheduled_task",
      status: "failed",
      taskFailure: {
        operation: "not-created",
        source: "confirmed-result",
        reason: "Choose a future date",
      },
    }).text,
    "Scheduled task not created",
  );
  assert.equal(
    taskCreationNotice({
      tool: "scheduled_task",
      status: "failed",
      taskFailure: {
        operation: "not-created",
        source: "confirmed-result",
        reason: "Choose a future date",
      },
    }).reason,
    "Choose a future date",
  );
});
test("259: transport failure never asserts non-creation or invites blind retry", () => {
  for (const activity of [
    { tool: "scheduled_task", status: "failed", error: "Connection lost" },
    {
      tool: "scheduled_task",
      status: "failed",
      taskFailure: {
        operation: "not-created",
        source: "synthetic-review",
        reason: "Claimed failure",
      },
    },
    {
      tool: "scheduled_task",
      status: "failed",
      taskFailure: { operation: "not-created", source: "confirmed-result", reason: "" },
    },
  ]) {
    assert.equal(taskCreationNotice(activity).text, "Scheduled task status unconfirmed");
    assert.match(
      taskCreationNotice(activity).reason,
      /check whether it was created before trying again/,
    );
  }
});
test("219–220: individual diff decisions preserve unchanged passages and whitespace", () => {
  const before = "Opening stays.\nOld paragraph.\nMiddle stays.\nOld ending.\n";
  const after = "Opening stays.\nNew paragraph.\nMiddle stays.\nNew ending.\n";
  const chunks = resultRevisionDiff(before, after);
  assert.equal(chunks.filter((chunk) => chunk.kind === "change").length, 2);
  assert.equal(applyReviewedDiff(chunks), after);
  const changes = chunks.flatMap((chunk, index) => (chunk.kind === "change" ? [index] : []));
  assert.equal(applyReviewedDiff(chunks, changes), before);
  assert.equal(
    applyReviewedDiff(chunks, [changes[1]]),
    "Opening stays.\nNew paragraph.\nMiddle stays.\nOld ending.\n",
  );
});

const result = await build({
  stdin: {
    contents: `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import { ResponseMarkdown } from './src/components/ResponseMarkdown'; import { TaskCreatedBubble } from './src/components/TaskCreatedBubble'; export function render(text, props={}) { return renderToStaticMarkup(<ResponseMarkdown {...props}>{text}</ResponseMarkdown>); } export function receipt(activity) { return renderToStaticMarkup(<TaskCreatedBubble activity={activity}/>); }`,
    loader: "tsx",
    resolveDir: process.cwd(),
  },
  write: false,
  bundle: true,
  platform: "node",
  format: "cjs",
  loader: { ".css": "empty" },
  logLevel: "silent",
});
const module = { exports: {} };
new Function("module", "exports", "require", result.outputFiles[0].text)(
  module,
  module.exports,
  createRequire(import.meta.url),
);
const { render, receipt } = module.exports;
const boxes = (html) => (html.match(/data-output-kind=/g) || []).length;
test("200–202: short answers stay unboxed; complete sections over 800 characters share one box", () => {
  assert.equal(boxes(render("Short answer.")), 0);
  assert.equal(boxes(render("a".repeat(800))), 0);
  assert.equal(boxes(render("a".repeat(801))), 1);
  assert.equal(boxes(render("a".repeat(410) + "\n\n" + "b".repeat(410))), 1);
  assert.equal(boxes(render("a".repeat(801) + "\n\n## Next section\n\nShort answer.")), 1);
  assert.equal(boxes(render("> First paragraph.\n>\n> Second paragraph.")), 1);
  assert.equal(boxes(render("```email\nSubject: Update\n\nHello, team.\n```")), 1);
});
test("202,227: fenced code preserves whitespace and only explicit safe filenames add Download", () => {
  const code = render('```python filename="../../analysis.py"\ndef run():\n\treturn 1\n```');
  assert.match(code, /data-output-kind="code"/);
  assert.match(code, /analysis.py/);
  assert.match(code, /Download file/);
  assert.match(code, /def run\(\):\n\treturn 1/);
  assert.doesNotMatch(render("```python\nprint(1)\n```"), /Download file/);
  assert.equal(boxes(render("Use `inline code` here.")), 0);
});
test("199,233: tables remain semantic and actual citations open the source inspector", () => {
  const table = render("| Name | Value |\n|---|---|\n| First | 10 |");
  assert.match(table, /<table>/);
  assert.match(table, /<th>Name<\/th>/);
  assert.match(table, /aria-label="Scrollable comparison table"/);
  const citation = render("Supported claim. [Source](https://example.com/source)", {
    sources: [
      {
        id: "s1",
        title: "Example source",
        url: "https://example.com/source",
        domain: "example.com",
      },
    ],
    onSourceClick() {},
  });
  assert.match(citation, /<button[^>]*aria-label="View source: Example source"/);
});
test("safe Markdown rejects script links and SVG data URLs while allowing generated raster images", () => {
  assert.doesNotMatch(render("<script>alert(1)</script>"), /<script>/);
  assert.doesNotMatch(render("[Click](javascript:alert(1))"), /href="javascript:/);
  assert.doesNotMatch(
    render("![unsafe](data:image/svg+xml;base64,PHN2Zz4=)"),
    /src="data:image\/svg/,
  );
  assert.match(
    render("![output](data:image/png;base64,iVBORw0KGgo=)"),
    /src="data:image\/png;base64,iVBORw0KGgo="/,
  );
});
test("257–259: only successful receipt renders a linked green checkmark", () => {
  const html = receipt({
    tool: "scheduled_task",
    status: "done",
    taskReceipt: taskCreatedReceiptFromResult({ id }),
  });
  assert.match(html, /Scheduled task created/);
  assert.match(html, /kova-task-success/);
  assert.match(html, /scheduled-tasks\?taskId=/);
  const failed = receipt({
    tool: "scheduled_task",
    status: "failed",
    taskFailure: {
      operation: "not-created",
      source: "confirmed-result",
      reason: "Choose a future date",
    },
  });
  assert.match(failed, /Scheduled task not created/);
  assert.match(failed, /Choose a future date/);
  assert.doesNotMatch(failed, /kova-task-success/);
});
test("203–209,397: responsive copy layout, two-second feedback and selectable failure are explicit", () => {
  const css = readFileSync("src/components/response-output-blocks.css", "utf8"),
    component = readFileSync("src/components/ResponseMarkdown.tsx", "utf8");
  assert.match(css, /border-radius: 12px/);
  assert.match(css, /padding: 16px/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /grid-template-areas: "header" "body" "actions" "error"/);
  assert.match(css, /overflow-x: auto/);
  assert.match(component, /setTimeout\(\(\) => setCopyState\("idle"\), 2000\)/);
  assert.match(component, /writeClipboard\(text\)/);
  assert.match(component, /navigator.clipboard.writeText\(value\)/);
  assert.match(component, /Couldn’t copy/);
  assert.match(component, /selectNodeContents/);
});
test("216–228: editor retains real persistence, manual edits, preview-before-restore and explicit isolated preview", () => {
  const editor = readFileSync("src/components/ArtifactEditor.tsx", "utf8");
  assert.match(editor, /embedded/);
  assert.match(editor, /onDraftChangeRef.current\?\.\(value\)/);
  assert.match(editor, /saveVersionFn\(snapshot\)/);
  assert.match(editor, /Run preview/);
  assert.match(editor, /sandbox=""/);
  assert.match(editor, /safeDocumentFilename\(artifactTitle, extension\)/);
  assert.match(editor, /Restore this version/);
  assert.match(editor, /setCompareVersion/);
  assert.match(editor, /Share result snapshot/);
  assert.doesNotMatch(editor, /onImprove\(prompt\)/);
  const versions = readFileSync("src/components/MessageVersionHistoryDialog.tsx", "utf8");
  assert.match(versions, /expanded !== entry.id/);
  assert.match(versions, /saveLocalVersion/);
});
