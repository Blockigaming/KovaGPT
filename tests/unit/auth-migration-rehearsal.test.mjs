import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DESTINATION_PROJECT_REF,
  FORBIDDEN_REAL_NEW_PROJECT_REF,
  IDENTITY_FIELDS,
  RehearsalError,
  USER_FIELDS,
  assertRehearsalDatabaseUrl,
  authenticateRequest,
  createRehearsalProcessGuard,
  identityFingerprint,
  importRehearsal,
  readBoundedRawJson,
  signRawBody,
  userUuidFingerprint,
  validatePayload,
} from "../../src/lib/auth-migration-rehearsal.server.mjs";
import {
  isSignedAuthMigrationRoute,
  rejectCrossSiteRequestUnlessSignedAuthMigration,
} from "../../src/lib/http-security.server.ts";

const SOURCE_ID = "synthetic-old-source";
const SECRET = "synthetic-test-secret-that-is-at-least-32-bytes";
const NOW = 2_000_000_000_000;
const TS = String(NOW / 1000);
const NONCE = "synthetic_nonce_0123456789_ABCDEFG";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID_2 = "33333333-3333-4333-8333-333333333333";
const IDENTITY_ID = "22222222-2222-4222-8222-222222222222";

const TYPES = {
  aud: "varchar",
  banned_until: "timestamptz",
  confirmation_sent_at: "timestamptz",
  confirmed_at: "timestamptz",
  created_at: "timestamptz",
  email: "varchar",
  email_confirmed_at: "timestamptz",
  encrypted_password: "varchar",
  id: "uuid",
  invited_at: "timestamptz",
  is_anonymous: "bool",
  is_sso_user: "bool",
  last_sign_in_at: "timestamptz",
  phone: "text",
  phone_confirmed_at: "timestamptz",
  raw_app_meta_data: "jsonb",
  raw_user_meta_data: "jsonb",
  role: "varchar",
  updated_at: "timestamptz",
  identity_data: "jsonb",
  provider: "text",
  provider_id: "text",
  user_id: "uuid",
};

function exactRecord(fields, values) {
  return Object.fromEntries(fields.map((field) => [field, values[field] ?? null]));
}

function user(overrides = {}) {
  return exactRecord(USER_FIELDS, {
    id: USER_ID,
    email: "Synthetic.User@Example.test",
    encrypted_password: "synthetic-verifier",
    raw_app_meta_data: { provider: "email" },
    raw_user_meta_data: { synthetic: true },
    is_anonymous: false,
    is_sso_user: false,
    ...overrides,
  });
}

function identity(overrides = {}) {
  return exactRecord(IDENTITY_FIELDS, {
    id: IDENTITY_ID,
    user_id: USER_ID,
    provider: "email",
    provider_id: "synthetic-subject",
    identity_data: { sub: "synthetic-subject" },
    ...overrides,
  });
}

function payload(overrides = {}) {
  return {
    source_id: SOURCE_ID,
    destination_project_ref: DESTINATION_PROJECT_REF,
    users: [user()],
    identities: [identity()],
    ...overrides,
  };
}

function signedHeaders(rawBody, overrides = {}) {
  return new Headers({
    "content-type": "application/json",
    "x-auth-migration-timestamp": TS,
    "x-auth-migration-nonce": NONCE,
    "x-auth-migration-signature": signRawBody(SECRET, TS, NONCE, rawBody),
    ...overrides,
  });
}

