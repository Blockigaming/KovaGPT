import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("edge headers allow only the Stripe origins required by Embedded Checkout", async () => {
  const server = await readFile(new URL("../../src/server.ts", import.meta.url), "utf8");

  assert.match(server, /script-src[^"]*https:\/\/checkout\.stripe\.com/u);
  assert.match(server, /script-src[^"]*https:\/\/js\.stripe\.com/u);
  assert.match(server, /script-src[^"]*https:\/\/\*\.js\.stripe\.com/u);
  assert.match(server, /frame-src[^"]*https:\/\/checkout\.stripe\.com/u);
  assert.match(server, /frame-src[^"]*https:\/\/js\.stripe\.com/u);
  assert.match(server, /frame-src[^"]*https:\/\/\*\.js\.stripe\.com/u);
  assert.match(server, /connect-src[^"]*https:\/\/checkout\.stripe\.com/);
  assert.match(server, /frame-src[^"]*https:\/\/hooks\.stripe\.com/);
  assert.match(server, /frame-src[^"]*https:\/\/link\.com[^"]*https:\/\/\*\.link\.com/);
  assert.match(server, /connect-src[^"]*https:\/\/link\.com[^"]*https:\/\/\*\.link\.com/);
  assert.match(
    server,
    /payment=\(self "https:\/\/checkout\.stripe\.com"[^)]*"https:\/\/\*\.link\.com"\)/,
  );
  assert.doesNotMatch(server, /default-src \*/);
});
