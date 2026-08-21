import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_MATRIX_PATH = "release-rls-matrix.json";
const DENIED_STATUSES = new Set([401, 403]);

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
  if (matrix?.schemaVersion !== 2) throw new Error("rls_matrix_schema_invalid");
  const protectedTables = Array.isArray(matrix.protectedTables) ? matrix.protectedTables : [];
  if (!protectedTables.length) throw new Error("rls_matrix_empty");
  const declared = new Set(databaseContract?.tables ?? []);
  const names = new Set();
  const bindings = new Set(["USER_A", "USER_B", "EMAIL_A", "EMAIL_B", "MARKER"]);

  for (const entry of protectedTables) {
    if (!entry || typeof entry.table !== "string" || !entry.table)
      throw new Error("rls_matrix_table_invalid");
    if (names.has(entry.table)) throw new Error(`rls_matrix_duplicate:${entry.table}`);
    names.add(entry.table);
    if (!declared.has(entry.table)) throw new Error(`rls_matrix_unknown_table:${entry.table}`);
    if (
      !Array.isArray(entry.operations) ||
      !["select", "update", "delete"].every((op) => entry.operations.includes(op))
    ) {
      throw new Error(`rls_matrix_operations_incomplete:${entry.table}`);
    }
    if (
      !["direct_user", "project_membership", "shared_resource", "server_managed"].includes(
        entry.accessModel,
      )
    ) {
      throw new Error(`rls_matrix_access_model_invalid:${entry.table}`);
    }
    const fixture = entry.fixture;
    if (!fixture || typeof fixture !== "object")
      throw new Error(`rls_matrix_fixture_missing:${entry.table}`);
    if (typeof fixture.idColumn !== "string" || !fixture.idColumn)
      throw new Error(`rls_matrix_id_column_missing:${entry.table}`);
    if (!fixture.row || typeof fixture.row !== "object" || Array.isArray(fixture.row))
      throw new Error(`rls_matrix_row_missing:${entry.table}`);
    if (
      !fixture.updatePatch ||
      typeof fixture.updatePatch !== "object" ||
      Array.isArray(fixture.updatePatch)
    ) {
      throw new Error(`rls_matrix_update_patch_missing:${entry.table}`);
    }
    for (const [binding, column] of Object.entries(fixture.bindings ?? {})) {
      if (!/^[A-Z][A-Z0-9_]*$/u.test(binding) || typeof column !== "string" || !column)
        throw new Error(`rls_matrix_binding_invalid:${entry.table}`);
      bindings.add(binding);
    }
  }

  return {
    protectedTableCount: protectedTables.length,
    fixtureCount: protectedTables.filter((entry) => entry.fixture).length,
    bindings: [...bindings].sort(),
  };
}

export function assertSafeRlsTarget({ supabaseUrl, expectedRef, productionRef, execute }) {
  const actualRef = projectRefFromUrl(supabaseUrl);
  if (!actualRef || actualRef !== expectedRef) throw new Error("rls_rehearsal_target_mismatch");
  if (execute && actualRef === productionRef)
    throw new Error("rls_rehearsal_production_target_prohibited");
  return actualRef;
}

function substitute(value, context) {
  if (typeof value === "string") {
    return value.replace(/\$([A-Z][A-Z0-9_]*)/gu, (_match, name) => {
      if (!(name in context)) throw new Error(`rls_fixture_binding_missing:${name}`);
      return String(context[name]);
    });
  }
  if (Array.isArray(value)) return value.map((item) => substitute(item, context));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substitute(item, context)]),
    );
  }
  return value;
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

function assertDenied(result, code) {
  if (result.response.ok) {
    if (!Array.isArray(result.data) || result.data.length !== 0) throw new Error(code);
    return;
  }
  if (!DENIED_STATUSES.has(result.response.status)) {
    throw new Error(`${code}:unexpected_status_${result.response.status}`);
  }
}

