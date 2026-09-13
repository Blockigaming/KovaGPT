import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import ts from "typescript";
const require = createRequire(import.meta.url),
  cache = new Map();
export function load(file) {
  const path = resolve(file);
  if (cache.has(path)) return cache.get(path);
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  new Function("exports", "require", compiled)(exports, (name) => {
    if (name.endsWith("?url")) return "unused-font-url";
    if (name.startsWith("."))
      return name.endsWith(".mjs")
        ? require(resolve(dirname(path), name))
        : load(resolve(dirname(path), `${name}.ts`));
    return require(name);
  });
  cache.set(path, exports);
  return exports;
}
export const fonts = {
  regular: new Uint8Array(readFileSync("src/assets/document-fonts/DejaVuSans.ttf")),
  bold: new Uint8Array(readFileSync("src/assets/document-fonts/DejaVuSans-Bold.ttf")),
};
