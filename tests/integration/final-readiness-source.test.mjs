import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const start = await readFile("src/start.ts", "utf8");
const packageJson = await readFile("package.json", "utf8");

test("security headers preserve explicit same-origin location features", () => {
  assert.match(start, /X-Content-Type-Options/);
  assert.match(start, /X-Frame-Options/);
  assert.match(start, /Referrer-Policy/);
  assert.match(start, /geolocation=\(self\)/);
  assert.doesNotMatch(start, /geolocation=\(\)/);
});

test("runtime packages emitted as external server imports are direct dependencies", () => {
  const manifest = JSON.parse(packageJson);
  for (const name of [
    "react",
    "react-dom",
    "@tanstack/history",
    "@tanstack/router-core",
    "seroval",
    "srvx",
  ]) {
    assert.equal(
      typeof manifest.dependencies[name],
      "string",
      `${name} must be installed in production`,
    );
  }
});
