import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const server = readFileSync("src/lib/audit.functions.ts", "utf8");
const route = readFileSync("src/routes/audit-log.tsx", "utf8");

test("audit log server and client reject non-array response shapes", () => {
  assert.match(server, /return Array\.isArray\(data\) \? data : \[\];/u);
  assert.match(route, /setRows\(Array\.isArray\(data\) \? \(data as Row\[\]\) : \[\]\);/u);
  assert.match(route, /catch \(e\)[\s\S]*setRows\(\[\]\);/u);
});
