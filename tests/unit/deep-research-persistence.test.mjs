import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("deep research migration creates owned run and evidence tables with RLS", () => {
  const sql = read("supabase/migrations/20260721211500_deep_research_runs.sql");
  for (const token of [
    "create table if not exists public.deep_research_runs",
    "create table if not exists public.deep_research_evidence",
    "user_id uuid not null references auth.users(id) on delete cascade",
    "alter table public.deep_research_runs enable row level security",
    "alter table public.deep_research_evidence enable row level security",
    "deep_research_runs_select_own",
    "deep_research_evidence_insert_own",
    "auth.uid() = user_id",
  ]) {
    assert.match(
      sql,
      new RegExp(token.replace(/[().]/g, "\\$&")),
      `migration should contain ${token}`,
    );
  }
});

test("deep research persistence skips temporary chats and stores run state", () => {
  const source = read("src/lib/ai/deep-research.server.ts");
  assert.match(source, /temporary\)/);
  assert.match(source, /deep_research_runs/);
  assert.match(source, /deep_research_evidence/);
  assert.match(source, /partial_failures/);
  assert.match(source, /completed_at/);
});

test("chat sends temporary semantics and omits unowned research chat relations", () => {
  const route = read("src/routes/api/chat.ts");
  const ingressTypes = read("src/lib/chat-ingress.server.d.mts");
  const index = read("src/routes/index.tsx");
  assert.match(ingressTypes, /temporary\?: boolean/);
  assert.match(route, /temporary: Boolean\(temporary\)/);
  assert.match(index, /temporary: tempChat/);
  assert.match(index, /chatId: activeTool === "deep_research" \? undefined : nextConvId/);
});

test("failed and canceled research always persist a truthful terminal state", () => {
  const source = read("src/lib/ai/deep-research.server.ts");
  const run = source.slice(source.indexOf("export async function runDeepResearch"));
  const catchBlock = run.slice(run.lastIndexOf("} catch (error) {"));

  assert.match(catchBlock, /opts\.signal\?\.aborted/);
  assert.match(catchBlock, /error\.name === "AbortError"/);
  assert.match(catchBlock, /const status = canceled \? "canceled" : "failed"/);
  assert.match(catchBlock, /await persistTerminalResearchRun\(opts\.persistence, runId/);
  assert.match(catchBlock, /completed_at: completedAt/);
  assert.match(catchBlock, /Research was canceled by the user/);
  assert.match(catchBlock, /search or the AI provider failed/);
  assert.match(catchBlock, /throw error/);
});

test("research persistence checks resolved database errors and protects durable completion", () => {
  const source = read("src/lib/ai/deep-research.server.ts");
  const update = source.slice(
    source.indexOf("async function updateResearchRun"),
    source.indexOf("async function persistTerminalResearchRun"),
  );
  const terminalHelper = source.slice(
    source.indexOf("async function persistTerminalResearchRun"),
    source.indexOf("async function insertResearchEvidence"),
  );
  const run = source.slice(source.indexOf("export async function runDeepResearch"));

  assert.match(update, /const \{ error \} = await persistence\.supabase/);
  assert.match(update, /if \(error\)[\s\S]{0,180}return false/);
  assert.equal((terminalHelper.match(/updateResearchRun\(/g) ?? []).length, 2);
  assert.match(run, /const completionPersisted = await persistTerminalResearchRun/);
  assert.match(run, /if \(!completionPersisted\)/);
  assert.match(run, /completion progress delivery failed/);
  assert.match(run, /terminal state could not be persisted/);
});
