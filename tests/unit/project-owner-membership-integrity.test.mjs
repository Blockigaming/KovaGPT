import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = new URL(
  "../../supabase/migrations/20260914120000_project_owner_membership_integrity.sql",
  import.meta.url,
);

async function database() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TYPE public.project_role AS ENUM ('owner', 'editor', 'viewer');
    CREATE TABLE public.projects (id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES auth.users(id));
    CREATE TABLE public.project_members (
      project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      role public.project_role NOT NULL,
      PRIMARY KEY (project_id, user_id)
    );
  `);
  await db.exec(await readFile(migration, "utf8"));
  return db;
}

test("project owner membership cannot be removed, demoted, or impersonated", async () => {
  const db = await database();
  try {
    const owner = "11111111-1111-4111-8111-111111111111";
    const member = "22222222-2222-4222-8222-222222222222";
    const project = "33333333-3333-4333-8333-333333333333";
    await db.exec(`
      INSERT INTO auth.users(id) VALUES ('${owner}'), ('${member}');
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
