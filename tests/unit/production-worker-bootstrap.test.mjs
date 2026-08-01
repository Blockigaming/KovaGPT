import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the production Worker bundles the TanStack server entry statically", () => {
  const source = read("../../src/server.ts");

  assert.match(
    source,
    /import startServerEntry from ["']@tanstack\/react-start\/server-entry["']/,
  );
  assert.doesNotMatch(
    source,
    /import\(\s*["']@tanstack\/react-start\/server-entry["']\s*\)/,
  );
  assert.match(source, /const serverEntry = startServerEntry/);
});

test("Vite preview uses the same Workers runtime as production", () => {
  const source = read("../../vite.config.ts");
  const workerConfig = read("../../wrangler.jsonc");

  assert.match(
    source,
    /import \{ cloudflare \} from ["']@cloudflare\/vite-plugin["']/,
  );
  assert.match(
    source,
    /cloudflare\(\{ viteEnvironment: \{ name: ["']ssr["'] \} \}\)/,
  );
  assert.match(workerConfig, /"main":\s*"src\/server\.ts"/);
  assert.match(workerConfig, /"nodejs_compat"/);
});
