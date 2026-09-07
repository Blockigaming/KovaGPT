import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const userId = "11111111-1111-4111-8111-111111111111";
const workerId = "export-worker-shared-id";
const migration = "20260904225916_account_export_generation_outbox.sql";

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema kova_private; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
    create table storage.buckets(id text primary key, name text, public boolean,
      file_size_limit bigint, allowed_mime_types text[]);
    create table public.account_audit_entries(id uuid default gen_random_uuid(),
      user_id uuid references auth.users(id) on delete cascade, event_type text,
      safe_description text, actor_id uuid, target_id text, result text, metadata jsonb);
    insert into auth.users values ('${userId}');
  `);
  for (const name of [
    "20260903203000_account_data_exports.sql",
    "20260903204500_account_export_deletion_fence.sql",
    migration,
  ]) {
    await db.exec(
      await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8"),
    );
  }
  return db;
}

async function createClaim(db) {
  await db.query("insert into public.account_export_jobs(user_id) values ($1)", [userId]);
  return (await db.query("select * from public.claim_account_export_jobs($1,1,180)", [workerId]))
    .rows[0];
}

async function register(db, job) {
  return (
    await db.query("select public.register_account_export_artifact($1,$2,$3) as path", [
      job.id,
      workerId,
      job.upload_generation,
    ])
  ).rows[0].path;
}

function storageClient(db, objects, options = {}) {
  return {
    async rpc(name, args) {
      assert.equal(name, "claim_account_export_artifact_cleanup");
      const result = await db.query(
        "select * from public.claim_account_export_artifact_cleanup($1,$2)",
        [args.p_limit, args.p_user_id],
      );
      return { data: result.rows, error: null };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "account-exports");
        return {
          async remove(paths) {
            options.calls?.push(paths);
            if (options.fail) return { error: { message: "offline" } };
            for (const path of paths) objects.delete(path);
            return { error: null };
          },
        };
      },
    },
  };
}

async function loadWorker(admin) {
  let source = await readFile(
    new URL("../../src/lib/account-export.server.ts", import.meta.url),
    "utf8",
  );
  source = source.replace(
    'import { supabaseAdmin } from "@/integrations/supabase/client.server";',
    'const supabaseAdmin = globalThis[Symbol.for("account-export-generation-test")];',
  );
  source = source.replaceAll(/"(?:@\/lib\/|\.\/)([^"\n]+)"/gu, (_, path) =>
    JSON.stringify(new URL(`../../src/lib/${path}`, import.meta.url).href),
  );
  globalThis[Symbol.for("account-export-generation-test")] = admin;
  try {
    return await import(
      `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}#${crypto.randomUUID()}`
    );
  } finally {
    delete globalThis[Symbol.for("account-export-generation-test")];
  }
}

test("late upload after account deletion remains tracked and is removed by a later sweep", async () => {
  const db = await createDatabase();
  try {
    const job = await createClaim(db);
    const path = await register(db, job);
    const objects = new Set();
    const worker = await loadWorker(storageClient(db, objects));
    let finishUpload;
    const pausedUpload = new Promise((resolve) => {
      finishUpload = () => {
        objects.add(path);
        resolve();
      };
    });
    await db.query(
      "update public.account_export_jobs set lease_expires_at = now()-interval '1 second' where id=$1",
      [job.id],
    );
    await db.query("select public.begin_account_export_account_deletion($1)", [userId]);
    assert.equal(await worker.sweepRetiredAccountExportArtifacts(userId), 1);
    await db.query("delete from auth.users where id=$1", [userId]);
    assert.equal(
      (await db.query("select count(*)::int as n from public.account_export_jobs")).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("select state from public.account_export_artifacts")).rows[0].state,
      "retired",
    );
    // The first cleanup saw nothing and Auth has gone. The external request
    // then resumes; the surviving outbox makes this second pass possible.
    finishUpload();
    await pausedUpload;
    assert.ok(objects.has(path));
    await db.exec(
      "update public.account_export_artifacts set next_cleanup_at=now()-interval '1 second'",
    );
    assert.equal(await worker.sweepRetiredAccountExportArtifacts(), 1);
    assert.equal(objects.size, 0);
    assert.equal(
      (await db.query("select cleanup_attempts::int as n from public.account_export_artifacts"))
        .rows[0].n,
      2,
    );
    assert.equal(await register(db, job), null);
  } finally {
    await db.close();
  }
});

