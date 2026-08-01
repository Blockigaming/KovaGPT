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

test("chat sends temporary semantics to server and passes persistence options to research", () => {
  const route = read("src/routes/api/chat.ts");
  const ingressTypes = read("src/lib/chat-ingress.server.d.mts");
  const index = read("src/routes/index.tsx");
  assert.match(ingressTypes, /temporary\?: boolean/);
  assert.match(route, /temporary: Boolean\(temporary\)/);
  assert.match(index, /temporary: tempChat/);
  assert.match(index, /chatId: nextConvId/);
});