function requestWithRawBody(rawBody, headers = signedHeaders(rawBody)) {
  return new Request("https://receiver.test/api/internal/auth-migration/rehearsal", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

function columnRows() {
  return [
    ...USER_FIELDS.map((column_name) => ({
      table_name: "users",
      column_name,
      data_type: TYPES[column_name],
      udt_name: TYPES[column_name],
      is_nullable: ["id", "is_anonymous", "is_sso_user"].includes(column_name) ? "NO" : "YES",
      column_default: null,
      is_identity: "NO",
      identity_generation: null,
      is_generated: column_name === "confirmed_at" ? "ALWAYS" : "NEVER",
      generation_expression:
        column_name === "confirmed_at" ? "LEAST(email_confirmed_at, phone_confirmed_at)" : null,
    })),
    ...IDENTITY_FIELDS.map((column_name) => ({
      table_name: "identities",
      column_name,
      data_type: TYPES[column_name],
      udt_name: TYPES[column_name],
      is_nullable: ["id", "identity_data", "user_id", "provider", "provider_id"].includes(
        column_name,
      )
        ? "NO"
        : "YES",
      column_default: null,
      is_identity: "NO",
      identity_generation: null,
      is_generated: "NEVER",
      generation_expression: null,
    })),
  ];
}

function constraintRows() {
  return [
    {
      table_name: "users",
      constraint_type: "PRIMARY KEY",
      constraint_name: "users_pkey",
      column_name: "id",
    },
    {
      table_name: "identities",
      constraint_type: "PRIMARY KEY",
      constraint_name: "identities_pkey",
      column_name: "id",
    },
    {
      table_name: "identities",
      constraint_type: "FOREIGN KEY",
      constraint_name: "identities_user_id_fkey",
      column_name: "user_id",
      foreign_table_schema: "auth",
      foreign_table_name: "users",
      foreign_column_name: "id",
    },
    {
      table_name: "identities",
      constraint_type: "UNIQUE",
      constraint_name: "identities_provider_id_provider_key",
      column_name: "provider",
    },
    {
      table_name: "identities",
      constraint_type: "UNIQUE",
      constraint_name: "identities_provider_id_provider_key",
      column_name: "provider_id",
    },
  ];
}

class FakeClient {
  constructor(options = {}) {
    this.options = options;
    this.calls = [];
    this.userRows = options.actualUsers ?? [{ id: USER_ID }];
    this.identityRows = options.actualIdentities ?? [
      { user_id: USER_ID, provider: "email", provider_id: "synthetic-subject" },
    ];
  }

  async query(sql, values = []) {
    this.calls.push({ sql, values });
    if (this.options.failOn?.test(sql)) throw new Error("synthetic database timeout");
    if (sql.includes("FROM information_schema.columns")) {
      return { rows: this.options.columns ?? columnRows() };
    }
    if (sql.includes("FROM information_schema.table_constraints")) {
      return { rows: this.options.constraints ?? constraintRows() };
    }
    if (sql.startsWith("SELECT (SELECT pg_catalog.count")) {
      return {
        rows: [
          {
            users: this.options.destinationUsers ?? 0,
            identities: this.options.destinationIdentities ?? 0,
          },
        ],
      };
    }
    if (sql.includes("AS duplicates")) {
      return { rows: [{ count: this.options.duplicateSubjects ?? 0 }] };
    }
    if (sql.includes("WHERE u.id IS NULL")) {
      return { rows: [{ count: this.options.orphanIdentities ?? 0 }] };
    }
    if (sql.startsWith("SELECT id::text AS id")) return { rows: this.userRows };
    if (sql.startsWith("SELECT user_id::text AS user_id")) return { rows: this.identityRows };
    return { rows: [], rowCount: 1 };
  }
}

function expectCode(callback, code, status) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof RehearsalError);
    assert.equal(error.code, code);
    if (status) assert.equal(error.status, status);
    return true;
  });
}

async function expectCodeAsync(promise, code, status) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof RehearsalError);
    assert.equal(error.code, code);
    if (status) assert.equal(error.status, status);
    return true;
  });
}

test("receiver is disabled by default and requires exact source configuration", async () => {
  const route = await readFile("src/routes/api/internal/auth-migration/rehearsal.ts", "utf8");
  assert.match(route, /AUTH_MIGRATION_REHEARSAL_ENABLED.*!== "true"/s);
  assert.match(route, /AUTH_MIGRATION_SOURCE_ID/);
  expectCode(() => validatePayload(payload(), "different-source"), "source_not_allowed");
  expectCode(() => validatePayload(payload(), ""), "invalid_source_configuration", 503);
});

test("real NEW project is rejected as source, destination, and trusted source configuration", () => {
  expectCode(
    () => validatePayload(payload({ source_id: FORBIDDEN_REAL_NEW_PROJECT_REF }), SOURCE_ID),
    "source_rejected",
  );
  expectCode(
    () =>
      validatePayload(
        payload({ destination_project_ref: FORBIDDEN_REAL_NEW_PROJECT_REF }),
        SOURCE_ID,
      ),
    "destination_rejected",
  );
  expectCode(
    () => validatePayload(payload(), FORBIDDEN_REAL_NEW_PROJECT_REF),
    "invalid_source_configuration",
  );
  expectCode(
    () => validatePayload(payload(), `logical-${FORBIDDEN_REAL_NEW_PROJECT_REF}`),
    "invalid_source_configuration",
  );
});