test("reclaim rotates generation even with the same worker ID and never cleans the new artifact", async () => {
  const db = await createDatabase();
  try {
    const old = await createClaim(db);
    const oldPath = await register(db, old);
    await db.query(
      "update public.account_export_jobs set lease_expires_at=now()-interval '1 second' where id=$1",
      [old.id],
    );
    const current = (
      await db.query("select * from public.claim_account_export_jobs($1,1,180)", [workerId])
    ).rows[0];
    assert.notEqual(current.upload_generation, old.upload_generation);
    const currentPath = await register(db, current);
    assert.equal(await register(db, old), null);
    const staleSettlement = await db.query(
      "select public.settle_account_export_failure($1,$2,'account_export_storage_unavailable',true,$3) as status",
      [old.id, workerId, old.upload_generation],
    );
    assert.equal(staleSettlement.rows[0].status, "superseded");
    const objects = new Set([oldPath, currentPath]);
    const worker = await loadWorker(storageClient(db, objects));
    assert.equal(await worker.sweepRetiredAccountExportArtifacts(), 1);
    assert.deepEqual([...objects], [currentPath]);
    const settled = await db.query(
      "select public.settle_account_export_success($1,$2,$3,$4,1234,$5) as ok",
      [current.id, workerId, currentPath, "a".repeat(64), current.upload_generation],
    );
    assert.equal(settled.rows[0].ok, true);
    assert.equal(
      (
        await db.query("select state from public.account_export_artifacts where generation=$1", [
          current.upload_generation,
        ])
      ).rows[0].state,
      "published",
    );
    assert.equal(await worker.sweepRetiredAccountExportArtifacts(), 0);
  } finally {
    await db.close();
  }
});

test("deletion fence denies registration and success without blocking crash recovery", async () => {
  const db = await createDatabase();
  try {
    const job = await createClaim(db);
    const path = await register(db, job);
    await db.query("select public.begin_account_export_account_deletion($1)", [userId]);
    assert.equal(await register(db, job), null);
    const settled = await db.query(
      "select public.settle_account_export_success($1,$2,$3,$4,1234,$5) as ok",
      [job.id, workerId, path, "b".repeat(64), job.upload_generation],
    );
    assert.equal(settled.rows[0].ok, false);
    await db.query(
      "update public.account_export_jobs set lease_expires_at=now()-interval '1 second' where id=$1",
      [job.id],
    );
    await db.query("select public.begin_account_export_account_deletion($1)", [userId]);
    assert.equal(
      (await db.query("select status from public.account_export_jobs")).rows[0].status,
      "canceled",
    );
    await db.query("select public.cancel_account_export_account_deletion($1)", [userId]);
    const replacement = await createClaim(db);
    assert.ok(await register(db, replacement));
    assert.equal(await register(db, job), null);
  } finally {
    await db.close();
  }
});

test("cleanup work is bounded and fair across retained obligations and failed requests", async () => {
  const db = await createDatabase();
  try {
    await db.exec(`insert into public.account_export_artifacts(generation,job_id,user_id,storage_path,state)
      select generation,job_id,'${userId}', '${userId}/'||job_id::text||'/'||generation::text||'.json','retired'
      from (select gen_random_uuid() generation,gen_random_uuid() job_id from generate_series(1,60)) entries;`);
    const objects = new Set(
      (await db.query("select storage_path from public.account_export_artifacts")).rows.map(
        (r) => r.storage_path,
      ),
    );
    const failing = await loadWorker(storageClient(db, objects, { fail: true }));
    await assert.rejects(
      failing.sweepRetiredAccountExportArtifacts(),
      /account_export_storage_unavailable/u,
    );
    const calls = [];
    const worker = await loadWorker(storageClient(db, objects, { calls }));
    assert.equal(await worker.sweepRetiredAccountExportArtifacts(), 25);
    assert.equal(await worker.sweepRetiredAccountExportArtifacts(), 10);
    assert.equal(await worker.sweepRetiredAccountExportArtifacts(), 0);
    assert.equal(objects.size, 25, "failed page remains due for retry, not forgotten");
    await db.exec(
      "update public.account_export_artifacts set next_cleanup_at=now()-interval '1 second' where cleanup_attempts=1",
    );
    // User-scoped deletion retries ignore the backoff but still advance in
    // next-cleanup order, so permanent tombstones cannot hide later paths.
    for (let i = 0; i < 3; i++) await worker.sweepRetiredAccountExportArtifacts(userId);
    assert.equal(objects.size, 0);
    assert.equal(
      (await db.query("select count(*)::int n from public.account_export_artifacts")).rows[0].n,
      60,
    );
    assert.ok(calls.every((paths) => paths.length === 1));
  } finally {
    await db.close();
  }
});

