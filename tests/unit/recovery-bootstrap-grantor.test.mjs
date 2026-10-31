import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const script = fileURLToPath(
  new URL("../../scripts/release/probe-empty-recovery-target.py", import.meta.url),
);
const generated = JSON.parse(
  execFileSync(
    "python3",
    [
      "-c",
      `import importlib.util,json,sys
s=importlib.util.spec_from_file_location('bootstrap_fixture',sys.argv[1])
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def role(name,superuser=False):
 return {'name':name,'super':superuser,'inherit':True,'createRole':superuser,'createDb':superuser,'login':superuser,'replication':superuser,'bypassRls':superuser,'connectionLimit':-1,'validUntil':None}
metadata={'roles':[role('fixture_root',True),role('fixture_granted'),role('fixture_member')],'memberships':[{'role':'fixture_granted','member':'fixture_member','grantor':'fixture_root','admin':False,'inherit':False,'set':True}],'roleSettings':[{'role':'fixture_member','database':'*','settings':['search_path='+chr(92)+'$user, public, fixture_ns']}]}
metadata['roleSettings'].append({'role':'fixture_granted','database':'*','settings':['search_path="'+chr(92)+'$user", public, fixture_ns']})
print(json.dumps({'operator':m.operator_bootstrap_sql('synthetic-target-only-password').decode(),'metadata':m.role_setup_sql(metadata)}))`,
      script,
    ],
    { encoding: "utf8" },
  ),
);

test("copying SUPERUSER does not copy the bootstrap grantor exception", async (t) => {
  const db = new PGlite();
  try {
    const version = await db.query("SELECT current_setting('server_version_num') AS version");
    t.diagnostic(
      `Controlled PGlite engine version: ${version.rows[0].version}; native PostgreSQL 17 qualification is separate.`,
    );
    await db.exec(generated.operator);
    await assert.rejects(db.exec(generated.metadata), (error) => {
      assert.equal(error.code, "42501");
      return true;
    });
  } finally {
    await db.close();
  }
});

test("preserving bootstrap identity replays the exact grant without extra ADMIN edges", async () => {
  const db = new PGlite();
  try {
    await db.exec(generated.operator);
    // This controlled fixture models initdb --username=fixture_root. No real
    // source roles, credentials, customer rows or GitHub context are used.
    await db.exec(
      "SET SESSION AUTHORIZATION kova_probe_operator; ALTER ROLE postgres RENAME TO fixture_root;",
    );
    await db.exec(generated.metadata);
    const { rows } = await db.query(`
      SELECT g.rolname AS grantor, g.oid = 10 AS bootstrap,
             m.admin_option AS admin, m.inherit_option AS inherit,
             m.set_option AS "set"
      FROM pg_auth_members m
      JOIN pg_roles g ON g.oid = m.grantor
      JOIN pg_roles r ON r.oid = m.roleid
      JOIN pg_roles u ON u.oid = m.member
      WHERE r.rolname = 'fixture_granted' AND u.rolname = 'fixture_member'
    `);
    assert.deepEqual(rows, [
      {
        grantor: "fixture_root",
        bootstrap: true,
        admin: false,
        inherit: false,
        set: true,
      },
    ]);
    const settings = await db.query(`
      SELECT r.rolname AS role, s.setconfig AS settings
      FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
      WHERE r.rolname IN ('fixture_member', 'fixture_granted') AND s.setdatabase = 0
      ORDER BY r.rolname
    `);
    assert.deepEqual(settings.rows, [
      { role: "fixture_granted", settings: ['search_path="\\$user", public, fixture_ns'] },
      { role: "fixture_member", settings: ["search_path=\\$user, public, fixture_ns"] },
    ]);
    const operatorPath = await db.query("SELECT current_setting('search_path') AS path");
    assert.deepEqual(operatorPath.rows, [{ path: "pg_catalog" }]);
  } finally {
    await db.close();
  }
});
