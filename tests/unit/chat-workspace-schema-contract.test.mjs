// Static guarantees about the production chat-workspace migrations. These assert
// the invariants that make the runtime safe (owner scoping, deny-by-default
// grants, lineage guards, and locked allocation) without touching production.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const MIGRATIONS_DIR = path.resolve("supabase/migrations");
const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql"));

function readMigration(match) {
  const file = files.find((name) => name.includes(match));
  assert.ok(file, `expected a migration containing "${match}"`);
  return readFileSync(path.join(MIGRATIONS_DIR, file), "utf8").toLowerCase();
}

const contract = readMigration("chat_workspace_production_contract");
const rpcs = readMigration("chat_workspace_atomic_rpcs");
const hardening = readMigration("client_privilege_hardening");

const TABLES = [
  "chat_branches",
  "chat_custom_rules",
  "chat_message_versions",
  "chat_pinned_files",
];

test("every chat-workspace table is owner scoped with RLS enabled", () => {
  for (const table of TABLES) {
    assert.match(contract, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(contract, new RegExp(`alter table public\\.${table} enable row level security`));
    for (const action of ["select", "insert", "update", "delete"]) {
      assert.match(contract, new RegExp(`create policy "${table}_owner_${action}"`));
    }
  }
  // Owner columns, never a generic user_id, and always pinned to auth.uid().
  assert.match(contract, /owner_id uuid not null/);
  assert.match(contract, /auth\.uid\(\)\) = owner_id/);
});

test("client roles get explicit grants and anon is denied", () => {
  for (const table of TABLES) {
    assert.match(contract, new RegExp(`grant [^;]*on public\\.${table} to authenticated`));
    assert.match(contract, new RegExp(`revoke all on public\\.${table} from anon`));
    assert.match(contract, new RegExp(`grant [^;]*on public\\.${table} to service_role`));
  }
});

test("uniqueness and limits are enforced in the database, not only in code", () => {
  assert.match(contract, /unique \(owner_id, chat_id, message_id, version\)/);
  assert.match(contract, /unique \(owner_id, chat_id\)/);
  assert.match(contract, /unique \(owner_id, chat_id, source_type, source_id\)/);
  // One active branch per chat, one accepted version per message.
  assert.match(contract, /uq_chat_branches_active_per_chat/);
  assert.match(contract, /uq_chat_message_versions_accepted/);
  assert.match(contract, /char_length\(content\) <= 131072/);
  assert.match(contract, /char_length\(instructions\) <= 8000/);
});

test("branch lineage is guarded against cycles and cross-chat parents", () => {
  assert.match(contract, /kova_chat_branch_lineage_guard/);
  assert.match(contract, /cycle/);
  assert.match(contract, /parent branch/);
});

test("atomic RPCs allocate under a lock and pin the owner to the caller", () => {
  assert.match(rpcs, /pg_advisory_xact_lock/);
  assert.match(rpcs, /security definer/);
  assert.match(rpcs, /set search_path (to|=) ?'?public'?/);
  assert.match(rpcs, /not_authenticated/);
  for (const fn of [
    "kova_record_message_version",
    "kova_accept_message_version",
    "kova_create_chat_branch",
    "kova_activate_chat_branch",
    "kova_update_chat_branch_messages",
  ]) {
    assert.match(rpcs, new RegExp(`function public\\.${fn}`));
    assert.match(rpcs, new RegExp(`revoke all on function public\\.${fn}[\\s\\S]*?from (public|anon)`));
  }
});

test("browser roles cannot maintain tables or rewrite sequences", () => {
  assert.match(hardening, /revoke truncate, trigger, references on %s from anon, authenticated/);
  assert.match(hardening, /revoke update on sequence %s from anon, authenticated/);
  assert.match(hardening, /alter default privileges[\s\S]*revoke all on tables from anon, authenticated/);
  assert.match(hardening, /no_client_access/);
});
