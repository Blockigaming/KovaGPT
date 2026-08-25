import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Vite is locked to the Azure-compatible Node server preset", () => {
  const source = readFileSync("vite.config.ts", "utf8");
  assert.match(source, /KOVA_NITRO_PRESET/u);
  assert.match(source, /preset:\s*"node-server"/u);
  assert.doesNotMatch(source, /cloudflare-module|@cloudflare\/vite-plugin|deployConfig/u);
});
