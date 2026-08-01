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
  assert.match(source, /serverEntry\.fetch\(request\)/);
});

test("Vite emits Lovable's deployable Cloudflare module", () => {
  const source = read("../../vite.config.ts");

  assert.match(source, /import \{ nitro \} from ["']nitro\/vite["']/);
  assert.match(source, /preset:\s*["']cloudflare-module["']/);
  assert.match(source, /dir:\s*["']dist["']/);
  assert.match(source, /serverDir:\s*["']dist\/server["']/);
  assert.match(source, /publicDir:\s*["']dist\/client["']/);
  assert.match(source, /cloudflare:\s*\{ nodeCompat:\s*true, deployConfig:\s*true \}/);
});
