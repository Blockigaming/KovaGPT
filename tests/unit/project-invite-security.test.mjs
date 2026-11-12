import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { persistedNoticeKind } from "../../src/lib/persisted-notification-policy.mjs";

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
    CREATE SCHEMA kova_private;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      email text,
      email_confirmed_at timestamptz,
      deleted_at timestamptz,
      raw_app_meta_data jsonb
    );
    CREATE TABLE kova_private.auth_accounts (
      id uuid PRIMARY KEY,
      primary_email text NOT NULL,
      legacy_supabase_user_id uuid,
      email_verified_at timestamptz,
      suspended_until timestamptz,
      deleted_at timestamptz
    );
    CREATE TABLE kova_private.auth_identities (
      account_id uuid NOT NULL,
      normalized_email text NOT NULL,
      verified_at timestamptz,
      disabled_at timestamptz
    );
    CREATE TABLE public.account_deletion_fences (user_id uuid PRIMARY KEY);
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
  await database.exec(
    await readFile(
      new URL("20260923001500_kova_owned_directory_authority.sql", migrations),
      "utf8",
    ),
  );
  const completeness = await readFile(
    new URL("20260722130000_product_completeness_reliability.sql", migrations),
    "utf8",
  );
  const notificationTables = completeness.slice(
    completeness.indexOf("create table if not exists public.app_notifications"),
    completeness.indexOf("create table if not exists public.support_tickets"),
  );
  await database.exec(notificationTables);
  await database.exec(
    await readFile(
      new URL("20261112031000_kova_project_invitation_notifications.sql", migrations),
      "utf8",
    ),
  );
  await database.exec(
    await readFile(
      new URL("20261112190309_kova_project_role_change_notifications.sql", migrations),
      "utf8",
    ),
  );
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

async function activeNotices(database) {
  return (
    await database.query(
      "SELECT owner_id::text, type, source_entity FROM public.app_notifications WHERE expires_at IS NULL ORDER BY type, source_entity",
    )
  ).rows;
}

test("project role changes deliver one owner-bound notice for each committed change", async () => {
  const database = await createDatabase();
  try {
    await seed(database);
    await database.query(
      "INSERT INTO public.project_members(project_id,user_id,role) VALUES ($1,$2,'viewer')",
      [projectId, inviteeId],
    );
    const rolePolicyMigration = await readFile(
      new URL("20260712011732_d735f53a-21fb-4543-8ecb-456c04bade12.sql", migrations),
      "utf8",
    );
    const updatePolicy = rolePolicyMigration.match(
      /CREATE POLICY "owner can update members"[^;]+;/u,
    )?.[0];
    assert.ok(updatePolicy);
    await database.exec(`
      GRANT USAGE ON SCHEMA auth TO authenticated;
      GRANT SELECT ON public.projects TO authenticated;
      GRANT SELECT, UPDATE ON public.project_members TO authenticated;
      ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "fixture member visibility" ON public.project_members FOR SELECT TO authenticated
        USING (user_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.projects WHERE id = project_id AND owner_id = auth.uid()
        ));
      ${updatePolicy}
    `);
    const change = async (actor, role, rollback = false) => {
      await setUser(database, actor);
      if (rollback) await database.exec("BEGIN");
      await database.exec("SET ROLE authenticated");
      try {
        const result = await database.query(
          "UPDATE public.project_members SET role=$1 WHERE project_id=$2 AND user_id=$3 RETURNING role",
          [role, projectId, inviteeId],
        );
        return result.rows;
      } finally {
        if (rollback) await database.exec("ROLLBACK");
        await database.exec("RESET ROLE");
      }
    };
    const readNotices = async () =>
      (
        await database.query(`SELECT owner_id, type, action_url, delivery_state FROM public.app_notifications
        WHERE type='project_role_change'`)
      ).rows;

    assert.deepEqual(await change(attackerId, "editor"), []);
    assert.deepEqual(await readNotices(), []);
    assert.deepEqual(await change(ownerId, "editor"), [{ role: "editor" }]);
    assert.deepEqual(await change(ownerId, "editor"), [{ role: "editor" }]);
    const notices = await readNotices();
    assert.deepEqual(notices, [
      {
        owner_id: inviteeId,
        type: "project_role_change",
        action_url: `/projects/${projectId}`,
        delivery_state: "delivered",
      },
    ]);
    assert.equal(
      persistedNoticeKind({ type: notices[0].type, readAt: null }),
      "permission_changed",
    );

    assert.deepEqual(await change(ownerId, "viewer", true), [{ role: "viewer" }]);
    assert.equal((await readNotices()).length, 1, "Rolled back role writes cannot leave a notice");
    await database.query(
      `INSERT INTO public.notification_preferences(user_id,in_app_enabled,categories)
        VALUES ($1,true,'{"projects":false}')`,
      [inviteeId],
    );
    assert.deepEqual(await change(ownerId, "viewer"), [{ role: "viewer" }]);
    assert.equal((await readNotices()).length, 1, "Projects opt-out suppresses the notice");
  } finally {
    await database.close();
  }
});

