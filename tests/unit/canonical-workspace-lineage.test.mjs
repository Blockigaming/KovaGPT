import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const readMigration = (name) =>
  readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const migration = await readMigration(
  "20260904230332_canonical_chat_workspace_lineage_reconciliation.sql",
);
const sourceChain = await Promise.all(
  [
    "20260823220701_day15_chat_workspace_production_contract.sql",
    "20260823220805_day15_chat_workspace_atomic_rpcs.sql",
    "20260824090000_day15_chat_workspace_reconciliation.sql",
    "20260824094500_day15_canonical_workspace_rpc_aliases.sql",
  ].map(readMigration),
);
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const project = "33333333-3333-4333-8333-333333333333";
const file = "44444444-4444-4444-8444-444444444444";
const library = "55555555-5555-4555-8555-555555555555";

async function identify(db, user) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,service_role;
    create table public.projects(id uuid primary key,owner_id uuid,system_prompt text);
    create table public.project_members(project_id uuid,user_id uuid);
    create table public.project_files(id uuid primary key,project_id uuid,name text,mime_type text);
    create table public.project_file_chunks(file_id uuid,project_id uuid,content text,chunk_index integer);
    create table public.user_library_items(id uuid primary key,user_id uuid,title text,file_name text,file_type text,content_text text);
    grant select on public.projects,public.project_members,public.project_files,
      public.project_file_chunks,public.user_library_items to authenticated;
    alter table public.projects enable row level security;
    alter table public.project_members enable row level security;
    alter table public.project_files enable row level security;
    alter table public.project_file_chunks enable row level security;
    alter table public.user_library_items enable row level security;
    create policy members_self on public.project_members for select to authenticated
      using(user_id=(select auth.uid()));
    create policy projects_access on public.projects for select to authenticated
      using(owner_id=(select auth.uid()) or exists(
        select 1 from public.project_members m where m.project_id=projects.id and m.user_id=(select auth.uid())));
    create policy files_access on public.project_files for select to authenticated
      using(exists(select 1 from public.projects p where p.id=project_files.project_id));
    create policy chunks_access on public.project_file_chunks for select to authenticated
      using(exists(select 1 from public.projects p where p.id=project_file_chunks.project_id));
    create policy library_self on public.user_library_items for select to authenticated
      using(user_id=(select auth.uid()));
    insert into auth.users values('${owner}'),('${other}');
    insert into public.projects values('${project}','${other}','Project instructions');
    insert into public.project_members values('${project}','${owner}');
    insert into public.project_files values('${file}','${project}','Shared file','text/plain');
    insert into public.project_file_chunks values('${file}','${project}','Project knowledge',0);
    insert into public.user_library_items values('${library}','${owner}','My document','notes.txt','text/plain','Private notes');
  `);
  for (const sql of sourceChain) await db.exec(sql);
  return db;
}

const createBranch = async (db, chat, conversation, extra = {}) => {
  const result = await db.query(
    `select * from public.create_chat_branch(
    p_chat_id=>$1,p_conversation_id=>$2,p_message_ids=>$3,p_parent_branch_id=>$4
  )`,
    [chat, conversation, extra.messageIds ?? ["message-1"], extra.parent ?? null],
  );
  return result.rows[0];
};

test("fresh source replay gains the complete canonical API and atomic conversation mappings", async () => {
  const db = await fixture();
  try {
    assert.equal(
      (
        await db.query(
          "select to_regprocedure('public.get_chat_workspace_state(text,text)') function",
        )
      ).rows[0].function,
      null,
    );
    await db.exec(migration);
    await db.exec(migration);
    await identify(db, owner);
    const root = await createBranch(db, "chat-1", "conversation-root");
    const child = await createBranch(db, "chat-1", "conversation-child", { parent: root.id });
    assert.equal(root.conversation_id, "conversation-root");
    assert.deepEqual(root.message_ids, ["message-1"]);
    assert.equal(child.parent_branch_id, root.id);
    const oldClient = (
      await db.query("select * from public.create_chat_branch(p_chat_id=>'old-chat')")
    ).rows[0];
    assert.ok(oldClient.conversation_id);
    await db.query("select public.activate_chat_branch($1)", [root.id]);
    assert.equal(
      (
        await db.query(
          "select count(*)::integer count from public.chat_branches where chat_id='chat-1' and active",
        )
      ).rows[0].count,
      1,
    );
    await db.query("select public.save_chat_custom_rules('chat-1','Use short answers',true)");
    const state = (await db.query("select public.get_chat_workspace_state('chat-1') result"))
      .rows[0].result;
    assert.equal(state.branches.length, 2);
    assert.equal(state.active_branch_id, root.id);
    assert.equal(state.custom_rules.instructions, "Use short answers");
    assert.deepEqual(state.branches.find((row) => row.id === root.id).message_ids, ["message-1"]);
    assert.equal(
      (await db.query("select public.delete_chat_custom_rules('chat-1') result")).rows[0].result,
      true,
    );
  } finally {
    await db.close();
  }
});

test("canonical and legacy versions share UTF-16 bounds, ownership and safe accepted-row switching", async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    await identify(db, owner);
    const first = (
      await db.query(`select * from public.create_chat_message_version(
      p_chat_id=>'chat-1',p_message_id=>'message-1',p_content=>'A😀B',
      p_selection_start=>1,p_selection_end=>3,p_accept=>true)`)
    ).rows[0];
    const second = (
      await db.query(`select * from public.kova_record_message_version(
      p_chat_id=>'chat-1',p_message_id=>'message-1',p_source=>'retry',p_content=>'Second version',p_accepted=>false)`)
    ).rows[0];
    assert.equal(second.version, first.version + 1);
    for (const version of [second, first, second]) {
      await db.query("select public.accept_chat_message_version($1)", [version.id]);
      const accepted = (
        await db.query("select id from public.chat_message_versions where accepted")
      ).rows;
      assert.deepEqual(accepted, [{ id: version.id }]);
    }
    await assert.rejects(
      db.query(`select public.create_chat_message_version(
      p_chat_id=>'chat-1',p_message_id=>'message-1',p_content=>'A😀B',p_selection_start=>1,p_selection_end=>5)`),
      /invalid_selection_range/,
    );
    await assert.rejects(
      db.query(
        `insert into public.chat_message_versions(
      owner_id,chat_id,message_id,version,source,content,selection_start,selection_end)
      values($1,'chat-1','bad-range',1,'original','abc',0,null)`,
        [owner],
      ),
      { code: "23514" },
    );
    await assert.rejects(
      db.query(
        `insert into public.chat_message_versions(
      owner_id,chat_id,message_id,version,source,content,selection_start,selection_end)
      values($1,'chat-1','empty-range',1,'original','abc',1,1)`,
        [owner],
      ),
      { code: "23514" },
    );
    const branch = await createBranch(db, "chat-other", "conversation-other");
    await assert.rejects(
      db.query(
        `insert into public.chat_message_versions(
      owner_id,chat_id,message_id,version,source,content,branch_id)
      values($1,'chat-1','wrong-branch',1,'original','abc',$2)`,
        [owner, branch.id],
      ),
      { code: "23514" },
    );
    await identify(db, other);
    await assert.rejects(db.query("select public.accept_chat_message_version($1)", [first.id]), {
      code: "P0002",
    });
    assert.deepEqual(
      (await db.query("select public.get_chat_workspace_state('chat-1','message-1') result"))
        .rows[0].result.message_versions,
      [],
    );
  } finally {
    await db.close();
  }
});

test("pinning and context reads respect current membership and bounded content", async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    await identify(db, owner);
    const privatePin = (
      await db.query("select * from public.pin_chat_source('chat-1','library',$1)", [library])
    ).rows[0];
    await db.query("select public.pin_chat_source('chat-1','project_file',$1,$2)", [file, project]);
    const context = (
      await db.query("select public.get_chat_context_bundle('chat-1',$1,1000) result", [project])
    ).rows[0].result;
    assert.equal(context.used_chars <= 1000, true);
    assert.ok(context.pinned_sources.some((row) => row.content === "Private notes"));
    assert.ok(context.pinned_sources.some((row) => row.content === "Project knowledge"));
    await identify(db, other);
    await assert.rejects(
      db.query("select public.pin_chat_source('chat-2','library',$1)", [library]),
      { code: "42501" },
    );
    await db.exec("reset role");
    await db.query("delete from public.project_members where project_id=$1 and user_id=$2", [
      project,
      owner,
    ]);
    await identify(db, owner);
    const revoked = (
      await db.query("select public.get_chat_context_bundle('chat-1',$1,1000) result", [project])
    ).rows[0].result;
    const inaccessible = revoked.pinned_sources.find((row) => row.source_id === file);
    assert.equal(inaccessible.status, "permission_lost");
    assert.equal(inaccessible.content, "");
    assert.equal(revoked.project_instructions, "");
    assert.equal(
      (await db.query("select public.unpin_chat_source($1) result", [privatePin.id])).rows[0]
        .result,
      true,
    );
  } finally {
    await db.close();
  }
});

test("the production positional overload converges without public definers or lock-order drift", async () => {
  const db = await fixture();
  try {
    await db.exec(`create function public.kova_record_message_version(
      p_chat_id text,p_message_id text,p_source text,p_content text,p_branch_id uuid default null,
      p_instruction text default null,p_original_content text default null,p_accepted boolean default true,
      p_selection_start integer default null,p_selection_end integer default null,p_max_versions integer default 50
    ) returns public.chat_message_versions language sql security definer as $$
      select public.kova_record_message_version($1,$2,$3,$4,$5,$6,$7,$9,$10,$8,$11)
    $$;`);
    await db.exec(migration);
    const functions = (
      await db.query(`select proname,prosecdef,pg_get_functiondef(p.oid) definition,
      has_function_privilege('anon',p.oid,'EXECUTE') anon,
      has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and proname in (
        'create_chat_message_version','accept_chat_message_version','create_chat_branch',
        'activate_chat_branch','save_chat_custom_rules','delete_chat_custom_rules',
        'pin_chat_source','unpin_chat_source','get_chat_context_bundle','get_chat_workspace_state',
        'kova_record_message_version','kova_accept_message_version','kova_create_chat_branch',
        'kova_activate_chat_branch','kova_update_chat_branch_messages')`)
    ).rows;
    assert.equal(
      functions.filter((row) => row.proname === "kova_record_message_version").length,
      1,
    );
    for (const row of functions) {
      assert.equal(row.prosecdef, false, row.proname);
      assert.equal(row.anon, false, row.proname);
      assert.equal(row.authenticated, true, row.proname);
    }
    const accept = functions
      .find((row) => row.proname === "kova_accept_message_version")
      .definition.toLowerCase();
    assert.ok(accept.indexOf("pg_advisory_xact_lock") < accept.indexOf("for update"));
    for (const name of [
      "kova_record_message_version",
      "kova_accept_message_version",
      "create_chat_message_version",
    ]) {
      assert.match(functions.find((row) => row.proname === name).definition, /kova:chat-version:/);
    }
    await identify(db, owner);
    await assert.rejects(
      createBranch(db, "chat-1", "dup-ids", { messageIds: ["same", "same"] }),
      /duplicate_branch_message_ids/,
    );
    await assert.rejects(
      createBranch(db, "chat-1", "large-list", {
        messageIds: Array.from({ length: 513 }, (_, i) => `m${i}`),
      }),
      /invalid_branch_message_ids/,
    );
  } finally {
    await db.close();
  }
});

test("current branch callers request the atomic mapping contract and never synthesize success", async () => {
  const source = await readFile(
    new URL("../../src/lib/chat-workspace.functions.ts", import.meta.url),
    "utf8",
  );
  const handler = source.slice(
    source.indexOf("export const createChatBranch"),
    source.indexOf("export const activateChatBranch"),
  );
  assert.match(
    handler,
    /name: "create_chat_branch",[\s\S]*?p_conversation_id: data\.conversationId/,
  );
  assert.match(handler, /branchRow\.conversation_id !== data\.conversationId/);
  assert.doesNotMatch(handler, /\.update\(mapping|toBranch\(\{ \.\.\.branchRow/);
});
