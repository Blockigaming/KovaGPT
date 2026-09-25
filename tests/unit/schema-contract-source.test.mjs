import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  activePolicyNames,
  directTableSelectDecisions,
} from "../../scripts/release/schema-contract-source.mjs";

test("source inventory applies policy drops and direct grant revocations in migration order", () => {
  const sql = `
CREATE POLICY "read_flags" ON public.feature_flags FOR SELECT USING (true);
GRANT SELECT ON TABLE public.feature_flags TO authenticated, anon;
REVOKE ALL PRIVILEGES ON TABLE public.feature_flags FROM anon;
DROP POLICY IF EXISTS "read_flags" ON public.feature_flags;
REVOKE SELECT ON TABLE public.feature_flags FROM authenticated;
CREATE POLICY "read_flags" ON public.other FOR SELECT USING (true);
`;
  assert.deepEqual(activePolicyNames(sql), ["read_flags"]);
  assert.deepEqual(directTableSelectDecisions(sql), [
    { table: "public.feature_flags", role: "anon", granted: false },
    { table: "public.feature_flags", role: "authenticated", granted: false },
  ]);
});

test("current migration inventory does not advertise revoked feature-flag client access", () => {
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  const sql = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(new URL(name, dir), "utf8"))
    .join("\n");
  assert.equal(activePolicyNames(sql).includes("feature_flags_authenticated_read"), false);
  const direct = directTableSelectDecisions(sql);
  assert.deepEqual(
    direct.find(
      (entry) => entry.table === "public.feature_flags" && entry.role === "authenticated",
    ),
    { table: "public.feature_flags", role: "authenticated", granted: false },
  );
  const contract = JSON.parse(
    readFileSync(new URL("../../database-contract.json", import.meta.url), "utf8"),
  );
  assert.equal(contract.policies.includes("feature_flags_authenticated_read"), false);
  assert.equal(Object.hasOwn(contract, "grants"), false);
  assert.equal(
    contract.directTableSelectDecisions.find(
      (entry) => entry.table === "public.feature_flags" && entry.role === "authenticated",
    )?.granted,
    false,
  );
});
