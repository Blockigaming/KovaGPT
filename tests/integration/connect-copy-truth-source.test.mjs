import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const connectRoute = readFileSync(join(process.cwd(), "src/routes/connect.tsx"), "utf8");

test("connection copy controls report clipboard failures and remain touch accessible", () => {
  assert.match(connectRoute, /await navigator\.clipboard\.writeText\(value\)/);
  assert.match(connectRoute, /catch\s*\{/);
  assert.match(connectRoute, /toast\.error\(/);
  assert.match(connectRoute, /Could not copy the connection details/);
  assert.match(connectRoute, /min-h-11/);
  assert.match(connectRoute, /min-w-11/);
  assert.doesNotMatch(connectRoute, /clipboard\.writeText\(value\)\.then/);
});