test("database URL affinity accepts only direct and session-pooler rehearsal URLs", () => {
  assert.deepEqual(
    assertRehearsalDatabaseUrl(
      "postgresql://postgres:synthetic@db.oztdrjtdglkizlewnulh.supabase.co:5432/postgres",
    ),
    { kind: "direct" },
  );
  assert.deepEqual(
    assertRehearsalDatabaseUrl(
      "postgres://postgres.oztdrjtdglkizlewnulh:synthetic@aws-0-eu.pooler.supabase.com:5432/postgres",
    ),
    { kind: "session_pooler" },
  );
  for (const url of [
    "not a URL",
    "postgres://postgres:synthetic@db.wrongproject.supabase.co:5432/postgres",
    `postgres://postgres:synthetic@db.${FORBIDDEN_REAL_NEW_PROJECT_REF}.supabase.co:5432/postgres`,
    `postgres://postgres.${FORBIDDEN_REAL_NEW_PROJECT_REF}:synthetic@aws-0.pooler.supabase.com:5432/postgres`,
    "postgres://wrong:synthetic@db.oztdrjtdglkizlewnulh.supabase.co:5432/postgres",
    "postgres://postgres:synthetic@db.oztdrjtdglkizlewnulh.supabase.co:5432/wrong",
    "postgres://postgres:synthetic@db.oztdrjtdglkizlewnulh.supabase.co:6543/postgres",
  ]) {
    expectCode(() => assertRehearsalDatabaseUrl(url), "invalid_database_affinity", 503);
  }
});

test("exact MD5 evidence canonicalization is stable and excludes identity id", () => {
  assert.equal(userUuidFingerprint([USER_ID_2, USER_ID]), "0f6299e16e097a34b75f639718931258");
  const evidence = [
    { id: "ignored-a", user_id: USER_ID_2, provider: "google", provider_id: "z" },
    { id: "ignored-b", user_id: USER_ID, provider: "email", provider_id: "a" },
  ];
  assert.equal(identityFingerprint(evidence), "b0dfeab6f016772d26403e706b43f0e9");
  assert.equal(
    identityFingerprint(evidence),
    identityFingerprint(evidence.map((item) => ({ ...item, id: "different" }))),
  );
});

test("only email and google providers are accepted", () => {
  for (const provider of ["email", "google"]) {
    assert.equal(
      validatePayload(payload({ identities: [identity({ provider })] }), SOURCE_ID).identities[0]
        .provider,
      provider,
    );
  }
  for (const provider of ["github", "phone", "valid_looking_provider"]) {
    expectCode(
      () => validatePayload(payload({ identities: [identity({ provider })] }), SOURCE_ID),
      "invalid_provider_subject",
    );
  }
});

test("mixed-case email is preserved and duplicate detection is case-insensitive", () => {
  const mixed = "MiXeD.User@Example.TEST";
  const validated = validatePayload(payload({ users: [user({ email: mixed })] }), SOURCE_ID);
  assert.equal(validated.users[0].email, mixed);
  expectCode(
    () =>
      validatePayload(
        payload({
          users: [user({ email: mixed }), user({ id: USER_ID_2, email: mixed.toLowerCase() })],
          identities: [],
        }),
        SOURCE_ID,
      ),
    "email_conflict",
  );
});

test("payload contract omits generated identity email, instance and pending state", () => {
  for (const field of [
    "instance_id",
    "email_change",
    "email_change_sent_at",
    "phone_change",
    "phone_change_sent_at",
    "recovery_sent_at",
  ]) {
    assert.equal(USER_FIELDS.includes(field), false);
    expectCode(
      () => validatePayload(payload({ users: [{ ...user(), [field]: null }] }), SOURCE_ID),
      "unknown_field",
    );
  }
  assert.equal(IDENTITY_FIELDS.includes("email"), false);
  expectCode(
    () =>
      validatePayload(
        payload({ identities: [{ ...identity(), email: "synthetic@example.test" }] }),
        SOURCE_ID,
      ),
    "unknown_field",
  );
});

test("Content-Type, malformed JSON, and bounded raw body are enforced", async () => {
  const raw = JSON.stringify(payload());
  await expectCodeAsync(
    readBoundedRawJson(requestWithRawBody(raw, new Headers({ "content-type": "text/plain" }))),
    "unsupported_media_type",
    415,
  );
  await expectCodeAsync(readBoundedRawJson(requestWithRawBody("{")), "invalid_json");
  await expectCodeAsync(readBoundedRawJson(requestWithRawBody(raw), 8), "request_too_large", 413);
});

