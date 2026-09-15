import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = new URL(
  "../../supabase/migrations/20260914120000_project_owner_membership_integrity.sql",
  import.meta.url,
);

async function database(setup) {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TYPE public.project_role AS ENUM ('owner', 'editor', 'viewer');
    CREATE TABLE public.projects (
      id uuid PRIMARY KEY,
      owner_id uuid NOT NULL REFERENCES auth.users(id),
      deletion_requested_at timestamptz
    );
    CREATE TABLE public.project_members (
      project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      role public.project_role NOT NULL,
      PRIMARY KEY (project_id, user_id)
    );
  `);
  if (setup) await setup(db);
  await db.exec(await readFile(migration, "utf8"));
  return db;
}

test("project owner membership cannot be removed, demoted, or impersonated", async () => {
  const db = await database();
  try {
    const owner = "11111111-1111-4111-8111-111111111111";
    const member = "22222222-2222-4222-8222-222222222222";
    const replacement = "55555555-5555-4555-8555-555555555555";
    const project = "33333333-3333-4333-8333-333333333333";
    await db.exec(`
      INSERT INTO auth.users(id) VALUES ('${owner}'), ('${member}'), ('${replacement}');
      INSERT INTO public.projects(id, owner_id) VALUES ('${project}', '${owner}');
      INSERT INTO public.project_members(project_id, user_id, role)
      VALUES ('${project}', '${owner}', 'owner'), ('${project}', '${member}', 'editor');
    `);

    await assert.rejects(
      db.exec(
        `DELETE FROM public.project_members WHERE project_id = '${project}' AND user_id = '${owner}'`,
      ),
      /project_owner_membership_required/u,
    );
    await assert.rejects(
      db.exec(
        `UPDATE public.project_members SET role = 'viewer' WHERE project_id = '${project}' AND user_id = '${owner}'`,
      ),
      /project_owner_role_required/u,
    );
    await assert.rejects(
      db.exec(
        `UPDATE public.project_members SET user_id = '${replacement}', role = 'editor' WHERE project_id = '${project}' AND user_id = '${owner}'`,
      ),
      /project_owner_membership_required/u,
    );
    await assert.rejects(
      db.exec(
        `UPDATE public.project_members SET role = 'owner' WHERE project_id = '${project}' AND user_id = '${member}'`,
      ),
      /project_owner_role_reserved/u,
    );

    await db.exec(`DELETE FROM public.projects WHERE id = '${project}'`);
    const memberships = await db.query("SELECT count(*)::int AS count FROM public.project_members");
    assert.deepEqual(memberships.rows, [{ count: 0 }]);
  } finally {
    await db.close();
  }
});

test("owner repair temporarily bypasses the fence for pending-deletion drift", async () => {
  const owner = "11111111-1111-4111-8111-111111111111";
  const member = "22222222-2222-4222-8222-222222222222";
  const activeProject = "33333333-3333-4333-8333-333333333333";
  const deletingProject = "44444444-4444-4444-8444-444444444444";
  const db = await database(async (seedDb) => {
    await seedDb.exec(`
      CREATE FUNCTION public.reject_pending_project_member_writes()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM public.projects
          WHERE id = COALESCE(NEW.project_id, OLD.project_id)
            AND deletion_requested_at IS NOT NULL
        ) THEN
          RAISE EXCEPTION 'project_deletion_pending' USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END
      $$;
      INSERT INTO auth.users(id) VALUES ('${owner}'), ('${member}');
      INSERT INTO public.projects(id, owner_id, deletion_requested_at) VALUES
        ('${activeProject}', '${owner}', NULL),
        ('${deletingProject}', '${owner}', now());
      INSERT INTO public.project_members(project_id, user_id, role) VALUES
        ('${activeProject}', '${owner}', 'viewer'),
        ('${deletingProject}', '${owner}', 'viewer'),
        ('${deletingProject}', '${member}', 'owner');

      CREATE TRIGGER project_members_deletion_write_fence
      BEFORE INSERT OR UPDATE ON public.project_members
      FOR EACH ROW EXECUTE FUNCTION public.reject_pending_project_member_writes();
    `);
  });

  try {
    const memberships = await db.query(`
      SELECT project_id::text, user_id::text, role::text
      FROM public.project_members
      ORDER BY project_id, user_id
    `);
    assert.deepEqual(memberships.rows, [
      { project_id: activeProject, user_id: owner, role: "owner" },
      { project_id: deletingProject, user_id: owner, role: "owner" },
      { project_id: deletingProject, user_id: member, role: "editor" },
    ]);
  } finally {
    await db.close();
  }
});
