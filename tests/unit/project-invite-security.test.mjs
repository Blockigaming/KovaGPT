import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrations = new URL("../../supabase/migrations/", import.meta.url);

async function loadMigration() {
  const names = (await readdir(migrations)).filter((name) =>
    name.endsWith("_project_invite_acceptance_hardening.sql"),
  );
  assert.equal(names.length, 1, "expected exactly one invite-acceptance hardening migration");
  return readFile(new URL(names[0], migrations), "utf8");
}

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE ROLE outsider;

    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      email text,
      email_confirmed_at timestamptz
    );
    CREATE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    CREATE TYPE public.project_role AS ENUM ('owner', 'editor', 'viewer');
    CREATE TABLE public.projects (
      id uuid PRIMARY KEY,
      owner_id uuid NOT NULL REFERENCES auth.users(id)
    );
    CREATE TABLE public.project_members (
      project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      role public.project_role NOT NULL,
      PRIMARY KEY (project_id, user_id)
    );
    CREATE TABLE public.project_invites (
      id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
      email text NOT NULL,
      role public.project_role NOT NULL,
      invited_by uuid NOT NULL REFERENCES auth.users(id),
      status text NOT NULL,
      accepted_at timestamptz
    );
  `);
  await database.exec(await loadMigration());
  return database;
}

const ownerId = "11111111-1111-4111-8111-111111111111";
const inviteeId = "22222222-2222-4222-8222-222222222222";
const attackerId = "33333333-3333-4333-8333-333333333333";
const projectId = "44444444-4444-4444-8444-444444444444";
const acceptInviteId = "55555555-5555-4555-8555-555555555555";
const declineInviteId = "66666666-6666-4666-8666-666666666666";

async function seed(database) {
  await database.exec(`
    INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
      ('${ownerId}', 'owner@example.com', now()),
      ('${inviteeId}', 'invitee@example.com', now()),
      ('${attackerId}', 'attacker@example.com', now());
    INSERT INTO public.projects(id, owner_id) VALUES ('${projectId}', '${ownerId}');
    INSERT INTO public.project_invites(id, project_id, email, role, invited_by, status) VALUES
      ('${acceptInviteId}', '${projectId}', 'Invitee@Example.com', 'viewer', '${ownerId}', 'pending'),
      ('${declineInviteId}', '${projectId}', 'invitee@example.com', 'editor', '${ownerId}', 'pending');
  `);
}

async function setUser(database, userId) {
  await database.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

test("invite RPCs are recipient-bound, atomic, and idempotent", async () => {
  const database = await createDatabase();
  try {
    await seed(database);

    await setUser(database, attackerId);
    await assert.rejects(
      database.query("SELECT public.accept_project_invite($1) AS project_id", [acceptInviteId]),
      /invite_recipient_mismatch/u,
    );
    assert.deepEqual(
      (
        await database.query(
          "SELECT count(*)::int AS count FROM public.project_members WHERE project_id = $1",
          [projectId],
        )
      ).rows,
      [{ count: 0 }],
    );

    await setUser(database, inviteeId);
    const accepted = await database.query("SELECT public.accept_project_invite($1) AS project_id", [
      acceptInviteId,
    ]);
    assert.deepEqual(accepted.rows, [{ project_id: projectId }]);
    assert.deepEqual(
      (
        await database.query(
          "SELECT user_id::text, role::text FROM public.project_members WHERE project_id = $1",
          [projectId],
        )
      ).rows,
      [{ user_id: inviteeId, role: "viewer" }],
    );
    assert.deepEqual(
      (
        await database.query(
          "SELECT status, accepted_at IS NOT NULL AS accepted FROM public.project_invites WHERE id = $1",
          [acceptInviteId],
        )
      ).rows,
      [{ status: "accepted", accepted: true }],
    );
    await assert.rejects(
      database.query("SELECT public.accept_project_invite($1)", [acceptInviteId]),
      /invite_not_pending/u,
    );

    const declined = await database.query("SELECT public.decline_project_invite($1) AS declined", [
      declineInviteId,
    ]);
    assert.deepEqual(declined.rows, [{ declined: true }]);
    assert.deepEqual(
      (
        await database.query(
          "SELECT status, accepted_at IS NULL AS accepted_at_cleared FROM public.project_invites WHERE id = $1",
          [declineInviteId],
        )
      ).rows,
      [{ status: "revoked", accepted_at_cleared: true }],
    );
  } finally {
    await database.close();
  }
});

test("only authenticated and service roles receive invite RPC execution", async () => {
  const database = await createDatabase();
  try {
    const privileges = await database.query(`
      SELECT
        has_function_privilege('anon', 'public.accept_project_invite(uuid)', 'EXECUTE') AS anon_accept,
        has_function_privilege('authenticated', 'public.accept_project_invite(uuid)', 'EXECUTE') AS authenticated_accept,
        has_function_privilege('service_role', 'public.accept_project_invite(uuid)', 'EXECUTE') AS service_accept,
        has_function_privilege('outsider', 'public.accept_project_invite(uuid)', 'EXECUTE') AS public_accept,
        has_function_privilege('anon', 'public.decline_project_invite(uuid)', 'EXECUTE') AS anon_decline,
        has_function_privilege('authenticated', 'public.decline_project_invite(uuid)', 'EXECUTE') AS authenticated_decline
    `);
    assert.deepEqual(privileges.rows, [
      {
        anon_accept: false,
        authenticated_accept: true,
        service_accept: true,
        public_accept: false,
        anon_decline: false,
        authenticated_decline: true,
      },
    ]);
  } finally {
    await database.close();
  }
});

test("application routes resolve through the secure invitation facade", async () => {
  const [tsconfig, facade, secureInvites, collaborationMigration] = await Promise.all([
    readFile(new URL("../../tsconfig.json", import.meta.url), "utf8"),
    readFile(new URL("../../src/lib/projects-secure.facade.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/lib/project-invites.functions.ts", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../../supabase/migrations/20260904210000_resend_webhook_integrity.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(
    tsconfig,
    /"@\/lib\/projects\.functions": \["\.\/src\/lib\/projects-secure\.facade\.ts"\]/u,
  );
  assert.match(facade, /from "\.\/project-invites\.functions"/u);
  assert.match(secureInvites, /"accept_project_invite"/u);
  assert.match(secureInvites, /"decline_project_invite"/u);
  assert.match(secureInvites, /buildTransactionalEmail/u);
  assert.match(secureInvites, /action: "project_invite_email"/u);
  assert.match(secureInvites, /"create_project_invite_and_enqueue"/u);
  assert.match(secureInvites, /auto_accepted: false/u);
  assert.doesNotMatch(secureInvites, /auth\.admin\.listUsers|existingUserId/u);
  assert.doesNotMatch(secureInvites, /from\("project_members"\).*upsert/su);
  assert.doesNotMatch(secureInvites, /from\("project_invites"\)[\s\S]*\.upsert/su);

  assert.match(
    collaborationMigration,
    /CREATE OR REPLACE FUNCTION public\.create_project_invite_and_enqueue/u,
  );
  assert.match(collaborationMigration, /owner_id = p_actor_id/u);
  assert.match(collaborationMigration, /already_project_member/u);
  assert.match(
    collaborationMigration,
    /INSERT INTO public\.project_invites[\s\S]*public\.enqueue_tracked_email/u,
  );
  assert.match(
    collaborationMigration,
    /REVOKE ALL ON FUNCTION public\.create_project_invite_and_enqueue[\s\S]*FROM PUBLIC, anon, authenticated/u,
  );
  assert.match(
    collaborationMigration,
    /GRANT EXECUTE ON FUNCTION public\.create_project_invite_and_enqueue[\s\S]*TO service_role/u,
  );
});