test("HMAC authenticates exact raw bytes and fails closed for changes", () => {
  const raw = '{"synthetic":true, "spacing":"retained"}';
  const auth = authenticateRequest({
    headers: signedHeaders(raw),
    rawBody: raw,
    secret: SECRET,
    now: NOW,
  });
  assert.equal(auth.nonce, NONCE);
  expectCode(
    () =>
      authenticateRequest({
        headers: signedHeaders(raw),
        rawBody: `${raw}\n`,
        secret: SECRET,
        now: NOW,
      }),
    "invalid_mac",
    401,
  );
  expectCode(
    () =>
      authenticateRequest({
        headers: signedHeaders(raw, { "x-auth-migration-signature": "0".repeat(64) }),
        rawBody: raw,
        secret: SECRET,
        now: NOW,
      }),
    "invalid_mac",
    401,
  );
  expectCode(
    () =>
      authenticateRequest({
        headers: signedHeaders(raw),
        rawBody: raw,
        secret: SECRET,
        now: NOW + 301_000,
      }),
    "expired_timestamp",
    401,
  );
});

test("nonce replay is bounded and process is gone after success", () => {
  const guard = createRehearsalProcessGuard({ maxNonces: 2, ttlMs: 1_000 });
  guard.claimNonce(NONCE, NOW);
  expectCode(() => guard.claimNonce(NONCE, NOW + 1), "replayed_nonce", 409);
  guard.claimNonce("another_synthetic_nonce_1234567890", NOW + 2_000);
  guard.markCompleted();
  expectCode(() => guard.assertAvailable(), "gone", 410);
  expectCode(() => guard.claimNonce("third_synthetic_nonce_123456789", NOW + 2_001), "gone", 410);
});

test("duplicate provider subjects and orphan identities are rejected before database access", () => {
  expectCode(
    () =>
      validatePayload(
        payload({
          identities: [identity(), identity({ id: "44444444-4444-4444-8444-444444444444" })],
        }),
        SOURCE_ID,
      ),
    "duplicate_provider_subject",
  );
  expectCode(
    () => validatePayload(payload({ identities: [identity({ user_id: USER_ID_2 })] }), SOURCE_ID),
    "orphan_identity",
  );
});

test("nonempty destination rolls back", async () => {
  const client = new FakeClient({ destinationUsers: 1 });
  await expectCodeAsync(
    importRehearsal(client, validatePayload(payload(), SOURCE_ID)),
    "destination_not_empty",
    409,
  );
  assert.equal(client.calls.at(-1).sql, "ROLLBACK");
});

test("schema preflight omits generated confirmed_at and inserts users before identities with UUIDs", async () => {
  const client = new FakeClient();
  await importRehearsal(client, validatePayload(payload(), SOURCE_ID));
  const userInsert = client.calls.findIndex(({ sql }) => sql.startsWith("INSERT INTO auth.users"));
  const identityInsert = client.calls.findIndex(({ sql }) =>
    sql.startsWith("INSERT INTO auth.identities"),
  );
  assert.ok(userInsert > -1 && identityInsert > userInsert);
  assert.doesNotMatch(client.calls[userInsert].sql, /(^|[, (])confirmed_at([, )]|$)/);
  assert.equal(
    client.calls[userInsert].values[
      USER_FIELDS.filter((field) => field !== "confirmed_at").indexOf("id")
    ],
    USER_ID,
  );
  assert.equal(client.calls[identityInsert].values[IDENTITY_FIELDS.indexOf("id")], IDENTITY_ID);
});

test("schema preflight fails closed on unreviewed generated columns or missing constraints", async () => {
  const badColumns = columnRows().map((column) =>
    column.table_name === "users" && column.column_name === "email"
      ? { ...column, is_generated: "ALWAYS", generation_expression: "lower(email)" }
      : column,
  );
  await expectCodeAsync(
    importRehearsal(new FakeClient({ columns: badColumns }), validatePayload(payload(), SOURCE_ID)),
    "schema_contract_mismatch",
    503,
  );
  await expectCodeAsync(
    importRehearsal(new FakeClient({ constraints: [] }), validatePayload(payload(), SOURCE_ID)),
    "schema_contract_mismatch",
    503,
  );
});

test("transaction applies bounded timeouts and rolls back database timeout", async () => {
  const client = new FakeClient({ failOn: /INSERT INTO auth.identities/ });
  await expectCodeAsync(
    importRehearsal(client, validatePayload(payload(), SOURCE_ID)),
    "database_operation_failed",
    503,
  );
  assert.deepEqual(
    client.calls.slice(1, 4).map(({ sql }) => sql),
    [
      "SET LOCAL lock_timeout = '5s'",
      "SET LOCAL statement_timeout = '30s'",
      "SET LOCAL idle_in_transaction_session_timeout = '30s'",
    ],
  );
  assert.equal(client.calls.at(-1).sql, "ROLLBACK");
  assert.equal(
    client.calls.some(({ sql }) => sql === "COMMIT"),
    false,
  );
});

