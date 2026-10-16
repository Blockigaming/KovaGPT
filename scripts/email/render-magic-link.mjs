import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { render } from "@react-email/render";

const require = createRequire(import.meta.url);
const root = new URL("../../", import.meta.url);
async function loadTemplate(name, imports = {}) {
  const source = await readFile(new URL(`src/lib/email-templates/${name}.tsx`, root), "utf8");
  const exports = {};
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  vm.runInNewContext(compiled, { exports, require: (name) => imports[name] ?? require(name) });
  return exports;
}

// Local rendering only. No provider configuration or authentication request.
export async function renderMagicLink(confirmationUrl = "{{ .ConfirmationURL }}") {
  const brand = await loadTemplate("_brand");
  const { MagicLinkEmail } = await loadTemplate("magic-link", { "./_brand": brand });
  return render(React.createElement(MagicLinkEmail, { siteName: "KovaGPT", confirmationUrl }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const html = await renderMagicLink();
  await writeFile(new URL("supabase/templates/magic-link.html", root), html + "\n");
  console.log("Rendered supabase/templates/magic-link.html locally; nothing published.");
}
