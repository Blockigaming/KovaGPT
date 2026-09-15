import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const migration = await readFile(
  "supabase/migrations/20260904235854_semantic_workspace_search.sql",
  "utf8",
);
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const project = "33333333-3333-4333-8333-333333333333",
  library = "44444444-4444-4444-8444-444444444444";
const vector = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema kova_private;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz,is_anonymous boolean);
    insert into auth.users(id) values('${owner}'),('${other}');
    create table public.projects(id uuid primary key,owner_id uuid,name text,description text,updated_at timestamptz default now());
    create table public.project_members(project_id uuid,user_id uuid);
    create table public.project_chats(id uuid primary key,project_id uuid,title text,updated_at timestamptz default now());
    create table public.project_files(id uuid primary key,project_id uuid,name text,mime_type text,status text,created_at timestamptz default now());
    create table public.project_memory(id uuid primary key,project_id uuid,content text,created_at timestamptz default now());
    create table public.user_library_items(id uuid primary key,user_id uuid,title text,item_type text,content_text text,updated_at timestamptz default now());
    create table public.context_packs(id uuid primary key,user_id uuid,name text,description text,updated_at timestamptz default now());
    create table public.deep_research_runs(id uuid primary key,user_id uuid,project_id uuid,query text,report text,updated_at timestamptz default now());
    create table public.scheduled_tasks(id uuid primary key,user_id uuid,title text,prompt text,updated_at timestamptz default now());
    create table public.prompt_templates(id uuid primary key,user_id uuid,project_id uuid,name text,body text,updated_at timestamptz default now());
    create table public.goals(id uuid primary key,owner_id uuid,project_id uuid,title text,description text,updated_at timestamptz default now());
    create table public.account_deletion_fences(user_id uuid primary key);
    grant all on all tables in schema public to service_role;grant select on all tables in schema public to authenticated;
    alter table public.projects enable row level security;
    create policy project_access on public.projects for select to authenticated using(owner_id=auth.uid() or exists(select 1 from project_members m where m.project_id=projects.id and m.user_id=auth.uid()));`);
  for (const table of ["project_chats", "project_files", "project_memory"])
    await db.exec(
      `alter table ${table} enable row level security;create policy member_access on ${table} for select to authenticated using(exists(select 1 from projects p where p.id=project_id));`,
    );
  for (const table of [
    "user_library_items",
    "context_packs",
    "deep_research_runs",
    "scheduled_tasks",
    "prompt_templates",
    "goals",
  ]) {
    const column = table === "goals" ? "owner_id" : "user_id";
    await db.exec(
      `alter table ${table} enable row level security;create policy own_access on ${table} for select to authenticated using(${column}=auth.uid());`,
    );
  }
  await db.exec(
    await readFile("supabase/migrations/20260905001736_private_auth_identity_helpers.sql", "utf8"),
  );
  await db.exec(migration);
  await db.exec(`insert into projects values('${project}','${owner}','Launch plan','Plan the September launch',now());
    insert into user_library_items values('${library}','${other}','Private strategy','document','Secret launch details',now());`);
  return db;
}
async function claim(db, model = "embedding-v1") {
  return (await db.query("select * from claim_workspace_search_jobs($1)", [model])).rows;
}
async function settle(db, job, v = vector, model = "embedding-v1") {
  return (
    await db.query("select settle_workspace_search_job($1,$2,$3,$4,$5::real[]) accepted", [
      job.id,
      job.revision,
      job.lease_token,
      model,
      v,
    ])
  ).rows[0].accepted;
}
async function search(db, user, query = "launch", embedding = vector) {
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${user}';`);
  try {
    return (
      await db.query("select * from search_workspace_sources($1,$2::real[],$3)", [
        query,
        embedding,
        "embedding-v1",
      ])
    ).rows;
  } finally {
    await db.exec("reset role;");
  }
}
test("semantic and lexical search recheck current RLS, including shared Project revocation", async () => {
  const db = await fixture();
  try {
    for (const job of await claim(db)) assert.equal(await settle(db, job), true);
    assert.deepEqual(
      (await search(db, owner)).map((r) => r.source_id),
      [project],
    );
    assert.deepEqual(
      (await search(db, other)).map((r) => r.source_id),
      [library],
    );
    await db.exec(`insert into project_members values('${project}','${other}');`);
    assert.equal((await search(db, other)).length, 2);
    await db.exec(`delete from project_members where user_id='${other}';`);
    assert.deepEqual(
      (await search(db, other)).map((r) => r.source_id),
      [library],
    );
    const lexical = await search(db, owner, "September", null);
    assert.equal(lexical[0].semantic, false);
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${other}';`);
    assert.equal(
      (await db.query("select count(*)::int n from workspace_search_index")).rows[0].n,
      1,
    );
    await assert.rejects(claim(db), /permission denied/);
  } finally {
    await db.close();
  }
});
test("updates, deletion, and account deletion permanently fence old embedding workers", async () => {
  const db = await fixture();
  try {
    let jobs = await claim(db);
    const old = jobs.find((j) => j.input_text.startsWith("Launch"));
    await db.exec(`update projects set description='A revised plan' where id='${project}';`);
    assert.equal(await settle(db, old), false);
    const changed = (await claim(db)).find((j) => j.input_text.startsWith("Launch"));
    assert.ok(changed.revision > old.revision);
    await db.exec(`insert into account_deletion_fences values('${owner}');`);
    await db.exec(`delete from account_deletion_fences where user_id='${owner}';`);
    assert.equal(await settle(db, changed), false);
    const recreated = (await claim(db)).find((j) => j.input_text.startsWith("Launch"));
    assert.notEqual(recreated.id, changed.id);
    await db.exec(`delete from projects where id='${project}';`);
    assert.equal(await settle(db, recreated), false);
    assert.equal((await search(db, owner)).length, 0);
  } finally {
    await db.close();
  }
});
test("vectors are validated, raw source bodies are not stored, and failed jobs stop after three claims", async () => {
  const db = await fixture();
  try {
    const first = (await claim(db))[0];
    await assert.rejects(settle(db, first, []), /invalid_workspace_embedding/);
    await assert.rejects(settle(db, first, Array(1536).fill(0)), /invalid_workspace_embedding/);
    await assert.rejects(settle(db, first, Array(1536).fill("NaN")), /invalid_workspace_embedding/);
    assert.equal(await settle(db, first, null), true);
    for (let i = 0; i < 2; i++) {
      await db.exec(
        "update workspace_search_index set next_attempt_at=now()-interval '1 minute' where state='pending';",
      );
      const job = (await claim(db)).find((j) => j.id === first.id);
      assert.ok(job);
      await settle(db, job, null);
    }
    assert.equal(
      (await db.query("select state from workspace_search_index where id=$1", [first.id])).rows[0]
        .state,
      "failed",
    );
    const columns = (
      await db.query(
        "select column_name from information_schema.columns where table_name='workspace_search_index'",
      )
    ).rows;
    assert.equal(
      columns.some((c) => /body|content|input_text|title/.test(c.column_name)),
      false,
    );
  } finally {
    await db.close();
  }
});
test("a changed embedding model queues bounded fresh work and excludes incompatible vectors", async () => {
  const db = await fixture();
  try {
    for (const job of await claim(db)) await settle(db, job);
    assert.equal((await claim(db, "embedding-v2")).length, 2);
    assert.equal((await search(db, owner))[0].semantic, false);
  } finally {
    await db.close();
  }
});

test("service-role indexing skips legacy rows whose Auth owner no longer exists", async () => {
  const db = await fixture();
  try {
    await db.exec(
      "insert into user_library_items(id,user_id,title,item_type) values('55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666','Orphan','document');set role service_role;",
    );
    await assert.rejects(db.query("select id from auth.users"), /permission denied/);
    const jobs = await claim(db);
    assert.equal(jobs.length, 2);
    for (const job of jobs) assert.equal(await settle(db, job), true);
  } finally {
    await db.close();
  }
});
