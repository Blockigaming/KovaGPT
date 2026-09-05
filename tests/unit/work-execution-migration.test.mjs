import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { publishWorkProjectOutput } from "../../src/lib/work-output-publisher.mjs";
import { sha256Hex } from "../../src/lib/project-files-policy.mjs";
import {
  admitWorkRun,
  transitionWorkRun,
  WORK_RUNNER_CAPABILITIES,
} from "../../src/lib/work-execution-protocol.mjs";
const OWNER = "11111111-1111-4111-8111-111111111111",
  OTHER = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333",
  ID = "44444444-4444-4444-8444-444444444444";
const SESSION = "55555555-5555-4555-8555-555555555555",
  RUNNER = "66666666-6666-4666-8666-666666666666";
const migration = await readFile(
  new URL(
    "../../supabase/migrations/20260905002615_unified_work_execution_protocol.sql",
    import.meta.url,
  ),
  "utf8",
);
async function fixture() {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
   CREATE SCHEMA auth; CREATE SCHEMA kova_private;
   CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE SQL AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   CREATE FUNCTION kova_private.auth_user_exists(p_user_id uuid) RETURNS boolean LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$SELECT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id AND deleted_at IS NULL)$$;
   REVOKE ALL ON FUNCTION kova_private.auth_user_exists(uuid) FROM PUBLIC;
   GRANT USAGE ON SCHEMA auth,kova_private TO service_role;
   GRANT EXECUTE ON FUNCTION kova_private.auth_user_exists(uuid) TO service_role;
   CREATE TABLE public.account_deletion_fences(user_id uuid PRIMARY KEY);
   CREATE TABLE public.user_preferences(user_id uuid PRIMARY KEY,settings jsonb);
   CREATE TABLE public.work_saved_records(owner_id uuid,id uuid,kind text,revision bigint,deleted_at timestamptz,payload jsonb,PRIMARY KEY(owner_id,id));
   CREATE TABLE public.user_library_items(id uuid PRIMARY KEY,user_id uuid,title text,item_type text,source text,file_name text,file_type text,file_size bigint,file_url text,metadata jsonb);
   CREATE TABLE public.projects(id uuid PRIMARY KEY,deletion_requested_at timestamptz);
   CREATE TABLE public.project_members(project_id uuid,user_id uuid,role text);
   CREATE TABLE public.project_files(id uuid PRIMARY KEY,project_id uuid,status text,content_sha256 text,size_bytes bigint,mime_type text,name text,
     uploaded_by uuid,storage_owner_id uuid,upload_attempt_id uuid,storage_path text,upload_lease_until timestamptz,updated_at timestamptz);
   CREATE TABLE public.notification_preferences(user_id uuid PRIMARY KEY,in_app_enabled boolean,categories jsonb);
   CREATE TABLE public.app_notifications(id uuid DEFAULT gen_random_uuid(),owner_id uuid,type text,title text,safe_preview text,action_url text,source_entity text,delivery_state text);
   GRANT SELECT ON public.account_deletion_fences,public.user_preferences,public.work_saved_records,public.user_library_items,public.notification_preferences TO service_role;
   GRANT INSERT ON public.app_notifications TO service_role;
   GRANT UPDATE ON public.work_saved_records TO service_role;
   GRANT SELECT,UPDATE ON public.projects,public.project_members TO service_role;
   GRANT SELECT,UPDATE ON public.project_files TO service_role;
   GRANT INSERT ON public.user_library_items TO service_role;
  `);
    await db.query("INSERT INTO auth.users(id) VALUES($1),($2)", [OWNER, OTHER]);
    await db.exec(migration);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
async function run(session = null, project = null) {
  const now = Date.now();
  return admitWorkRun(
    {
      mutationId: ID,
      objective: "Review a report",
      source: "work",
      sessionId: session,
      sessionRevision: session ? 2 : null,
      projectId: project,
    },
    {
      sessionContext: session ? { objective: "Plan", context: "Context", steps: [] } : null,
      runId: RUN,
      ownerId: OWNER,
      model: "gpt-5.6-luna",
      plan: "plus",
      accountActive: true,
      lockdownAllowed: true,
      costAllowed: true,
      maxActions: 10,
      maxTokens: 1000,
      maxCostMicros: 10000,
      runtimeMs: 900000,
    },
    {
      id: RUNNER,
      protocol: "kova-work-v1",
      build: "a".repeat(40),
      authenticated: true,
      enabled: true,
      heartbeatAt: now,
      expiresAt: now + 50000,
      capabilities: [...WORK_RUNNER_CAPABILITIES],
    },
    now,
  );
}
async function commit(db, state, options = {}) {
  await db.exec("SET ROLE service_role");
  try {
    return (
      await db.query("SELECT public.commit_work_execution($1,$2,$3,$4,$5,$6,$7,$8) result", [
        options.owner ?? OWNER,
        state.id,
        options.mutation ?? ID,
        options.hash ?? "a".repeat(64),
        options.expected ?? state.revision - 1,
        state,
        options.ready === false ? null : new Date(Date.now() + 45000).toISOString(),
        options.concurrency ?? 1,
      ])
    ).rows[0].result;
  } finally {
    await db.exec("RESET ROLE");
  }
}
test("service admission works without SELECT on auth.users and all user mutation paths are denied", async () => {
  const db = await fixture();
  try {
    assert.equal(
      (await db.query("SELECT has_table_privilege('service_role','auth.users','SELECT') permitted"))
        .rows[0].permitted,
      false,
    );
    const state = await run();
    assert.equal((await commit(db, state)).state.id, RUN);
    await db.exec("SET ROLE authenticated");
    await assert.rejects(
      db.query("SELECT public.commit_work_execution($1,$2,$3,$4,0,$5,NULL,1)", [
        OWNER,
        RUN,
        ID,
        "a".repeat(64),
        state,
      ]),
      /permission denied/,
    );
    await assert.rejects(
      db.query("UPDATE public.work_execution_runs SET status='completed'"),
      /permission denied/,
    );
    await assert.rejects(
      db.query(
        "INSERT INTO public.work_execution_events(run_id,owner_id,revision,kind,detail) VALUES($1,$2,99,'forged','{}')",
        [RUN, OWNER],
      ),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
test("missing heartbeat, deleted Auth, Lockdown, and deletion fence create no queued run", async () => {
  const db = await fixture();
  try {
    const state = await run();
    await assert.rejects(commit(db, state, { ready: false }), /admission_unavailable/);
    await db.query("INSERT INTO public.account_deletion_fences VALUES($1)", [OWNER]);
    await assert.rejects(commit(db, state), /account_unavailable/);
    await db.exec("DELETE FROM public.account_deletion_fences");
    await db.query("UPDATE auth.users SET deleted_at=now() WHERE id=$1", [OWNER]);
    await assert.rejects(commit(db, state), /account_unavailable/);
    await db.exec("UPDATE auth.users SET deleted_at=NULL");
    await db.query("INSERT INTO public.user_preferences VALUES($1,'{\"lockdown_mode\":true}')", [
      OWNER,
    ]);
    await assert.rejects(commit(db, state), /lockdown/);
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM public.work_execution_runs")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
test("planning session admission binds the exact owned live revision", async () => {
  const db = await fixture();
  try {
    const state = await run(SESSION);
    await assert.rejects(commit(db, state), /session_conflict/);
    await db.query(
      'INSERT INTO public.work_saved_records VALUES($1,$2,\'session\',1,NULL,\'{"objective":"Plan","context":"Context","steps":[]}\')',
      [OWNER, SESSION],
    );
    await assert.rejects(commit(db, state), /session_conflict/);
    await db.exec("UPDATE public.work_saved_records SET revision=2");
    assert.equal((await commit(db, state)).state.request.sessionRevision, 2);
  } finally {
    await db.close();
  }
});
test("idempotent admission and commands create one event and receipt; changed bodies conflict", async () => {
  const db = await fixture();
  try {
    let state = await run();
    await commit(db, state);
    assert.equal((await commit(db, state)).idempotent, true);
    await assert.rejects(commit(db, state, { hash: "b".repeat(64) }), /idempotency_conflict/);
    state = await transitionWorkRun(
      state,
      { type: "cancel" },
      { actor: "owner", ownerId: OWNER, expectedRevision: 1 },
    );
    const mutation = crypto.randomUUID();
    await commit(db, state, { mutation });
    assert.equal((await commit(db, state, { mutation })).idempotent, true);
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM public.work_execution_events")).rows[0].n,
      2,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM public.work_execution_receipts")).rows[0].n,
      2,
    );
  } finally {
    await db.close();
  }
});
test("CAS and immutable owner/model/request boundaries reject stale or rewritten run state", async () => {
  const db = await fixture();
  try {
    const state = await run();
    state.modelSelection = {
      mode: "normal",
      reasoningEffort: "low",
      maxOutputTokens: 2048,
      service: "provider_default",
    };
    await commit(db, state);
    const next = {
      ...state,
      revision: 2,
      status: "running",
      event: { kind: "claimed", detail: {} },
    };
    await assert.rejects(
      commit(db, { ...next, model: "foreign-model" }, { mutation: crypto.randomUUID() }),
      /immutable/,
    );
    for (const change of [
      { mode: "deep" },
      { reasoningEffort: "high" },
      { maxOutputTokens: 8192 },
      { service: "priority" },
    ])
      await assert.rejects(
        commit(
          db,
          { ...next, modelSelection: { ...state.modelSelection, ...change } },
          { mutation: crypto.randomUUID() },
        ),
        /immutable/,
      );
    await assert.rejects(
      commit(db, { ...next, ownerId: OTHER }, { owner: OTHER, mutation: crypto.randomUUID() }),
      /owner_required/,
    );
    await commit(db, next, { mutation: crypto.randomUUID() });
    await assert.rejects(commit(db, next, { mutation: crypto.randomUUID() }), /revision_conflict/);
  } finally {
    await db.close();
  }
});
test("completion verifies artifact ownership and commits notification atomically", async () => {
  const db = await fixture();
  try {
    const state = await run();
    await commit(db, state);
    const complete = {
      ...state,
      revision: 2,
      status: "completed",
      outputRefs: [{ kind: "library", id: SESSION }],
      event: { kind: "completed", detail: {} },
    };
    await db.query("INSERT INTO public.user_library_items(id,user_id) VALUES($1,$2)", [
      SESSION,
      OTHER,
    ]);
    await assert.rejects(
      commit(db, complete, { mutation: crypto.randomUUID() }),
      /output_not_owned/,
    );
    await db.query("UPDATE public.user_library_items SET user_id=$1", [OWNER]);
    await db.query("INSERT INTO public.projects(id) VALUES($1)", [RUNNER]);
    await db.query("INSERT INTO public.project_members VALUES($1,$2,'owner')", [RUNNER, OWNER]);
    await db.query(
      "INSERT INTO public.project_files(id,project_id,status,content_sha256) VALUES($1,$2,'ready',$3)",
      [SESSION, RUNNER, "a".repeat(64)],
    );
    await db.query(
      "INSERT INTO public.work_execution_outputs(id,owner_id,run_id,project_file_id,artifact_id,epoch,step_id,input_hash,sha256,size_bytes,mime_type) VALUES($1,$2,$3,$1,$4,1,$4,$5,$5,10,'text/plain')",
      [SESSION, OWNER, RUN, ID, "a".repeat(64)],
    );
    await db.exec("ALTER TABLE public.app_notifications ADD CONSTRAINT fail_notice CHECK(false)");
    await assert.rejects(commit(db, complete, { mutation: crypto.randomUUID() }), /fail_notice/);
    assert.equal(
      (await db.query("SELECT revision FROM public.work_execution_runs")).rows[0].revision,
      1,
    );
    await db.exec("ALTER TABLE public.app_notifications DROP CONSTRAINT fail_notice");
    const mutation = crypto.randomUUID();
    await commit(db, complete, { mutation });
    await commit(db, complete, { mutation });
    const notices = (
      await db.query("SELECT safe_preview,source_entity,action_url FROM public.app_notifications")
    ).rows;
    assert.equal(notices.length, 1);
    assert.equal(notices[0].action_url, "/work");
    assert.equal(notices[0].safe_preview.includes(state.request.objective), false);
  } finally {
    await db.close();
  }
});
test("disabled task notifications are honored and exact-owner RLS filters private inputs", async () => {
  const db = await fixture();
  try {
    const state = await run();
    await commit(db, state);
    await db.query("INSERT INTO public.notification_preferences VALUES($1,false,'{}')", [OWNER]);
    const next = {
      ...state,
      revision: 2,
      status: "waiting_for_user",
      event: { kind: "question_requested", detail: {} },
    };
    await commit(db, next, { mutation: crypto.randomUUID() });
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM public.app_notifications")).rows[0].n,
      0,
    );
    await db.exec("GRANT USAGE ON SCHEMA auth TO authenticated");
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [OTHER]);
    await db.exec("SET ROLE authenticated");
    assert.equal((await db.query("SELECT * FROM public.work_execution_runs")).rows.length, 0);
    assert.equal((await db.query("SELECT * FROM public.work_execution_events")).rows.length, 0);
  } finally {
    await db.close();
  }
});

test("published Library outputs bind the exact active step, canonical Project digest and current membership", async () => {
  const db = await fixture();
  try {
    await db.query("INSERT INTO public.projects(id) VALUES($1)", [RUNNER]);
    await db.query("INSERT INTO public.project_members VALUES($1,$2,'owner')", [RUNNER, OWNER]);
    let state = await run(null, RUNNER);
    await commit(db, state);
    const now = Date.now(),
      runner = {
        id: RUNNER,
        protocol: "kova-work-v1",
        build: "a".repeat(40),
        authenticated: true,
        enabled: true,
        heartbeatAt: now,
        expiresAt: now + 50000,
        capabilities: [...WORK_RUNNER_CAPABILITIES],
      };
    state = await transitionWorkRun(
      state,
      { type: "claim" },
      { actor: "runner", runnerId: RUNNER, runner, expectedRevision: state.revision },
    );
    await commit(db, state, { mutation: crypto.randomUUID() });
    state = await transitionWorkRun(
      state,
      { type: "begin_step", id: ID },
      {
        actor: "runner",
        runnerId: RUNNER,
        epoch: state.epoch,
        expectedRevision: state.revision,
        costReservation: {
          id: SESSION,
          ownerId: OWNER,
          runId: RUN,
          epoch: state.epoch,
          model: state.model,
          verified: true,
          tokens: 10,
          outputTokens: 5,
          costMicros: 10,
          expiresAt: Date.now() + 20000,
        },
      },
    );
    await commit(db, state, { mutation: crypto.randomUUID() });
    await db.query(
      "INSERT INTO public.project_files(id,project_id,status,content_sha256,size_bytes,mime_type,name) VALUES($1,$2,'ready',$3,42,'text/plain','result.txt')",
      [SESSION, RUNNER, "b".repeat(64)],
    );
    const publish = async (hash = "b".repeat(64)) => {
      await db.exec("SET ROLE service_role");
      try {
        return (
          await db.query(
            "SELECT public.publish_work_execution_output($1,$2,$3,$3,$4,$5,$6,$4,$7,42,'text/plain') result",
            [OWNER, RUN, state.epoch, ID, state.step.inputHash, SESSION, hash],
          )
        ).rows[0].result;
      } finally {
        await db.exec("RESET ROLE");
      }
    };
    const first = await publish();
    assert.equal((await publish()).id, first.id);
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM public.work_execution_outputs")).rows[0].n,
      1,
    );
    assert.equal(
      (await db.query("SELECT file_url FROM public.user_library_items WHERE id=$1", [first.id]))
        .rows[0].file_url,
      null,
    );
    await assert.rejects(publish("c".repeat(64)), /project_access/);
    await db.exec("DELETE FROM public.project_members");
    await assert.rejects(publish(), /project_access/);
  } finally {
    await db.close();
  }
});

test("dispatcher selection is pinned, bounded and throttles an unconfirmed run", async () => {
  const db = await fixture();
  try {
    await commit(db, await run());
    await db.exec("SET ROLE service_role");
    assert.equal(
      (
        await db.query("SELECT public.next_work_execution_dispatch($1,$2) result", [
          RUNNER,
          "b".repeat(40),
        ])
      ).rows[0].result,
      null,
    );
    assert.equal(
      (
        await db.query("SELECT public.next_work_execution_dispatch($1,$2) result", [
          RUNNER,
          "a".repeat(40),
        ])
      ).rows[0].result.state.id,
      RUN,
    );
    assert.equal(
      (
        await db.query("SELECT public.next_work_execution_dispatch($1,$2) result", [
          RUNNER,
          "a".repeat(40),
        ])
      ).rows[0].result,
      null,
    );
  } finally {
    await db.close();
  }
});

test("deferred Work upload cannot publish a Project row after cancellation, and success binds Library atomically", async () => {
  for (const cancel of [true, false]) {
    const db = await fixture();
    try {
      // Exercise the canonical ready setter, including generation settlement.
      const projectMigration = await readFile(
        new URL(
          "../../supabase/migrations/20260904200000_project_file_upload_integrity.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await db.exec(`CREATE TABLE public.test_generations(id uuid PRIMARY KEY,state text);
        CREATE FUNCTION public.settle_account_storage_artifact(uuid,uuid,uuid,text,text) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN
          UPDATE public.test_generations SET state='published' WHERE id=$1 AND state='pending'; RETURN FOUND; END $$;`);
      for (const name of ["lock_project_for_file_operation", "set_project_file_upload_state"]) {
        const start = projectMigration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
        const end = projectMigration.indexOf("$$;", start) + 3;
        await db.exec(projectMigration.slice(start, end));
      }
      await db.query("INSERT INTO public.projects(id) VALUES($1)", [RUNNER]);
      await db.query("INSERT INTO public.project_members VALUES($1,$2,'owner')", [RUNNER, OWNER]);
      let state = await run(null, RUNNER);
      await commit(db, state);
      const content = new TextEncoder().encode("Verified report");
      const output = {
        artifactId: ID,
        sha256: await sha256Hex(content),
        bytes: content.length,
        mimeType: "text/plain",
      };
      const receipt = {
        ownerId: OWNER,
        runId: RUN,
        epoch: 1,
        stepId: ID,
        inputHash: "b".repeat(64),
        outputs: [output],
      };
      state = {
        ...state,
        revision: 2,
        status: "running",
        epoch: 1,
        lease: { expiresAt: Date.now() + 60000 },
        stepIds: [ID],
        step: { id: ID, epoch: 1, inputHash: receipt.inputHash, receipt },
        event: { kind: "step_receipt_recorded", detail: {} },
      };
      await commit(db, state, { mutation: crypto.randomUUID() });
      await db.query(
        "INSERT INTO public.project_files(id,project_id,status,content_sha256,size_bytes,mime_type,name,uploaded_by,storage_owner_id,upload_attempt_id,storage_path,upload_lease_until) VALUES($1,$2,'pending',$3,$4,'text/plain','report.txt',$5,$5,$6,'immutable/path',now()+interval '2 minutes')",
        [SESSION, RUNNER, output.sha256, content.length, OWNER, OTHER],
      );
      await db.query("INSERT INTO public.test_generations VALUES($1,'pending')", [OTHER]);
      let releaseUpload, startedUpload;
      const uploading = new Promise((resolve) => {
        startedUpload = resolve;
      });
      const upload = new Promise((resolve) => {
        releaseUpload = resolve;
      });
      const publish = () =>
        db.query(
          "SELECT public.publish_work_project_file($1,$2,1,1,$3,$4,$5,$6,$3,$7,$8,'text/plain') ok",
          [OWNER, RUN, ID, receipt.inputHash, SESSION, OTHER, output.sha256, content.length],
        );
      const publication = publishWorkProjectOutput(
        {
          assertLease: async () => undefined,
          readArtifact: async () => ({ ...receipt, ...output, content }),
          publishProjectFile: async () => {
            startedUpload();
            await upload;
            await db.exec("SET ROLE service_role");
            let ready;
            try {
              ready = (await publish()).rows[0].ok;
            } finally {
              await db.exec("RESET ROLE");
            }
            if (!ready) {
              await db.query(
                "UPDATE public.test_generations SET state='retired' WHERE id=$1 AND state='pending'",
                [OTHER],
              );
              throw new Error("work_output_storage_unavailable");
            }
            return { id: SESSION, project_id: RUNNER, status: "ready" };
          },
          bindOutput: async () => ({
            kind: "library",
            id: (await db.query("SELECT id FROM public.work_execution_outputs")).rows[0].id,
          }),
        },
        state,
        receipt,
        output,
      );
      await uploading;
      if (cancel)
        await commit(
          db,
          {
            ...state,
            revision: 3,
            epoch: 2,
            status: "cancelled",
            event: { kind: "cancelled", detail: {} },
          },
          { mutation: crypto.randomUUID() },
        );
      releaseUpload();
      if (cancel) await assert.rejects(publication, /storage_unavailable/);
      else await publication;
      assert.equal(
        (await db.query("SELECT status FROM public.project_files")).rows[0].status,
        cancel ? "pending" : "ready",
      );
      assert.equal(
        (await db.query("SELECT state FROM public.test_generations")).rows[0].state,
        cancel ? "retired" : "published",
      );
      assert.equal(
        (await db.query("SELECT count(*)::int n FROM public.work_execution_outputs")).rows[0].n,
        cancel ? 0 : 1,
      );
      if (!cancel) {
        assert.equal((await publish()).rows[0].ok, true);
        await db.query(
          "UPDATE public.work_execution_runs SET state=jsonb_set(state,'{step,receipt,outputs}','[]') WHERE id=$1",
          [RUN],
        );
        await assert.rejects(publish(), /provenance_invalid/);
      }
      await db.exec("SET ROLE authenticated");
      await assert.rejects(publish(), /permission denied/);
    } finally {
      await db.close();
    }
  }
});
