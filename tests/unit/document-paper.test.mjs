import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as runtime from "react/jsx-runtime";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { renderToStaticMarkup } from "react-dom/server";
const module = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(readFileSync("src/components/DocumentPaper.tsx", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText,
  {
    module,
    exports: module.exports,
    require: (id) =>
      ({ "react/jsx-runtime": runtime, "react-markdown": Markdown, "remark-gfm": remarkGfm })[id],
  },
);
test("paper renderer preserves headings, nested lists, quotations and code while excluding executable HTML and external images", () => {
  const content =
    "## Heading\n\n- Parent\n  - Child\n\n> Quotation\n\n```js\nconst x = 1;\n```\n\n<script>alert(1)</script>\n\n![tracking](https://example.test/pixel)\n\n[unsafe](javascript:alert(1))";
  const html = renderToStaticMarkup(
    module.exports.DocumentPaper({
      title: "Unsaved <title>",
      content,
      containerRef: { current: null },
      visible: true,
    }),
  );
  assert.match(html, /Unsaved &lt;title&gt;/);
  assert.match(html, /<h2 data-document-line="1" tabindex="-1">Heading/);
  assert.match(html, /Child/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /const x = 1/);
  assert.doesNotMatch(html, /<script|<img|javascript:/);
  assert.match(html, /Image reference: tracking/);
});
