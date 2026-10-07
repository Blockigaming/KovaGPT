import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("existing approval and preference tables support exclusive consumption and conflict-safe settings", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE ROLE service_role;",
    );
    await db.exec(
      await readFile(
        "supabase/migrations/20260707005030_9b3885d2-44e1-4469-8e87-40b7c83d6dc5.sql",
        "utf8",
      ),
    );
    const preferences = await readFile(
      "supabase/migrations/20260722123000_connectors_tasks_sharing_settings_audit.sql",
      "utf8",
    );
    await db.exec(
      preferences.match(/create table if not exists public\.user_preferences \([\s\S]*?\);/)[0],
    );
    const owner = "10000000-0000-4000-8000-000000000001";
    await db.query("INSERT INTO auth.users VALUES ($1)", [owner]);
    const {
      rows: [action],
    } = await db.query(
      "INSERT INTO pending_tool_actions(user_id,tool,args) VALUES($1,'github.createIssue','{}') RETURNING id",
      [owner],
    );
    const claim =
      "UPDATE pending_tool_actions SET status='processing' WHERE id=$1 AND user_id=$2 AND status='pending' AND expires_at > now() RETURNING id";
    assert.equal((await db.query(claim, [action.id, owner])).rows.length, 1);
    assert.equal((await db.query(claim, [action.id, owner])).rows.length, 0);
    await db.query("INSERT INTO user_preferences(user_id,settings) VALUES($1,$2::jsonb)", [
      owner,
      JSON.stringify({ lockdown_mode: true, unrelated: 7 }),
    ]);
    const updated = await db.query(
      "UPDATE user_preferences SET settings=$1::jsonb WHERE user_id=$2 AND settings=$3::jsonb RETURNING settings",
      [
        JSON.stringify({ lockdown_mode: false, github_access_mode: "write" }),
        owner,
        JSON.stringify({ lockdown_mode: false }),
      ],
    );
    assert.equal(updated.rows.length, 0, "A concurrent setting change must not be overwritten");
    assert.deepEqual(
      (await db.query("SELECT settings FROM user_preferences WHERE user_id=$1", [owner])).rows[0]
        .settings,
      { lockdown_mode: true, unrelated: 7 },
    );
  } finally {
    await db.close();
  }
});
