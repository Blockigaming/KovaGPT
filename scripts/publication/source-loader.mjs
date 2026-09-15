import { readFileSync, existsSync, realpathSync } from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

// Development-only loader for the existing checked-in content registries. It
// reads trusted repository modules, not untrusted content. Node vm is not a
// security boundary. External imports and application entry points are rejected.
export function createContentLoader(root = process.cwd()) {
  const directory = realpathSync(resolve(root, "src/lib"));
  const platform = realpathSync(resolve(root, "src/platform/capabilities.ts"));
  const modules = new Map();
  const sources = new Map();
  function load(path) {
    const unresolved = path.startsWith("@/")
      ? resolve(root, "src", path.slice(2))
      : resolve(root, path);
    const candidate = [unresolved, `${unresolved}.ts`, `${unresolved}.mjs`].find(existsSync);
    if (!candidate) throw new Error(`Content module missing: ${path}`);
    const full = realpathSync(candidate);
    if (!full.startsWith(`${directory}${sep}`) && full !== platform) {
      throw new Error(`Module outside approved content paths: ${path}`);
    }
    if (modules.has(full)) return modules.get(full);
    const source = readFileSync(full, "utf8");
    const name = relative(root, full).split(sep).join("/");
    sources.set(name, createHash("sha256").update(source).digest("hex"));
    const output = ts.transpileModule(source, {
      fileName: "content.ts",
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    modules.set(full, exports);
    try {
      vm.runInNewContext(
        output,
        {
          exports,
          atob,
          require(specifier) {
            if (
              !specifier.startsWith("./") &&
              !specifier.startsWith("../") &&
              !specifier.startsWith("@/")
            ) {
              throw new Error(`Non-content import rejected: ${specifier}`);
            }
            return load(specifier.startsWith("@/") ? specifier : resolve(dirname(full), specifier));
          },
        },
        { filename: name, timeout: 2_000, contextCodeGeneration: { strings: false, wasm: false } },
      );
    } catch (error) {
      modules.delete(full);
      throw error;
    }
    return exports;
  }
  return { load, sources };
}
