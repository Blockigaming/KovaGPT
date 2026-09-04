import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const server = readFileSync("src/lib/scheduled-tasks.functions.ts", "utf8");
const route = readFileSync("src/routes/scheduled-tasks.tsx", "utf8");

test("terminal scheduled-task states cannot be overwritten by pause or resume", () => {
  const update = server.slice(
    server.indexOf("export const updateScheduledTask"),
    server.indexOf("const DeleteSchema"),
  );
  assert.doesNotMatch(update, /\.select\("status"\)[\s\S]{0,200}\.update\(patch\)/);
  assert.match(update, /\.eq\("user_id", context\.userId\)/);
  assert.match(
    update,
    /updateQuery = updateQuery\.in\("status", \["scheduled", "running", "paused"\]\)/,
  );
  assert.match(update, /updateQuery\.select\("\*"\)\.maybeSingle\(\)/);
  assert.match(update, /Completed or failed tasks cannot be paused or resumed/);

  assert.match(route, /\["scheduled", "running", "paused"\]\.includes\(t\.status\)/);
  assert.match(route, /No historical task records are available for this account/);
});
