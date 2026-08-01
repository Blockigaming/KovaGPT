import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Vite emits Lovable's deployable Cloudflare module", () => {
  const source = read("../../vite.config.ts");

  assert.match(source, /import \{ nitro \} from ["']nitro\/vite["']/);
  assert.match(source, /preset:\s*["']cloudflare-module["']/);
  assert.match(source, /dir:\s*["']dist["']/);
  assert.match(source, /serverDir:\s*["']dist\/server["']/);
  assert.match(source, /publicDir:\s*["']dist\/client["']/);
  assert.match(source, /cloudflare:\s*\{ nodeCompat:\s*true, deployConfig:\s*true \}/);
});