test("generation RPCs and durable identifiers are inaccessible to browser roles", async () => {
  const db = await createDatabase();
  try {
    for (const fn of [
      "register_account_export_artifact(uuid,text,uuid)",
      "claim_account_export_artifact_cleanup(integer,uuid)",
      "settle_account_export_success(uuid,text,text,text,bigint,uuid)",
      "settle_account_export_failure(uuid,text,text,boolean,uuid)",
    ]) {
      const result = await db.query(
        "select has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') authenticated,has_function_privilege('service_role',$1,'EXECUTE') service",
        [`public.${fn}`],
      );
      assert.deepEqual(result.rows, [{ anon: false, authenticated: false, service: true }]);
    }
    const table = await db.query(
      "select relrowsecurity as rls,has_table_privilege('authenticated','public.account_export_artifacts','SELECT') browser_select from pg_class where oid='public.account_export_artifacts'::regclass",
    );
    assert.deepEqual(table.rows, [{ rls: true, browser_select: false }]);
    await assert.rejects(
      db.query("select public.settle_account_export_failure(null,null,null,true)"),
      /does not exist/u,
    );
  } finally {
    await db.close();
  }
});

test("the real worker registers before upload and a resumed stale worker preserves its successor", async () => {
  const db = await createDatabase();
  try {
    await db.query("insert into public.account_export_jobs(user_id) values ($1)", [userId]);
    const objects = new Set();
    let releaseUpload;
    let reachedUpload;
    const entered = new Promise((resolve) => {
      reachedUpload = resolve;
    });
    const paused = new Promise((resolve) => {
      releaseUpload = resolve;
    });
    const admin = {
      auth: {
        admin: { getUserById: async () => ({ data: { user: { id: userId } }, error: null }) },
      },
      from(table) {
        const filters = [];
        const query = {
          select() {
            return query;
          },
          order() {
            return query;
          },
          eq(column, value) {
            filters.push([column, value]);
            return query;
          },
          lt() {
            return query;
          },
          order() {
            return query;
          },
          limit() {
            return query;
          },
          async range() {
            return { data: [], error: null };
          },
          async maybeSingle() {
            assert.equal(table, "account_export_jobs");
            const id = filters.find(([column]) => column === "id")[1];
            const data = (
              await db.query("select * from public.account_export_jobs where id=$1", [id])
            ).rows[0];
            return { data: JSON.parse(JSON.stringify(data)), error: null };
          },
        };
        return query;
      },
      async rpc(name, args) {
        assert.ok(
          [
            "claim_account_export_artifact_cleanup",
            "claim_account_export_jobs",
            "register_account_export_artifact",
            "settle_account_export_success",
            "settle_account_export_failure",
          ].includes(name),
        );
        const entries = Object.entries(args);
        const parameters = entries.map(([key], index) => `${key} => $${index + 1}`).join(",");
        const scalar = name.startsWith("settle_") || name.startsWith("register_");
        const result = await db.query(
          scalar
            ? `select public.${name}(${parameters}) as value`
            : `select * from public.${name}(${parameters})`,
          entries.map(([, value]) => value),
        );
        return {
          data: scalar ? result.rows[0].value : JSON.parse(JSON.stringify(result.rows)),
          error: null,
        };
      },
      storage: {
        from() {
          return {
            async upload(path) {
              assert.equal(
                (
                  await db.query(
                    "select state from public.account_export_artifacts where storage_path=$1",
                    [path],
                  )
                ).rows[0].state,
                "pending",
              );
              reachedUpload(path);
              await paused;
              objects.add(path);
              return { error: null };
            },
            async remove(paths) {
              paths.forEach((path) => objects.delete(path));
              return { error: null };
            },
          };
        },
      },
    };
    const worker = await loadWorker(admin);
    const running = worker.runAccountExportBatch({ workerId, limit: 1 });
    const oldPath = await Promise.race([
      entered,
      running.then(() => {
        throw new Error("export worker finished before reaching the upload barrier");
      }),
    ]);
    await db.exec(
      "update public.account_export_jobs set lease_expires_at=now()-interval '1 second'",
    );
    const successor = (
      await db.query("select * from public.claim_account_export_jobs($1,1,180)", [workerId])
    ).rows[0];
    const successorPath = await register(db, successor);
    objects.add(successorPath);
    releaseUpload();
    const result = await running;
    assert.equal(result.superseded, 1);
    assert.equal(result.complete, 0);
    assert.ok(!objects.has(oldPath));
    assert.deepEqual([...objects], [successorPath]);
    assert.equal(
      (await db.query("select status from public.account_export_jobs")).rows[0].status,
      "processing",
    );
  } finally {
    await db.close();
  }
});

