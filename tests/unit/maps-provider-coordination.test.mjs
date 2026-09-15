import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = new URL(
  "../../supabase/migrations/20260915010000_coordinate_maps_provider_requests.sql",
  import.meta.url,
);

test("Maps provider admission is global and successful lookups are shared", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
    await db.exec(await readFile(migration, "utf8"));

    const first = await db.query("select * from public.claim_maps_provider_request()");
    const second = await db.query("select * from public.claim_maps_provider_request()");
    assert.deepEqual(first.rows, [{ allowed: true, retry_after: 1 }]);
    assert.equal(second.rows[0].allowed, false);
    assert.ok(second.rows[0].retry_after >= 1);

    const hash = "a".repeat(64);
    await db.query("select public.store_maps_search_cache($1, $2::jsonb)", [
      hash,
      JSON.stringify({ results: [{ name: "Boston" }] }),
    ]);
    const cached = await db.query("select public.read_maps_search_cache($1) as payload", [hash]);
    assert.deepEqual(cached.rows, [{ payload: { results: [{ name: "Boston" }] } }]);
    await db.exec(
      "update public.maps_search_cache set expires_at = statement_timestamp() - interval '1 second'",
    );
    await db.query("select public.store_maps_search_cache($1, $2::jsonb)", [
      "b".repeat(64),
      JSON.stringify({ results: [] }),
    ]);
    const retained = await db.query("select query_hash from public.maps_search_cache");
    assert.deepEqual(retained.rows, [{ query_hash: "b".repeat(64) }]);
  } finally {
    await db.close();
  }
});
