import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("production build emits a Node server artifact and no Cloudflare deployment artifact", () => {
  assert.equal(existsSync("dist/server/index.mjs"), true, "dist/server/index.mjs is missing");
  assert.equal(
    existsSync("dist/server/wrangler.json"),
    false,
    "Cloudflare deployment artifact must not exist",
  );
  const entry = readFileSync("dist/server/index.mjs", "utf8");
  assert.doesNotMatch(entry, /@cloudflare\/workers-types|cloudflare:workers|wrangler/iu);
});