test("exports retain reservation metadata but embed only ready or legacy Project file bodies", async () => {
  const projectId = "22222222-2222-4222-8222-222222222222";
  const rows = [undefined, "ready", "pending", "deleting", "failed"].map((status, index) => ({
    id: `33333333-3333-4333-8333-33333333333${index}`,
    project_id: projectId,
    uploaded_by: userId,
    storage_path: `${projectId}/file-${index}.txt`,
    ...(status === undefined ? {} : { status }),
  }));
  const downloads = [];
  const admin = {
    auth: { admin: { getUserById: async () => ({ data: { user: { id: userId } }, error: null }) } },
    from(table) {
      const query = {
        select() {
          return query;
        },
        order() {
          return query;
        },
        eq() {
          return query;
        },
        in() {
          return query;
        },
        order() {
          return query;
        },
        async range() {
          return {
            data:
              table === "projects"
                ? [{ id: projectId, owner_id: userId }]
                : table === "project_files"
                  ? rows
                  : [],
            error: null,
          };
        },
      };
      return query;
    },
    storage: {
      from(bucket) {
        return {
          async download(path) {
            downloads.push({ bucket, path });
            assert.ok([rows[0].storage_path, rows[1].storage_path].includes(path));
            return { data: new Blob(["ready body"]), error: null };
          },
        };
      },
    },
  };
  const worker = await loadWorker(admin);
  const artifact = JSON.parse(
    (await worker.buildAccountExport(userId, "44444444-4444-4444-8444-444444444444")).text,
  );
  assert.deepEqual(artifact.records.project_files, rows);
  assert.deepEqual(
    downloads,
    rows.slice(0, 2).map((row) => ({ bucket: "project-files", path: row.storage_path })),
  );
  assert.equal(artifact.files.length, 2);
});

test("personal organization exports include both invitation/audit roles without unrelated tenant records", async () => {
  const another = "22222222-2222-4222-8222-222222222222";
  const org = "33333333-3333-4333-8333-333333333333";
  const data = {
    organizations: [
      { id: org, created_by: userId, name: "Owned" },
      { id: another, created_by: another },
    ],
    organization_members: [
      { organization_id: org, user_id: userId },
      { organization_id: org, user_id: another },
    ],
    organization_invitations: [
      { id: "sent", invited_by: userId, recipient_user_id: another },
      { id: "received", invited_by: another, recipient_user_id: userId },
      { id: "private", invited_by: another, recipient_user_id: another },
    ],
    organization_audit_events: [
      { id: 1, actor_user_id: userId, subject_user_id: userId },
      { id: 2, actor_user_id: another, subject_user_id: userId },
      { id: 3, actor_user_id: another, subject_user_id: another },
    ],
  };
  const ordered = new Set();
  const admin = {
    auth: { admin: { getUserById: async () => ({ data: { user: { id: userId } }, error: null }) } },
    from(table) {
      let rows = data[table] ?? [];
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          rows = rows.filter((row) => row[column] === value);
          return query;
        },
        in(column, values) {
          rows = rows.filter((row) => values.includes(row[column]));
          return query;
        },
        order() {
          ordered.add(table);
          return query;
        },
        async range(from, through) {
          return { data: rows.slice(from, through + 1), error: null };
        },
      };
      return query;
    },
    storage: { from: () => assert.fail("No organization content download is authorized") },
  };
  const worker = await loadWorker(admin);
  const artifact = JSON.parse((await worker.buildAccountExport(userId, org)).text);
  assert.deepEqual(artifact.records.organization_invitations.map((row) => row.id).sort(), [
    "received",
    "sent",
  ]);
  assert.deepEqual(
    artifact.records.organization_audit_events.map((row) => row.id),
    [1, 2],
  );
  assert.equal(artifact.records.organization_members.length, 1);
  assert.equal(artifact.records.organizations.length, 1);
  assert.equal(artifact.records.organization_domains, undefined);
  assert.equal(artifact.records.organization_sso_connections, undefined);
  for (const table of Object.keys(data)) assert.ok(ordered.has(table), table);
});

