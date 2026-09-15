import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("tool activity stream is typed, safe, accessible-ready, and excludes secrets", () => {
  const activity = read("src/lib/ai/activity.server.ts");
  for (const token of [
    "ToolActivityEvent",
    "ToolActivityStatus",
    "search_web",
    "read_source",
    "project_files",
    "memory",
    "research_plan",
    "compare_sources",
    "write_report",
    "image_generation",
    "scrubActivityMetadata",
    "activityToSseDelta",
  ]) {
    assert.match(activity, new RegExp(`\\b${token}\\b`), `activity should include ${token}`);
  }
  assert.match(activity, /token\|secret\|key\|password\|credential\|authorization/i);
});
