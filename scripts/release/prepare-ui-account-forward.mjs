import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const sources = [
  ["20260904233022_durable_chat_context_summaries.sql", null],
  [
    "20260905005111_scheduled_tasks_activation_foundation.sql",
    "33f7264b2f01279b246b24d2de208428bfbdf5c627fe36de130ee81fbb359d4a",
  ],
  [
    "20261031014500_public_chat_share_links.sql",
    "bb14b6dabbed216bd46bb106352453c3d9441b1b1d42c8378f2579a6860b7d86",
  ],
  [
    "20261031014600_scheduled_task_plan_allowances.sql",
    "29864c547ceb2692b59072a378fb31ca0544f1aa3e264f52199b8ed916d3c078",
  ],
  [
    "20261031220329_task_project_membership_argument_order.sql",
    "4f9a248ffa9fde2fa7e89b74ec7b0b35aae45b15d0b027125bf6ceda0abe519c",
  ],
  ["20261101012355_kova_daily_message_modes_and_memory_tiers.sql", null],
];
const manifest = JSON.parse(await readFile("release-migrations.json", "utf8"));
const fragments = [];
const receipts = [];
for (const [filename, approvedHash] of sources) {
  const source = await readFile(`supabase/migrations/${filename}`, "utf8");
  const sha256 = hash(source);
  if (
    manifest.migrations.find((item) => item.filename === filename)?.sha256 !== sha256 ||
    (approvedHash && approvedHash !== sha256)
  )
    throw new Error(`scoped_source_changed:${filename}`);
  // Only remove an outer transaction, never a function's BEGIN/END body.
  let body = source;
  const prefix = /^(?:\s|--[^\n]*\n)*begin;\s*/iu.exec(body);
  if (prefix) {
    body = body.slice(prefix[0].length);
    if (!/commit;\s*$/iu.test(body)) throw new Error(`scoped_transaction_unbalanced:${filename}`);
    body = body.replace(/commit;\s*$/iu, "");
  }
  fragments.push(`-- Verified source: ${filename} ${sha256}\n${body}`);
  receipts.push({ filename, sha256 });
}
const guard = `begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
lock table public.scheduled_tasks in access exclusive mode;
do $$ begin
  if to_regclass('public.chat_memory_write_epochs') is not null
    or to_regclass('public.chat_context_summaries') is not null
    or to_regclass('public.chat_public_shares') is not null
    or to_regclass('public.scheduled_task_runtime') is not null
    or exists(select 1 from information_schema.columns where table_schema='public' and table_name='daily_usage' and column_name='thinking_chats') then
    raise exception 'scoped_live_baseline_changed';
  end if;
  if exists(select 1 from public.scheduled_tasks)
    or to_regprocedure('kova_auth_guard.session_is_active()') is null
    or to_regprocedure('kova_private.auth_user_exists(uuid)') is null then
    raise exception 'scoped_live_prerequisite_changed';
  end if;
end $$;
`;
const sql = `${guard}\n${fragments.join("\n\n")}\ncommit;\n`;
const output = process.argv[2];
if (!output)
  throw new Error("Provide the reviewed SQL output path; this script does not execute SQL.");
await writeFile(resolve(output), sql, { mode: 0o600 });
console.log(
  JSON.stringify({
    operation: "prepare_only",
    sources: receipts,
    sha256: hash(sql),
    bytes: Buffer.byteLength(sql),
    productionWrites: 0,
    schedulerActivated: false,
  }),
);