test("Canvas export keeps private and owned Project content without widening collaborator access", async () => {
  const data = {
    projects: [{ id: "owned", owner_id: userId }],
    project_members: [{ project_id: "shared", user_id: userId }],
    canvas_documents: [
      { id: "private", private_owner_id: userId, project_id: null, content: "personal" },
      { id: "owned-doc", private_owner_id: null, project_id: "owned", content: "owned project" },
      { id: "shared-doc", private_owner_id: null, project_id: "shared", content: "shared project" },
      {
        id: "revoked-doc",
        private_owner_id: null,
        project_id: "revoked",
        content: "revoked content",
      },
      {
        id: "foreign-private",
        private_owner_id: "another",
        project_id: null,
        content: "foreign secret",
      },
    ],
    canvas_revisions: [
      { document_id: "private", revision: 1, content: "earlier personal" },
      { document_id: "shared-doc", revision: 1, content: "shared earlier" },
    ],
    canvas_comments: [
      { id: "own", document_id: "private", author_id: userId, body: "mine" },
      { id: "project", document_id: "owned-doc", author_id: "another", body: "project comment" },
      { id: "shared-own", document_id: "shared-doc", author_id: userId, body: "my shared comment" },
      {
        id: "shared-other",
        document_id: "shared-doc",
        author_id: "another",
        body: "other shared comment",
      },
      { id: "revoked", document_id: "revoked-doc", author_id: userId, body: "now inaccessible" },
      {
        id: "forged",
        document_id: "foreign-private",
        author_id: userId,
        body: "must not widen access",
      },
    ],
    collaboration_presence: [{ id: "ephemeral", user_id: userId }],
  };
  const admin = {
    auth: { admin: { getUserById: async () => ({ data: { user: { id: userId } }, error: null }) } },
    from(table) {
      let rows = data[table] ?? [];
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          rows = rows.filter((row) => row[column] === value);
          return query;
        },
        in(column, values) {
          rows = rows.filter((row) => values.includes(row[column]));
          return query;
        },
        order() {
          return query;
        },
        async range(from, through) {
          return { data: rows.slice(from, through + 1), error: null };
        },
      };
      return query;
    },
    storage: { from: () => assert.fail("Canvas text export requires no Storage download") },
  };
  const worker = await loadWorker(admin);
  const result = JSON.parse(
    (await worker.buildAccountExport(userId, "44444444-4444-4444-8444-444444444444")).text,
  ).records;
  assert.deepEqual(
    result.canvas_documents.map((row) => row.id),
    ["private", "owned-doc"],
  );
  assert.deepEqual(
    result.canvas_revisions.map((row) => row.content),
    ["earlier personal"],
  );
  assert.deepEqual(
    result.canvas_comments.map((row) => row.id),
    ["own", "project"],
  );
  assert.deepEqual(
    result.canvas_comments_authored.map((row) => row.id),
    ["own", "shared-own"],
  );
  assert.equal(result.collaboration_presence, undefined);
  assert.doesNotMatch(
    JSON.stringify(result),
    /foreign secret|now inaccessible|other shared comment/,
  );
});