test("post-insert verification uses actual database rows and rejects duplicates and orphans", async () => {
  const client = new FakeClient();
  const result = await importRehearsal(client, validatePayload(payload(), SOURCE_ID));
  assert.equal(
    client.calls.some(({ sql }) => sql.startsWith("SELECT id::text AS id")),
    true,
  );
  assert.equal(
    client.calls.some(({ sql }) => sql.startsWith("SELECT user_id::text AS user_id")),
    true,
  );
  assert.equal(result.user_uuid_fingerprint, userUuidFingerprint([USER_ID]));
  assert.equal(result.identity_fingerprint, identityFingerprint(client.identityRows));
  for (const options of [
    { duplicateSubjects: 1 },
    { orphanIdentities: 1 },
    { actualUsers: [{ id: USER_ID_2 }] },
  ]) {
    await expectCodeAsync(
      importRehearsal(new FakeClient(options), validatePayload(payload(), SOURCE_ID)),
      "post_insert_verification_failed",
      500,
    );
  }
});

test("response contains only nonsensitive evidence", async () => {
  const result = await importRehearsal(new FakeClient(), validatePayload(payload(), SOURCE_ID));
  assert.deepEqual(Object.keys(result).sort(), [
    "identities",
    "identity_fingerprint",
    "provider_distribution",
    "status",
    "user_uuid_fingerprint",
    "users",
  ]);
  assert.doesNotMatch(JSON.stringify(result), /example|verifier|identity_data|secret|database/i);
});

test("request path has an exact middleware exception while adjacent routes remain protected", async () => {
  const [httpSecurity, start, server] = await Promise.all([
    readFile("src/lib/http-security.server.ts", "utf8"),
    readFile("src/start.ts", "utf8"),
    readFile("src/server.ts", "utf8"),
  ]);
  assert.match(httpSecurity, /pathname === "\/api\/internal\/auth-migration\/rehearsal"/);
  assert.match(httpSecurity, /request\.method === "POST"/);
  assert.match(
    httpSecurity,
    /isSignedAuthMigrationRoute\(request\) \? null : rejectCrossSiteRequest/,
  );
  assert.doesNotMatch(start, /startsWith\("\/lovable\/"\)/);
  assert.match(start, /rejectCrossSiteRequestUnlessSignedAuthMigration/);
  assert.match(server, /rejectCrossSiteRequestUnlessSignedAuthMigration/);
  assert.doesNotMatch(httpSecurity, /\/api\/internal\/.*startsWith/);
  const crossSiteHeaders = { origin: "https://attacker.test", "sec-fetch-site": "cross-site" };
  const exact = new Request(
    "https://receiver.test/api/internal/auth-migration/rehearsal?ignored=query",
    { method: "POST", headers: crossSiteHeaders },
  );
  const adjacent = new Request("https://receiver.test/api/internal/auth-migration/adjacent", {
    method: "POST",
    headers: crossSiteHeaders,
  });
  assert.equal(isSignedAuthMigrationRoute(exact), true);
  assert.equal(rejectCrossSiteRequestUnlessSignedAuthMigration(exact), null);
  assert.equal(isSignedAuthMigrationRoute(adjacent), false);
  assert.equal(rejectCrossSiteRequestUnlessSignedAuthMigration(adjacent)?.status, 403);
});

test("invalid signature fails before payload validation or database creation", async () => {
  const raw = JSON.stringify(payload());
  expectCode(
    () =>
      authenticateRequest({
        headers: signedHeaders(raw, { "x-auth-migration-signature": "f".repeat(64) }),
        rawBody: raw,
        secret: SECRET,
        now: NOW,
      }),
    "invalid_mac",
    401,
  );
});

test("receiver source contains no request-time DDL or forbidden project connection path", async () => {
  const [library, route] = await Promise.all([
    readFile("src/lib/auth-migration-rehearsal.server.mjs", "utf8"),
    readFile("src/routes/api/internal/auth-migration/rehearsal.ts", "utf8"),
  ]);
  assert.doesNotMatch(library, /CREATE\s+TABLE/i);
  assert.match(route, /assertRehearsalDatabaseUrl\(databaseUrl\)[\s\S]*new Client/);
  assert.match(
    route,
    /authenticateRequest\([\s\S]*validatePayload\([\s\S]*processGuard\.claimNonce\([\s\S]*new Client/,
  );
  assert.doesNotMatch(route, /source_project_ref|SOURCE_PROJECT_REF/);
});