test("invite RPCs are recipient-bound, atomic, and idempotent", async () => {
  const database = await createDatabase();
  try {
    await seed(database);
    assert.deepEqual(
      await activeNotices(database),
      [acceptInviteId, declineInviteId].map((id) => ({
        owner_id: inviteeId,
        type: "project_invitation",
        source_entity: "project-invite:" + id,
      })),
    );
    await database.query("UPDATE public.project_invites SET status = 'pending' WHERE id = $1", [
      acceptInviteId,
    ]);
    assert.equal((await activeNotices(database)).length, 2, "Pending retries do not re-notify");

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
    assert.deepEqual(await activeNotices(database), [
      {
        owner_id: ownerId,
        type: "project_member_joined",
        source_entity: "project-invite:" + acceptInviteId,
      },
    ]);
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

test("project invites admit the verified owned email and reject the hosted compatibility address", async () => {
  const database = await createDatabase();
  try {
    await seed(database);
    const shadow = "shadow+owned-project-user@auth.invalid.kovagpt.com";
    await database.query(
      'UPDATE auth.users SET email = $1, raw_app_meta_data = \'{"provider":"kova_shadow"}\' WHERE id = $2',
      [shadow, inviteeId],
    );
    await database.query(
      "INSERT INTO kova_private.auth_accounts(id, primary_email, email_verified_at) VALUES ($1, $2, now())",
      [inviteeId, "invitee@example.com"],
    );
    await database.query(
      "INSERT INTO kova_private.auth_identities(account_id, normalized_email, verified_at) VALUES ($1, $2, now())",
      [inviteeId, "invitee@example.com"],
    );
    await setUser(database, inviteeId);
    assert.deepEqual(
      (
        await database.query("SELECT public.accept_project_invite($1) AS project_id", [
          acceptInviteId,
        ])
      ).rows,
      [{ project_id: projectId }],
    );
    await database.query("UPDATE public.project_invites SET email = $1 WHERE id = $2", [
      shadow,
      declineInviteId,
    ]);
    await assert.rejects(
      database.query("SELECT public.decline_project_invite($1)", [declineInviteId]),
      /invite_recipient_mismatch/u,
    );
    assert.equal(
      (await activeNotices(database)).some((row) => row.owner_id === inviteeId),
      false,
    );
    await database.query(
      "INSERT INTO public.notification_preferences(user_id, categories) VALUES ($1, '{\"projects\":false}')",
      [inviteeId],
    );
    await database.query("UPDATE public.project_invites SET email = $1 WHERE id = $2", [
      "invitee@example.com",
      declineInviteId,
    ]);
    assert.equal(
      (await activeNotices(database)).some((row) => row.owner_id === inviteeId),
      false,
    );
  } finally {
    await database.close();
  }
});

test("application routes resolve through the secure invitation facade", async () => {
  const [tsconfig, facade, secureInvites] = await Promise.all([
    readFile(new URL("../../tsconfig.json", import.meta.url), "utf8"),
    readFile(new URL("../../src/lib/projects-secure.facade.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/lib/project-invites.functions.ts", import.meta.url), "utf8"),
  ]);

  assert.match(
    tsconfig,
    /"@\/lib\/projects\.functions": \["\.\/src\/lib\/projects-secure\.facade\.ts"\]/u,
  );
  assert.match(facade, /from "\.\/project-invites\.functions"/u);
  assert.match(secureInvites, /"accept_project_invite"/u);
  assert.match(secureInvites, /"decline_project_invite"/u);
  assert.match(secureInvites, /status: "pending"/u);
  assert.match(secureInvites, /auto_accepted: false/u);
  assert.doesNotMatch(secureInvites, /auth\.admin\.listUsers|existingUserId/u);
  assert.doesNotMatch(secureInvites, /from\("project_members"\).*upsert/su);
});
