import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import ts from "typescript";
import * as runtime from "react/jsx-runtime";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { renderToStaticMarkup } from "react-dom/server";
const base = "488a5f41bfede7251254b0e61de92a4612a5887b";
const compile = (s) =>
  ts.transpileModule(s, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
const module = { exports: {} };
vm.runInNewContext(compile(readFileSync("src/components/SharedSnapshotMessage.tsx", "utf8")), {
  module,
  exports: module.exports,
  require: (id) =>
    ({ "react/jsx-runtime": runtime, "react-markdown": Markdown, "remark-gfm": remarkGfm })[id],
});
const render = (content, role = "assistant") =>
  renderToStaticMarkup(
    runtime.jsx(module.exports.SharedSnapshotMessage, { message: { role, content } }),
  );
test("Exact baseline paragraph reproduces literal heading/table/code markup", () => {
  const old = execFileSync("git", ["show", base + ":src/routes/share.$shareId.tsx"], {
    encoding: "utf8",
  });
  assert.match(
    old,
    /<p className="whitespace-pre-wrap break-words text-sm leading-relaxed">\s*\{message.content\}\s*<\/p>/,
  );
  const html = renderToStaticMarkup(
    runtime.jsx("p", {
      children: "## Heading\n\n```js\nx()\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |",
    }),
  );
  assert.match(html, /## Heading/);
  assert.doesNotMatch(html, /<h2|<table|<pre/);
});
test("Assistant headings, nested lists, quotations, tables and text links render semantically", () => {
  const html = render(
    "## Heading\n\nParagraph **bold** and `inline`.\n\n- Parent\n  - Child\n\n1. First\n2. Second\n\n> Quotation\n\n| A | B |\n|---|---|\n| One | Two |\n\n[Docs](https://example.test/docs?q=1#section)",
  );
  for (const tag of ["h2", "strong", "code", "ul", "ol", "blockquote", "table", "th", "td"])
    assert.match(html, new RegExp("<" + tag + "(?:>| )"));
  assert.match(html, /role="region" aria-label="Scrollable table" tabindex="0"/);
  assert.match(
    html,
    /href="https:\/\/example.test\/docs\?q=1#section" target="_blank" rel="noreferrer noopener"/,
  );
  assert.doesNotMatch(html, /<button|<form|<textarea/);
});
test("Fenced and indented code preserve spaces, indentation and long lines in focusable scroll regions", () => {
  const line = "x".repeat(250),
    code = "function f() {\n    return '<value>';\n}\n" + line + "\n";
  const html = render("```js\n" + code + "```\n\n    indented\n        deeper\n");
  assert.match(
    html,
    /<pre tabindex="0" aria-label="Scrollable code block"><code class="language-js">/,
  );
  assert.ok(
    html.includes(code.replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#x27;")),
  );
  assert.ok(html.includes("indented\n    deeper\n"));
  assert.doesNotMatch(html, /<button|Copy code/);
});
test("User text remains literal and the supplied snapshot object is unchanged", () => {
  const content =
    "## User heading\n  spaces\n\n| A | B |\n```js\n<raw>\n```\n[link](https://example.test)";
  const message = Object.freeze({ role: "user", content });
  const before = JSON.stringify(message);
  const html = renderToStaticMarkup(runtime.jsx(module.exports.SharedSnapshotMessage, { message }));
  assert.equal(JSON.stringify(message), before);
  assert.match(html, /whitespace-pre-wrap/);
  assert.match(html, /## User heading/);
  assert.match(html, /&lt;raw&gt;/);
  assert.doesNotMatch(html, /<h2|<table|<pre|<a /);
  const assistant = Object.freeze({ role: "assistant", content });
  renderToStaticMarkup(runtime.jsx(module.exports.SharedSnapshotMessage, { message: assistant }));
  assert.equal(assistant.content, content);
});
test("Untrusted HTML and unsafe URL schemes cannot execute, images never autoload, linked image preserves safe destination", () => {
  const html = render(
    '<script>alert(1)</script>\n\n<iframe src="https://example.test"></iframe>\n\n[bad](javascript:alert%281%29)\n\n[data](data:text/html,payload)\n\n![tracking](https://example.test/pixel)\n\n[![preview](https://example.test/image)](https://example.test/destination)',
  );
  assert.doesNotMatch(
    html,
    /<script|<iframe|<img|javascript:|data:text\/html|https:\/\/example.test\/(?:pixel|image)/,
  );
  assert.match(html, /Image reference: tracking/);
  assert.match(html, /href="https:\/\/example.test\/destination"/);
  assert.equal((html.match(/<a /g) || []).length, 3);
});
test("Only message presentation changes; loading/private/unavailable/retry and ownership logic remain exact", () => {
  const p = "src/routes/share.$shareId.tsx",
    before = execFileSync("git", ["show", base + ":" + p], { encoding: "utf8" });
  const expected = before
    .replace(
      "import { AppShell }",
      'import { SharedSnapshotMessage } from "@/components/SharedSnapshotMessage";\nimport { AppShell }',
    )
    .replace(
      /<p className="whitespace-pre-wrap break-words text-sm leading-relaxed">\s*\{message.content\}\s*<\/p>/,
      "<SharedSnapshotMessage message={message} />",
    );
  assert.equal(compile(readFileSync(p, "utf8")), compile(expected));
  for (const path of [
    "src/lib/shared-chats.functions.ts",
    "src/components/ChatMessage.tsx",
    "src/components/DocumentPaper.tsx",
  ])
    assert.equal(
      readFileSync(path, "utf8"),
      execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" }),
    );
});
