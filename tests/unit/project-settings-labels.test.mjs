import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

function compile(source, dependencies) {
  const module = { exports: {} };
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require(id) {
      if (id === "react/jsx-runtime") return jsx;
      if (id === "react") return React;
      if (id in dependencies) return dependencies[id];
      throw new Error(`Unexpected dependency ${id}`);
    },
  });
  return module.exports;
}

test("project settings emits visible labels associated with its actual input wrappers", () => {
  const source = readFileSync("src/routes/projects.$projectId.tsx", "utf8");
  const ast = ts.createSourceFile(
    "project.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const settings = ast.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "SettingsTab",
  );
  assert.ok(settings);
  const shared = { "@/lib/utils": { cn: (...values) => values.filter(Boolean).join(" ") } };
  const { Input } = compile(readFileSync("src/components/ui/input.tsx", "utf8"), shared);
  const { Textarea } = compile(readFileSync("src/components/ui/textarea.tsx", "utf8"), shared);
  const { SettingsTab } = compile(
    'import { useState, useRef } from "react"; import { Input, Textarea, Button, Save, Loader2, Trash2, ConfirmDialog } from "test-controls"; export ' +
      settings.getText(ast),
    {
      "test-controls": {
        Input,
        Textarea,
        Button: "button",
        Save: () => null,
        Loader2: () => null,
        Trash2: () => null,
        ConfirmDialog: () => null,
      },
    },
  );
  const html = renderToStaticMarkup(
    React.createElement(SettingsTab, {
      project: {
        name: "Research",
        description: "Current project",
        system_prompt: "Use sources",
        updated_at: "revision-a",
      },
      onSave: async () => "revision-b",
      onDelete: async () => {},
    }),
  );
  for (const [name, id, tag] of [
    ["Name", "project-settings-name", "input"],
    ["Description", "project-settings-description", "textarea"],
    ["Custom instructions", "project-settings-instructions", "textarea"],
  ]) {
    assert.match(html, new RegExp(`<label[^>]*for="${id}"[^>]*>${name}</label>`));
    assert.match(html, new RegExp(`<${tag}[^>]*id="${id}"`));
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1);
  }
});
