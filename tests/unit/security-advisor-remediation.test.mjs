import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../../supabase/migrations/20260903145843_remediate_security_advisor_warnings.sql",
  import.meta.url,
);

const privilegedFacades = [
  "accept_project_invite",
  "can_edit_project",
  "control_agent_job",
  "decide_agent_approval",
  "decline_project_invite",
  "disconnect_github_account",
  "family_owner_of",
  "is_family_member",
  "is_project_member",
];

const rlsInvokerFunctions = [
  "kova_accept_message_version",
  "kova_activate_chat_branch",
  "kova_create_chat_branch",
  "kova_record_message_version",
  "kova_update_chat_branch_messages",
  "match_project_chunks",
  "save_writing_document",
  "user_plan_tier",
];

const obsoleteFunctions = ["promote_agent_deliverable"];

async function loadMigration() {
  return readFile(migrationUrl, "utf8");
}

async function createMigrationFixture() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;

    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    CREATE TABLE public.github_accounts (
      id uuid PRIMARY KEY,
      owner_id uuid NOT NULL,
      status text NOT NULL DEFAULT 'connected'
    );
    ALTER TABLE public.github_accounts ENABLE ROW LEVEL SECURITY;

    CREATE FUNCTION public.accept_project_invite(uuid) RETURNS uuid
      LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT $1 $$;
    CREATE FUNCTION public.can_edit_project(uuid, uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT auth.uid() = $2 $$;
    CREATE FUNCTION public.control_agent_job(uuid, text) RETURNS jsonb
      LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT jsonb_build_object('id', $1) $$;
    CREATE FUNCTION public.decide_agent_approval(uuid, text, jsonb DEFAULT null) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN RETURN; END $$;
    CREATE FUNCTION public.decline_project_invite(uuid) RETURNS boolean
      LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT true $$;
    CREATE FUNCTION public.disconnect_github_account(uuid, boolean DEFAULT false) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM public.github_accounts WHERE id = $1 AND owner_id = auth.uid()
        ) THEN
          RAISE EXCEPTION 'GitHub account not found';
        END IF;
        UPDATE public.github_accounts SET status = 'disconnected' WHERE id = $1;
      END
      $$;
    CREATE FUNCTION public.family_owner_of(uuid) RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT $1 $$;
    CREATE FUNCTION public.is_family_member(uuid, uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT auth.uid() = $1 $$;
    CREATE FUNCTION public.is_project_member(uuid, uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT auth.uid() = $2 $$;

    CREATE TABLE public.project_rows (project_id uuid NOT NULL, owner_id uuid NOT NULL);
    ALTER TABLE public.project_rows ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON public.project_rows TO authenticated;
    CREATE POLICY project_rows_member_select ON public.project_rows FOR SELECT TO authenticated
      USING (public.is_project_member(project_id, auth.uid()));

    CREATE FUNCTION public.kova_accept_message_version(uuid) RETURNS boolean
      LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT true $$;
    CREATE FUNCTION public.kova_activate_chat_branch(text, uuid) RETURNS boolean
      LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT true $$;
    CREATE FUNCTION public.kova_create_chat_branch(
      text, text, uuid, text, text, integer, text[], text, boolean, integer
    ) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT true $$;
    CREATE FUNCTION public.kova_record_message_version(
      text, text, text, text, uuid, text, text, integer, integer, boolean, integer
    ) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT true $$;
    CREATE FUNCTION public.kova_update_chat_branch_messages(uuid, text[], text) RETURNS boolean
      LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT true $$;
    CREATE FUNCTION public.save_writing_document(uuid, text, text, integer, text) RETURNS boolean
      LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT true $$;
    CREATE FUNCTION public.user_plan_tier(uuid) RETURNS text
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT 'free'::text $$;
    CREATE FUNCTION public.promote_agent_deliverable(uuid, text, uuid, text, text, boolean)
      RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT true $$;
  `);

  const migration = await loadMigration();
  const vectorSection = migration.indexOf(
    "-- project_file_chunks already has member-only SELECT RLS",
  );
  assert.ok(vectorSection > 0, "expected vector section marker");
  await database.exec(migration.slice(0, vectorSection));
  return database;
}

test("all 18 authenticated-callable definers have an explicit disposition", async () => {
  const migration = (await loadMigration()).toLowerCase();
  const inventory = [...privilegedFacades, ...rlsInvokerFunctions, ...obsoleteFunctions];
  assert.equal(inventory.length, 18);
  assert.equal(new Set(inventory).size, 18);

  for (const name of privilegedFacades) {
    assert.match(
      migration,
      new RegExp(`alter function public\\.${name}[\\s\\S]*set schema kova_private`),
    );
    assert.match(
      migration,
      new RegExp(`create function public\\.${name}[\\s\\S]*security invoker`),
    );
  }
  for (const name of rlsInvokerFunctions) {
    assert.match(migration, new RegExp(`alter function public\\.${name}[\\s\\S]*security invoker`));
  }
  assert.match(
    migration,
    /kova_record_message_version\(text,text,text,text,uuid,text,text,boolean,integer,integer,integer\)/,
    "production overload must remain covered",
  );
  assert.match(
    migration,
    /revoke all on function public\.promote_agent_deliverable[\s\S]*from public, anon, authenticated/,
  );
});

test("migration removes authenticated SECURITY DEFINER entry points and preserves owner checks", async () => {
  const database = await createMigrationFixture();
  const owner = "11111111-1111-4111-8111-111111111111";
  const attacker = "22222222-2222-4222-8222-222222222222";
  const account = "33333333-3333-4333-8333-333333333333";

  try {
    await database.query("INSERT INTO public.github_accounts(id, owner_id) VALUES ($1, $2)", [
      account,
      owner,
    ]);

    const catalog = await database.query(`
      SELECT
        count(*) FILTER (
          WHERE n.nspname = 'public'
            AND p.prosecdef
            AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
        )::int AS exposed_authenticated_definers,
        count(*) FILTER (
          WHERE n.nspname = 'kova_private' AND p.prosecdef
        )::int AS private_definers
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public', 'kova_private')
    `);
    assert.deepEqual(catalog.rows, [
      { exposed_authenticated_definers: 0, private_definers: privilegedFacades.length },
    ]);

    const policy = await database.query(`
      SELECT pg_get_expr(polqual, polrelid) AS expression
      FROM pg_policy
      WHERE polname = 'project_rows_member_select'
    `);
    assert.match(policy.rows[0].expression, /kova_private\.is_project_member/u);

    const privileges = await database.query(`
      SELECT
        has_function_privilege('authenticated', 'public.disconnect_github_account(uuid,boolean)', 'EXECUTE') AS auth_facade,
        has_function_privilege('anon', 'public.disconnect_github_account(uuid,boolean)', 'EXECUTE') AS anon_facade,
        has_function_privilege('authenticated', 'public.promote_agent_deliverable(uuid,text,uuid,text,text,boolean)', 'EXECUTE') AS auth_obsolete,
        has_function_privilege('service_role', 'public.promote_agent_deliverable(uuid,text,uuid,text,text,boolean)', 'EXECUTE') AS service_obsolete
    `);
    assert.deepEqual(privileges.rows, [
      {
        auth_facade: true,
        anon_facade: false,
        auth_obsolete: false,
        service_obsolete: true,
      },
    ]);

    await database.exec("SET ROLE authenticated");
    await database.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [attacker]);
    await assert.rejects(
      database.query("SELECT public.disconnect_github_account($1, false)", [account]),
      /GitHub account not found/u,
    );

    await database.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [owner]);
    await database.query("SELECT public.disconnect_github_account($1, false)", [account]);
    await database.exec("RESET ROLE");

    const row = await database.query("SELECT status FROM public.github_accounts WHERE id = $1", [
      account,
    ]);
    assert.deepEqual(row.rows, [{ status: "disconnected" }]);
  } finally {
    await database.close();
  }
});

test("vector relocation is OID-preserving and follows the invoker conversion", async () => {
  const migration = (await loadMigration()).toLowerCase();
  const invoker = migration.indexOf(
    "alter function public.match_project_chunks(uuid, public.vector, integer) security invoker",
  );
  const relocate = migration.indexOf("alter extension vector set schema extensions");
  const repin = migration.indexOf(
    "alter function public.match_project_chunks(uuid, extensions.vector, integer)",
  );
  assert.ok(invoker >= 0 && invoker < relocate && relocate < repin);
  assert.doesNotMatch(migration, /drop extension|drop table|alter table[^;]+embedding/u);
});

test("GitHub disconnect executes with the authenticated caller and fails closed", async () => {
  const source = await readFile(
    new URL("../../src/lib/github.functions.ts", import.meta.url),
    "utf8",
  );
  const handler = source.slice(source.indexOf("export const disconnectGitHub"));
  assert.match(handler, /context\.supabase as any\)\.rpc\("disconnect_github_account"/u);
  assert.match(handler, /if \(disconnect\.error\) throw new Error/u);
  assert.doesNotMatch(handler, /supabaseAdmin as any\)\.rpc\("disconnect_github_account"/u);
});
