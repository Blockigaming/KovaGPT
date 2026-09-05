import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const slot = Symbol.for("kova.console-principal-test");
let source = await readFile(
  new URL("../../src/routes/developers.console.tsx", import.meta.url),
  "utf8",
);
source = source.replace(/import\s*\{[^}]+\}\s*from\s*"([^"]+)";/g, (full, path) => {
  if (path === "react")
    return full.replace('"react"', JSON.stringify(import.meta.resolve("react")));
  if (path === "@tanstack/react-router") return "const createFileRoute=()=>()=>({});";
  if (path === "@/components/auth/ClerkSafe")
    return 'const useUser=()=>({isSignedIn:true,user:{id:globalThis[Symbol.for("kova.console-principal-test")]}});';
  return "";
});
source += "\nexport {DeveloperConsole};";
const compiled = ts
  .transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  .outputText.replace(
    '"react/jsx-runtime"',
    JSON.stringify(import.meta.resolve("react/jsx-runtime")),
  );
const { DeveloperConsole } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
test("changing the principal replaces the complete stateful console subtree immediately", () => {
  globalThis[slot] = "owner-a";
  const a = DeveloperConsole();
  globalThis[slot] = "owner-b";
  const b = DeveloperConsole();
  assert.equal(a.type, b.type);
  assert.notEqual(a.key, b.key);
  assert.equal(a.key, "owner-a");
  assert.equal(b.key, "owner-b");
  assert.equal(a.props.userId, "owner-a");
  assert.equal(b.props.userId, "owner-b");
});
