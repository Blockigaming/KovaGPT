import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Resolve the compiled server function IDs; the tests never bypass an account
// check or replace a production implementation with a browser-only tier flag.
export const functionNames = new Map<string, string>();
const assets = ".nitro/vite/services/ssr/assets";
const files = readdirSync(assets).filter((name) => name.endsWith(".js"));
for (const file of files.filter((name) => name.startsWith("vendor-tanstack"))) {
  const source = readFileSync(join(assets, file), "utf8");
  for (const match of source.matchAll(/"([a-f0-9]{64})":\s*\{\s*functionName: "([^"]+)"/g))
    functionNames.set(match[1], match[2]);
}

// A standalone SSR build can omit the registry while retaining compiled RPC stubs.
if (functionNames.size === 0) {
  for (const file of files) {
    const source = readFileSync(join(assets, file), "utf8");
    const declarations = [...source.matchAll(/const (\w+) = createServerFn\(/g)];
    for (const [index, declaration] of declarations.entries()) {
      const stub = source.slice(declaration.index, declarations[index + 1]?.index);
      const id = stub.match(/\.handler\(createSsrRpc\("([a-f0-9]{64})"\)\)/)?.[1];
      if (id) functionNames.set(id, `${declaration[1]}_compiled`);
    }
  }
}
