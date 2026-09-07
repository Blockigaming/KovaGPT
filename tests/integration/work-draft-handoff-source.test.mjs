import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const work = readFileSync("src/routes/work.tsx", "utf8");
const producers = [
  readFileSync("src/lib/workspace-handoffs.ts", "utf8"),
  readFileSync("src/routes/context-packs.tsx", "utf8"),
  readFileSync("src/routes/research-planner.tsx", "utf8"),
];

test("every prepared Work producer has a principal-scoped one-time consumer", () => {
  for (const producer of producers) {
    assert.match(producer, /"kova-work-draft"/);
    assert.match(producer, /writePrincipalHandoff|writeHandoff/);
  }

  assert.match(work, /consumePrincipalHandoff<PreparedWorkDraft>/);
  assert.match(work, /safeBrowserStorage\("sessionStorage"\)/);
  assert.match(work, /"kova-work-draft"/);
  assert.match(work, /draftState\.principal === principal/);
  assert.match(work, /isPreparedWorkDraft\(result\.value\)/);
});

test("a recovered Work draft is visible and can move to immediate chat without fake execution", () => {
  assert.match(work, /Prepared Work draft/);
  assert.match(work, /no background run has started/);
  assert.match(work, /Work execution is\s+unavailable/);
  assert.match(work, /Prepared plan/);
  assert.match(work, /Attached context/);
  assert.match(work, /Continue in chat/);
  assert.match(work, /"kova-app-chat-context"/);
  assert.match(work, /window\.location\.assign\("\/"\)/);
  assert.doesNotMatch(work, /prompt\.slice\(/);
  assert.doesNotMatch(work, /setInterval\([^)]*(?:progress|percent)/i);
});
