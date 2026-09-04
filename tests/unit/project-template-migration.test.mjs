import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationPath = "supabase/migrations/20260903220000_project_templates.sql";
const ownerId = "11111111-1111-4111-8111-111111111111";
const granteeId = "22222222-2222-4222-8222-222222222222";
const outsiderId = "33333333-3333-4333-8333-333333333333";
const snapshotV1 = {
  projectName: "Research plan",
  projectDescription: "Evidence-first project",
  systemPrompt: "Use primary sources.",
  color: "#10a37f",
};
const snapshotV2 = {
  projectName: "Research plan v2",
  projectDescription: "Updated instructions",
  systemPrompt: "Use primary sources and cite them.",
  color: "blue",
};

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT null::uuid $$;
    CREATE TABLE public.projects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL REFERENCES auth.users(id),
      name text NOT NULL,
      description text,
      system_prompt text,
      color text,
      archived_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.account_audit_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id),
      event_type text NOT NULL,
      safe_description text NOT NULL,
      actor_id uuid,
      target_id text,
      result text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO auth.users(id) VALUES ('${ownerId}'), ('${granteeId}'), ('${outsiderId}');
  `);
  await database.exec(await readFile(migrationPath, "utf8"));
  return database;
}

async function createTemplate(database, mutationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") {
  const created = await database.query(
    "select public.create_project_template($1,$2,'Research template','Reusable',$3) result",
    [ownerId, mutationId, snapshotV1],
  );
  return created.rows[0].result;
}

test("templates retain immutable versions and reject stale revisions", async () => {
  const database = await createDatabase();
  try {
    const first = await createTemplate(database);
    assert.equal(first.version, 1);
    assert.equal(first.revision, 1);
    const replay = await database.query(
      "select public.create_project_template($1,$2,'Research template','Reusable',$3) result",
      [ownerId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", snapshotV1],
    );
    assert.deepEqual(replay.rows[0].result, first);
    await assert.rejects(
      () =>
        database.query("select public.create_project_template($1,$2,'Changed','Reusable',$3)", [
          ownerId,
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          snapshotV1,
        ]),
      /project_template_mutation_reused/u,
    );
    const next = await database.query(
      "select public.publish_project_template_version($1,$2,$3,1,$4) result",
      [ownerId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", first.templateId, snapshotV2],
    );
    assert.equal(next.rows[0].result.version, 2);
    assert.equal(next.rows[0].result.revision, 2);
    await assert.rejects(
      () =>
        database.query("select public.publish_project_template_version($1,$2,$3,1,$4)", [
          ownerId,
          "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          first.templateId,
          snapshotV2,
        ]),
      /project_template_revision_conflict/u,
    );
    const versions = await database.query(
      "select version,snapshot from public.project_template_versions where template_id=$1 order by version",
      [first.templateId],
    );
    assert.deepEqual(versions.rows, [
      { version: 1, snapshot: snapshotV1 },
      { version: 2, snapshot: snapshotV2 },
    ]);
  } finally {
    await database.close();
  }
});

test("sharing separates view permission from copy permission and revokes access", async () => {
  const database = await createDatabase();
  try {
    const template = await createTemplate(database);
    const shared = await database.query(
      "select public.share_project_template($1,$2,$3,1,$4,false) result",
      [ownerId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", template.templateId, granteeId],
    );
    assert.equal(shared.rows[0].result.canCopy, false);
    const visible = await database.query(
      "select public.get_project_template_version($1,$2,null) result",
      [granteeId, template.templateId],
    );
    assert.equal(visible.rows[0].result.snapshot.projectName, snapshotV1.projectName);
    assert.equal(visible.rows[0].result.canCopy, false);
    await assert.rejects(
      () =>
        database.query("select public.copy_project_template($1,$2,$3,null,3)", [
          granteeId,
          "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          template.templateId,
        ]),
      /project_template_copy_denied/u,
    );
    const updated = await database.query(
      "select public.share_project_template($1,$2,$3,2,$4,true) result",
      [ownerId, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", template.templateId, granteeId],
    );
    assert.equal(updated.rows[0].result.revision, 3);
    const copied = await database.query(
      "select public.copy_project_template($1,$2,$3,1,3) result",
      [granteeId, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", template.templateId],
    );
    const projectId = copied.rows[0].result.projectId;
    const project = await database.query(
      "select owner_id,name,description,system_prompt,color from public.projects where id=$1",
      [projectId],
    );
    assert.deepEqual(project.rows, [
      {
        owner_id: granteeId,
        name: snapshotV1.projectName,
        description: snapshotV1.projectDescription,
        system_prompt: snapshotV1.systemPrompt,
        color: snapshotV1.color,
      },
    ]);
    const copyReplay = await database.query(
      "select public.copy_project_template($1,$2,$3,1,3) result",
      [granteeId, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", template.templateId],
    );
    assert.deepEqual(copyReplay.rows[0].result, copied.rows[0].result);
    const revoked = await database.query(
      "select public.revoke_project_template_grant($1,$2,$3,3,$4) result",
      [ownerId, "ffffffff-ffff-4fff-8fff-ffffffffffff", template.templateId, granteeId],
    );
    assert.equal(revoked.rows[0].result.revision, 4);
    await assert.rejects(
      () =>
        database.query("select public.get_project_template_version($1,$2,null)", [
          granteeId,
          template.templateId,
        ]),
      /project_template_permission_denied/u,
    );
    await assert.rejects(
      () =>
        database.query("select public.get_project_template_version($1,$2,null)", [
          outsiderId,
          template.templateId,
        ]),
      /project_template_permission_denied/u,
    );
  } finally {
    await database.close();
  }
});

test("copying enforces the active Project cap atomically", async () => {
  const database = await createDatabase();
  try {
    const template = await createTemplate(database);
    for (let index = 0; index < 3; index += 1) {
      await database.query(
        "insert into public.projects(owner_id,name,color) values ($1,$2,'blue')",
        [ownerId, `Existing ${index + 1}`],
      );
    }
    await assert.rejects(
      () =>
        database.query("select public.copy_project_template($1,$2,$3,null,3)", [
          ownerId,
          "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          template.templateId,
        ]),
      /project_limit_reached/u,
    );
    const count = await database.query(
      "select count(*)::integer count from public.projects where owner_id=$1",
      [ownerId],
    );
    assert.equal(count.rows[0].count, 3);
  } finally {
    await database.close();
  }
});

test("archiving revokes all grants while preserving versions and audits", async () => {
  const database = await createDatabase();
  try {
    const template = await createTemplate(database);
    await database.query("select public.share_project_template($1,$2,$3,1,$4,true)", [
      ownerId,
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      template.templateId,
      granteeId,
    ]);
    const archived = await database.query(
      "select public.archive_project_template($1,$2,$3,2) result",
      [ownerId, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", template.templateId],
    );
    assert.equal(archived.rows[0].result.revision, 3);
    const retained = await database.query(
      "select count(*)::integer count from public.project_template_versions where template_id=$1",
      [template.templateId],
    );
    assert.equal(retained.rows[0].count, 1);
    const grants = await database.query(
      "select revoked_at is not null revoked from public.project_template_grants where template_id=$1",
      [template.templateId],
    );
    assert.deepEqual(grants.rows, [{ revoked: true }]);
    const audit = await database.query(
      "select event_type,metadata from public.project_template_audit_events where template_id=$1 order by created_at",
      [template.templateId],
    );
    assert.deepEqual(
      audit.rows.map((row) => row.event_type),
      ["created", "shared", "archived"],
    );
    assert.doesNotMatch(JSON.stringify(audit.rows), /Use primary sources/u);
  } finally {
    await database.close();
  }
});

test("browser roles are read-only and all template functions are invoker/service-only", async () => {
  const database = await createDatabase();
  try {
    const privileges = await database.query(`
      select
        has_table_privilege('authenticated','public.project_templates','SELECT') authenticated_read,
        has_table_privilege('authenticated','public.project_templates','INSERT') authenticated_write,
        has_table_privilege('anon','public.project_templates','SELECT') anon_read,
        has_function_privilege(
          'authenticated','public.copy_project_template(uuid,uuid,uuid,integer,integer)','EXECUTE'
        ) authenticated_execute,
        has_function_privilege(
          'service_role','public.copy_project_template(uuid,uuid,uuid,integer,integer)','EXECUTE'
        ) service_execute
    `);
    assert.deepEqual(privileges.rows, [
      {
        authenticated_read: true,
        authenticated_write: false,
        anon_read: false,
        authenticated_execute: false,
        service_execute: true,
      },
    ]);
    const functions = await database.query(`
      select proname,prosecdef,proconfig
      from pg_proc
      where proname in (
        'project_template_snapshot_valid','create_project_template',
        'publish_project_template_version','share_project_template',
        'revoke_project_template_grant','archive_project_template',
        'copy_project_template','list_project_templates',
        'get_project_template_version','purge_project_template_mutation_receipts'
      )
      order by proname
    `);
    assert.equal(functions.rows.length, 10);
    for (const row of functions.rows) {
      assert.equal(row.prosecdef, false);
      assert.deepEqual(row.proconfig, ['search_path=""']);
    }
  } finally {
    await database.close();
  }
});
