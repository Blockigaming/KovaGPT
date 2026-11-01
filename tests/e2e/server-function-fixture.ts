import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Resolve the compiled server function IDs; the tests never bypass an account
// check or replace a production implementation with a browser-only tier flag.
export const functionNames = new Map<string, string>();
const assets = ".nitro/vite/services/ssr/assets";
for (const file of readdirSync(assets).filter((name) => name.startsWith("vendor-tanstack"))) {
  const source = readFileSync(join(assets, file), "utf8");
  for (const match of source.matchAll(/"([a-f0-9]{64})":\s*\{\s*functionName: "([^"]+)"/g))
    functionNames.set(match[1], match[2]);
}