function dataHeaders(key, token = null) {
  return {
    apikey: key,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

async function selectFixture(supabaseUrl, entry, fixture, headers) {
  const filter = `${encodeURIComponent(fixture.idColumn)}=eq.${encodeURIComponent(String(fixture.id))}`;
  return request(`${supabaseUrl}/rest/v1/${entry.table}?${filter}`, { headers });
}

async function assertFixtureStillExists(supabaseUrl, entry, fixture, adminHeaders) {
  const result = await selectFixture(supabaseUrl, entry, fixture, adminHeaders);
  if (!result.response.ok || !Array.isArray(result.data) || result.data.length !== 1)
    throw new Error(`rls_fixture_missing_after_denial:${entry.table}`);
}

async function executeMatrix({ matrix, supabaseUrl, serviceKey, publishableKey }) {
  const marker = crypto.randomUUID();
  const password = `${crypto.randomUUID()}Aa1!`;
  const users = [];
  const createdRows = [];
  const adminHeaders = dataHeaders(serviceKey, serviceKey);
  const context = { MARKER: marker };

  try {
    for (const label of ["A", "B"]) {
      const email = `rls-${marker}-${label.toLowerCase()}@example.invalid`;
      const created = await request(`${supabaseUrl}/auth/v1/admin/users`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          email,
          password,
          email_confirm: true,
          app_metadata: { kova_rls_rehearsal: marker },
        }),
      });
      if (!created.response.ok || !created.data?.id)
        throw new Error(`rls_user_create_failed:${label}`);
      const signedIn = await request(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: dataHeaders(publishableKey),
        body: JSON.stringify({ email, password }),
      });
      if (!signedIn.response.ok || !signedIn.data?.access_token)
        throw new Error(`rls_user_signin_failed:${label}`);
      const user = { id: created.data.id, email, token: signedIn.data.access_token };
      users.push(user);
      context[`USER_${label}`] = user.id;
      context[`EMAIL_${label}`] = user.email;
    }

    const headersA = dataHeaders(publishableKey, users[0].token);
    const headersB = dataHeaders(publishableKey, users[1].token);
    const anonymousHeaders = dataHeaders(publishableKey);

    for (const entry of matrix.protectedTables) {
      const fixtureDefinition = entry.fixture;
      const row = substitute(structuredClone(fixtureDefinition.row), context);
      const inserted = await request(`${supabaseUrl}/rest/v1/${entry.table}`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify(row),
      });
      if (
        !inserted.response.ok ||
        !Array.isArray(inserted.data) ||
        !inserted.data[0] ||
        inserted.data[0][fixtureDefinition.idColumn] === undefined
      ) {
        throw new Error(`rls_fixture_insert_failed:${entry.table}`);
      }

      const insertedRow = inserted.data[0];
      const fixture = {
        idColumn: fixtureDefinition.idColumn,
        id: insertedRow[fixtureDefinition.idColumn],
        updatePatch: substitute(structuredClone(fixtureDefinition.updatePatch), context),
      };
      createdRows.push({ entry, fixture });
      for (const [binding, column] of Object.entries(fixtureDefinition.bindings ?? {})) {
        if (insertedRow[column] === undefined)
          throw new Error(`rls_fixture_binding_column_missing:${entry.table}:${column}`);
        context[binding] = insertedRow[column];
      }

      const ownerRead = await selectFixture(supabaseUrl, entry, fixture, headersA);
      if (!ownerRead.response.ok || !Array.isArray(ownerRead.data) || ownerRead.data.length !== 1)
        throw new Error(`rls_owner_read_failed:${entry.table}`);

      assertDenied(
        await selectFixture(supabaseUrl, entry, fixture, anonymousHeaders),
        `rls_anonymous_read_allowed:${entry.table}`,
      );
      assertDenied(
        await selectFixture(supabaseUrl, entry, fixture, headersB),
        `rls_cross_user_read_allowed:${entry.table}`,
      );

      const filter = `${encodeURIComponent(fixture.idColumn)}=eq.${encodeURIComponent(String(fixture.id))}`;
      assertDenied(
        await request(`${supabaseUrl}/rest/v1/${entry.table}?${filter}`, {
          method: "PATCH",
          headers: headersB,
          body: JSON.stringify(fixture.updatePatch),
        }),
        `rls_cross_user_update_allowed:${entry.table}`,
      );
      await assertFixtureStillExists(supabaseUrl, entry, fixture, adminHeaders);

      assertDenied(
        await request(`${supabaseUrl}/rest/v1/${entry.table}?${filter}`, {
          method: "DELETE",
          headers: headersB,
        }),
        `rls_cross_user_delete_allowed:${entry.table}`,
      );
      await assertFixtureStillExists(supabaseUrl, entry, fixture, adminHeaders);
    }

    return {
      users: users.length,
      tables: matrix.protectedTables.length,
      anonymousReadDenied: matrix.protectedTables.length,
      crossUserReadDenied: matrix.protectedTables.length,
      crossUserUpdateDenied: matrix.protectedTables.length,
      crossUserDeleteDenied: matrix.protectedTables.length,
      serviceRoleVerified: matrix.protectedTables.length,
      result: "PASS",
    };
  } finally {
    for (const { entry, fixture } of createdRows.reverse()) {
      await request(
        `${supabaseUrl}/rest/v1/${entry.table}?${encodeURIComponent(fixture.idColumn)}=eq.${encodeURIComponent(String(fixture.id))}`,
        { method: "DELETE", headers: adminHeaders },
      );
    }
    for (const user of users.reverse()) {
      await request(`${supabaseUrl}/auth/v1/admin/users/${user.id}`, {
        method: "DELETE",
        headers: adminHeaders,
      });
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const execute = process.argv.includes("--execute");
  const matrixPath = resolve(process.env.KOVA_RLS_MATRIX ?? DEFAULT_MATRIX_PATH);
  const contractPath = resolve(process.env.KOVA_DATABASE_CONTRACT ?? "database-contract.json");
  if (!existsSync(matrixPath) || !existsSync(contractPath))
    throw new Error("rls_rehearsal_inputs_missing");
  const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));
  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  const inventory = validateRlsMatrix(matrix, contract);
  if (!execute) {
    console.log(
      `RLS_TWO_USER_DRY_RUN=${JSON.stringify({ ...inventory, executionReady: inventory.fixtureCount === inventory.protectedTableCount })}`,
    );
    process.exit(0);
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? "";
  const expectedRef = process.env.SUPABASE_PROJECT_REF ?? "";
  const productionRef = process.env.KOVA_PRODUCTION_SUPABASE_PROJECT_REF ?? "";
  assertSafeRlsTarget({ supabaseUrl, expectedRef, productionRef, execute });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
  if (!serviceKey || !publishableKey) throw new Error("rls_rehearsal_credentials_missing");
  const result = await executeMatrix({ matrix, supabaseUrl, serviceKey, publishableKey });
  console.log(`RLS_TWO_USER_RESULT=${JSON.stringify(result)}`);
}
