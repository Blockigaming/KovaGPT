import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_MATRIX_PATH = "release-rls-matrix.json";

export function projectRefFromUrl(value) {
  try {
    const url = new URL(value);
    const match = url.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/u);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function validateRlsMatrix(matrix, databaseContract) {
  if (matrix?.schemaVersion !== 1) throw new Error("rls_matrix_schema_invalid");
  const protectedTables = Array.isArray(matrix.protectedTables) ? matrix.protectedTables : [];
  if (!protectedTables.length) throw new Error("rls_matrix_empty");
  const declared = new Set(databaseContract?.tables ?? []);
  const names = new Set();
  for (const entry of protectedTables) {
    if (!entry || typeof entry.table !== "string" || !entry.table) throw new Error("rls_matrix_table_invalid");
    if (names.has(entry.table)) throw new Error(`rls_matrix_duplicate:${entry.table}`);
    names.add(entry.table);
    if (!declared.has(entry.table)) throw new Error(`rls_matrix_unknown_table:${entry.table}`);
    if (!Array.isArray(entry.operations) || !["select", "update", "delete"].every((op) => entry.operations.includes(op))) {
      throw new Error(`rls_matrix_operations_incomplete:${entry.table}`);
    }
    if (!["direct_user", "project_membership", "shared_resource"].includes(entry.accessModel)) {
      throw new Error(`rls_matrix_access_model_invalid:${entry.table}`);
    }
  }
  return { protectedTableCount: protectedTables.length, fixtureCount: protectedTables.filter((entry) => entry.fixture).length };
}

export function assertSafeRlsTarget({ supabaseUrl, expectedRef, productionRef, execute }) {
  const actualRef = projectRefFromUrl(supabaseUrl);
  if (!actualRef || actualRef !== expectedRef) throw new Error("rls_rehearsal_target_mismatch");
  if (execute && actualRef === productionRef) throw new Error("rls_rehearsal_production_target_prohibited");
  return actualRef;
}

async function request(url, init) {
  const response = await fetch(url, init);
  const body = await response.text();
  let data;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = body;
  }
  return { response, data };
}

async function executeMatrix({ matrix, supabaseUrl, serviceKey, publishableKey }) {
  const missingFixtures = matrix.protectedTables.filter((entry) => !entry.fixture).map((entry) => entry.table);
  if (missingFixtures.length) throw new Error(`rls_fixture_definitions_missing:${missingFixtures.join(",")}`);

  const marker = crypto.randomUUID();
  const password = `${crypto.randomUUID()}Aa1!`;
  const users = [];
  const createdRows = [];
  const adminHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  try {
    for (const label of ["a", "b"]) {
      const email = `rls-${marker}-${label}@example.invalid`;
      const created = await request(`${supabaseUrl}/auth/v1/admin/users`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { kova_rls_rehearsal: marker } }),
      });
      if (!created.response.ok || !created.data?.id) throw new Error(`rls_user_create_failed:${label}`);
      const signedIn = await request(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: publishableKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!signedIn.response.ok || !signedIn.data?.access_token) throw new Error(`rls_user_signin_failed:${label}`);
      users.push({ id: created.data.id, token: signedIn.data.access_token });
    }

    for (const entry of matrix.protectedTables) {
      const fixture = structuredClone(entry.fixture);
      fixture.row[fixture.ownerColumn] = users[0].id;
      const inserted = await request(`${supabaseUrl}/rest/v1/${entry.table}`, {
        method: "POST",
        headers: { ...adminHeaders, Prefer: "return=representation" },
        body: JSON.stringify(fixture.row),
      });
      if (!inserted.response.ok || !Array.isArray(inserted.data) || !inserted.data[0]?.[fixture.idColumn]) {
        throw new Error(`rls_fixture_insert_failed:${entry.table}`);
      }
      const id = inserted.data[0][fixture.idColumn];
      createdRows.push({ entry, id, idColumn: fixture.idColumn });
      const filter = `${encodeURIComponent(fixture.idColumn)}=eq.${encodeURIComponent(String(id))}`;
      const headersB = { apikey: publishableKey, Authorization: `Bearer ${users[1].token}`, "Content-Type": "application/json", Prefer: "return=representation" };
      const deniedRead = await request(`${supabaseUrl}/rest/v1/${entry.table}?${filter}`, { headers: headersB });
      if (!deniedRead.response.ok || !Array.isArray(deniedRead.data) || deniedRead.data.length !== 0) {
        throw new Error(`rls_cross_user_read_allowed:${entry.table}`);
      }
      const deniedUpdate = await request(`${supabaseUrl}/rest/v1/${entry.table}?${filter}`, {
        method: "PATCH",
        headers: headersB,
        body: JSON.stringify(fixture.updatePatch),
      });
      if (!deniedUpdate.response.ok || !Array.isArray(deniedUpdate.data) || deniedUpdate.data.length !== 0) {
        throw new Error(`rls_cross_user_update_allowed:${entry.table}`);
      }
      const deniedDelete = await request(`${supabaseUrl}/rest/v1/${entry.table}?${filter}`, {
        method: "DELETE",
        headers: headersB,
      });
      if (!deniedDelete.response.ok || !Array.isArray(deniedDelete.data) || deniedDelete.data.length !== 0) {
        throw new Error(`rls_cross_user_delete_allowed:${entry.table}`);
      }
    }
    return { users: users.length, tables: matrix.protectedTables.length, result: "PASS" };
  } finally {
    for (const { entry, id, idColumn } of createdRows.reverse()) {
      await request(`${supabaseUrl}/rest/v1/${entry.table}?${encodeURIComponent(idColumn)}=eq.${encodeURIComponent(String(id))}`, {
        method: "DELETE",
        headers: adminHeaders,
      });
    }
    for (const user of users.reverse()) {
      await request(`${supabaseUrl}/auth/v1/admin/users/${user.id}`, { method: "DELETE", headers: adminHeaders });
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const execute = process.argv.includes("--execute");
  const matrixPath = resolve(process.env.KOVA_RLS_MATRIX ?? DEFAULT_MATRIX_PATH);
  const contractPath = resolve(process.env.KOVA_DATABASE_CONTRACT ?? "database-contract.json");
  if (!existsSync(matrixPath) || !existsSync(contractPath)) throw new Error("rls_rehearsal_inputs_missing");
  const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));
  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  const inventory = validateRlsMatrix(matrix, contract);
  if (!execute) {
    console.log(`RLS_TWO_USER_DRY_RUN=${JSON.stringify({ ...inventory, executionReady: inventory.fixtureCount === inventory.protectedTableCount })}`);
    process.exit(0);
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? "";
  const expectedRef = process.env.SUPABASE_PROJECT_REF ?? "";
  const productionRef = process.env.KOVA_PRODUCTION_SUPABASE_PROJECT_REF ?? "";
  assertSafeRlsTarget({ supabaseUrl, expectedRef, productionRef, execute });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
  if (!serviceKey || !publishableKey) throw new Error("rls_rehearsal_credentials_missing");
  const result = await executeMatrix({ matrix, supabaseUrl, serviceKey, publishableKey });
  console.log(`RLS_TWO_USER_RESULT=${JSON.stringify(result)}`);
}
