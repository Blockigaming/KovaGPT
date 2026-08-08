import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const DESTINATION_PROJECT_REF = "oztdrjtdglkizlewnulh";
export const FORBIDDEN_REAL_NEW_PROJECT_REF = "mfbycmbjygcfkrsuepxf";
export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_CLOCK_SKEW_SECONDS = 300;
export const NONCE_TTL_MS = MAX_CLOCK_SKEW_SECONDS * 2 * 1000;
export const MAX_NONCES = 2048;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_ID = /^[A-Za-z0-9_-]{3,128}$/;
const PROVIDERS = new Set(["email", "google"]);
const PAYLOAD_FIELDS = ["destination_project_ref", "identities", "source_id", "users"];
export const USER_FIELDS = [
  "aud",
  "banned_until",
  "confirmation_sent_at",
  "confirmed_at",
  "created_at",
  "email",
  "email_confirmed_at",
  "encrypted_password",
  "id",
  "invited_at",
  "is_anonymous",
  "is_sso_user",
  "last_sign_in_at",
  "phone",
  "phone_confirmed_at",
  "raw_app_meta_data",
  "raw_user_meta_data",
  "role",
  "updated_at",
];
export const IDENTITY_FIELDS = [
  "created_at",
  "id",
  "identity_data",
  "last_sign_in_at",
  "provider",
  "provider_id",
  "updated_at",
  "user_id",
];

const USER_COLUMN_TYPES = new Map([
  ["aud", new Set(["varchar", "text"])],
  ["banned_until", new Set(["timestamptz"])],
  ["confirmation_sent_at", new Set(["timestamptz"])],
  ["confirmed_at", new Set(["timestamptz"])],
  ["created_at", new Set(["timestamptz"])],
  ["email", new Set(["varchar", "text"])],
  ["email_confirmed_at", new Set(["timestamptz"])],
  ["encrypted_password", new Set(["varchar", "text"])],
  ["id", new Set(["uuid"])],
  ["invited_at", new Set(["timestamptz"])],
  ["is_anonymous", new Set(["bool"])],
  ["is_sso_user", new Set(["bool"])],
  ["last_sign_in_at", new Set(["timestamptz"])],
  ["phone", new Set(["varchar", "text"])],
  ["phone_confirmed_at", new Set(["timestamptz"])],
  ["raw_app_meta_data", new Set(["jsonb"])],
  ["raw_user_meta_data", new Set(["jsonb"])],
  ["role", new Set(["varchar", "text"])],
  ["updated_at", new Set(["timestamptz"])],
]);
const IDENTITY_COLUMN_TYPES = new Map([
  ["created_at", new Set(["timestamptz"])],
  ["id", new Set(["uuid"])],
  ["identity_data", new Set(["jsonb"])],
  ["last_sign_in_at", new Set(["timestamptz"])],
  ["provider", new Set(["text", "varchar"])],
  ["provider_id", new Set(["text", "varchar"])],
  ["updated_at", new Set(["timestamptz"])],
  ["user_id", new Set(["uuid"])],
]);
const NON_NULL_COLUMNS = new Map([
  ["users", new Set(["id", "is_anonymous", "is_sso_user"])],
  ["identities", new Set(["id", "identity_data", "provider", "provider_id", "user_id"])],
]);

export class RehearsalError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "RehearsalError";
    this.code = code;
    this.status = status;
  }
}

function exactFields(value, allowed, code) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new RehearsalError(code);
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key))) throw new RehearsalError("unknown_field");
  if (keys.length !== allowed.length || allowed.some((key) => !keys.includes(key))) {
    throw new RehearsalError(code);
  }
}

function jsonObject(value, code) {
  if (!value || Array.isArray(value) || typeof value !== "object") throw new RehearsalError(code);
  return value;
}

function nullableString(value, max = 4096) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > max) throw new RehearsalError("invalid_payload");
  return value;
}

export function signatureInput(timestamp, nonce, exactRawBody) {
  return `v1\n${timestamp}\n${nonce}\n${exactRawBody}`;
}

export function signRawBody(secret, timestamp, nonce, exactRawBody) {
  return createHmac("sha256", secret)
    .update(signatureInput(timestamp, nonce, exactRawBody), "utf8")
    .digest("hex");
}

export function verifyRawBodySignature(secret, timestamp, nonce, exactRawBody, supplied) {
  if (!/^[0-9a-f]{64}$/i.test(supplied ?? "")) return false;
  const expected = Buffer.from(signRawBody(secret, timestamp, nonce, exactRawBody), "hex");
  const actual = Buffer.from(supplied, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function assertRehearsalDatabaseUrl(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new RehearsalError("invalid_database_affinity", 503);
  }
  const protocolAllowed = parsed.protocol === "postgres:" || parsed.protocol === "postgresql:";
  const hostname = parsed.hostname.toLowerCase();
  let username;
  try {
    username = decodeURIComponent(parsed.username);
  } catch {
    throw new RehearsalError("invalid_database_affinity", 503);
  }
  const affinityUsername = username.toLowerCase();
  const database = parsed.pathname.replace(/^\//, "");
  const port = parsed.port || "5432";
  if (
    !protocolAllowed ||
    hostname.includes(FORBIDDEN_REAL_NEW_PROJECT_REF) ||
    affinityUsername.includes(FORBIDDEN_REAL_NEW_PROJECT_REF) ||
    database !== "postgres" ||
    port !== "5432" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new RehearsalError("invalid_database_affinity", 503);
  }
  const direct =
    hostname === `db.${DESTINATION_PROJECT_REF}.supabase.co` && username === "postgres";
  const sessionPooler =
    hostname.endsWith(".pooler.supabase.com") &&
    hostname !== ".pooler.supabase.com" &&
    username === `postgres.${DESTINATION_PROJECT_REF}`;
  if (!direct && !sessionPooler) throw new RehearsalError("invalid_database_affinity", 503);
  return { kind: direct ? "direct" : "session_pooler" };
}

export function validatePayload(payload, configuredSourceId) {
  exactFields(payload, PAYLOAD_FIELDS, "invalid_payload");
  if (
    typeof configuredSourceId !== "string" ||
    !SOURCE_ID.test(configuredSourceId) ||
    configuredSourceId.toLowerCase().includes(FORBIDDEN_REAL_NEW_PROJECT_REF) ||
    configuredSourceId.toLowerCase().includes(DESTINATION_PROJECT_REF)
  ) {
    throw new RehearsalError("invalid_source_configuration", 503);
  }
  if (payload.source_id === FORBIDDEN_REAL_NEW_PROJECT_REF) {
    throw new RehearsalError("source_rejected");
  }
  if (payload.source_id !== configuredSourceId) throw new RehearsalError("source_not_allowed");
  if (payload.destination_project_ref === FORBIDDEN_REAL_NEW_PROJECT_REF) {
    throw new RehearsalError("destination_rejected");
  }
  if (payload.destination_project_ref !== DESTINATION_PROJECT_REF) {
    throw new RehearsalError("destination_not_allowed");
  }
  if (!Array.isArray(payload.users) || !Array.isArray(payload.identities)) {
    throw new RehearsalError("invalid_payload");
  }
  if (payload.users.length > 100 || payload.identities.length > 200) {
    throw new RehearsalError("payload_limit");
  }

  const userIds = new Set();
  const emailKeys = new Set();
  const users = payload.users.map((user) => {
    exactFields(user, USER_FIELDS, "invalid_user");
    if (!UUID.test(user.id) || userIds.has(user.id)) throw new RehearsalError("invalid_user_uuid");
    userIds.add(user.id);
    const originalEmail = nullableString(user.email, 320);
    const emailKey = originalEmail?.toLocaleLowerCase("en-US") ?? null;
    if (emailKey && emailKeys.has(emailKey)) throw new RehearsalError("email_conflict");
    if (emailKey) emailKeys.add(emailKey);
    jsonObject(user.raw_app_meta_data, "invalid_metadata");
    jsonObject(user.raw_user_meta_data, "invalid_metadata");
    return { ...user, email: originalEmail };
  });

  const identityIds = new Set();
  const subjects = new Set();
  const identities = payload.identities.map((identity) => {
    exactFields(identity, IDENTITY_FIELDS, "invalid_identity");
    if (!UUID.test(identity.id) || identityIds.has(identity.id)) {
      throw new RehearsalError("invalid_identity_uuid");
    }
    if (!UUID.test(identity.user_id) || !userIds.has(identity.user_id)) {
      throw new RehearsalError("orphan_identity");
    }
    if (
      !PROVIDERS.has(identity.provider) ||
      typeof identity.provider_id !== "string" ||
      !identity.provider_id ||
      identity.provider_id.length > 512
    ) {
      throw new RehearsalError("invalid_provider_subject");
    }
    const subject = `${identity.provider}\0${identity.provider_id}`;
    if (subjects.has(subject)) throw new RehearsalError("duplicate_provider_subject");
    subjects.add(subject);
    identityIds.add(identity.id);
    jsonObject(identity.identity_data, "invalid_identity_data");
    return { ...identity };
  });
  return { users, identities };
}

export function userUuidFingerprint(ids) {
  return createHash("md5")
    .update([...ids].sort().join("\n"), "utf8")
    .digest("hex");
}

export function identityFingerprint(identities) {
  return createHash("md5")
    .update(
      identities
        .map(({ user_id, provider, provider_id }) => `${user_id}|${provider}|${provider_id}`)
        .sort()
        .join("\n"),
      "utf8",
    )
    .digest("hex");
}

export async function readBoundedRawJson(request, limit = MAX_BODY_BYTES) {
  if (request.headers.get("content-type")?.toLowerCase().trim() !== "application/json") {
    throw new RehearsalError("unsupported_media_type", 415);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new RehearsalError("invalid_body");
  let size = 0;
  const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new RehearsalError("request_too_large", 413);
    }
    chunks.push(Buffer.from(value));
  }
  const rawBody = Buffer.concat(chunks).toString("utf8");
  try {
    return { rawBody, payload: JSON.parse(rawBody) };
  } catch {
    throw new RehearsalError("invalid_json");
  }
}

export function authenticateRequest({ headers, rawBody, secret, now = Date.now() }) {
  const timestamp = headers.get("x-auth-migration-timestamp") ?? "";
  const nonce = headers.get("x-auth-migration-nonce") ?? "";
  const signature = headers.get("x-auth-migration-signature") ?? "";
  if (!/^\d{10}$/.test(timestamp) || !/^[A-Za-z0-9_-]{32,128}$/.test(nonce)) {
    throw new RehearsalError("invalid_auth", 401);
  }
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) {
    throw new RehearsalError("expired_timestamp", 401);
  }
  if (!verifyRawBodySignature(secret, timestamp, nonce, rawBody, signature)) {
    throw new RehearsalError("invalid_mac", 401);
  }
  return { timestamp: Number(timestamp), nonce };
}

export function createRehearsalProcessGuard({ maxNonces = MAX_NONCES, ttlMs = NONCE_TTL_MS } = {}) {
  const nonces = new Map();
  let completed = false;
  const prune = (now) => {
    for (const [nonce, expiresAt] of nonces) if (expiresAt <= now) nonces.delete(nonce);
    while (nonces.size >= maxNonces) nonces.delete(nonces.keys().next().value);
  };
  return {
    assertAvailable() {
      if (completed) throw new RehearsalError("gone", 410);
    },
    claimNonce(nonce, now = Date.now()) {
      this.assertAvailable();
      prune(now);
      if (nonces.has(nonce)) throw new RehearsalError("replayed_nonce", 409);
      nonces.set(nonce, now + ttlMs);
    },
    markCompleted() {
      completed = true;
    },
    get completed() {
      return completed;
    },
  };
}

const COLUMN_PREFLIGHT_SQL = `
SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default,
       is_identity, identity_generation, is_generated, generation_expression
FROM information_schema.columns
WHERE table_schema = 'auth' AND table_name IN ('users', 'identities')
ORDER BY table_name, ordinal_position`;
const CONSTRAINT_PREFLIGHT_SQL = `
SELECT tc.table_name, tc.constraint_type, tc.constraint_name,
       kcu.column_name, ccu.table_schema AS foreign_table_schema,
       ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON kcu.constraint_catalog = tc.constraint_catalog
 AND kcu.constraint_schema = tc.constraint_schema
 AND kcu.constraint_name = tc.constraint_name
LEFT JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_catalog = tc.constraint_catalog
 AND ccu.constraint_schema = tc.constraint_schema
 AND ccu.constraint_name = tc.constraint_name
WHERE tc.table_schema = 'auth' AND tc.table_name IN ('users', 'identities')
  AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY')
ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position`;

function validateReviewedColumns(rows, table, reviewedTypes) {
  const tableRows = rows.filter((row) => row.table_name === table);
  const byName = new Map(tableRows.map((row) => [row.column_name, row]));
  const insertColumns = [];
  for (const [name, types] of reviewedTypes) {
    const column = byName.get(name);
    const expectedNullable = NON_NULL_COLUMNS.get(table).has(name) ? "NO" : "YES";
    if (
      !column ||
      !types.has(column.udt_name) ||
      typeof column.data_type !== "string" ||
      column.is_nullable !== expectedNullable ||
      (column.column_default !== null && typeof column.column_default !== "string") ||
      !["YES", "NO"].includes(column.is_identity) ||
      !["NEVER", "ALWAYS"].includes(column.is_generated)
    )
      throw new RehearsalError("schema_contract_mismatch", 503);
    const generated = column.is_generated !== "NEVER" || Boolean(column.generation_expression);
    const identity = column.is_identity === "YES" || Boolean(column.identity_generation);
    if (name === "confirmed_at" && generated && !identity) continue;
    if (generated || identity) throw new RehearsalError("schema_contract_mismatch", 503);
    insertColumns.push(name);
  }
  return insertColumns;
}

function hasConstraint(rows, predicate) {
  return rows.some(predicate);
}

export async function preflightAuthInsertability(client) {
  const columns = await client.query(COLUMN_PREFLIGHT_SQL);
  const constraints = await client.query(CONSTRAINT_PREFLIGHT_SQL);
  const userColumns = validateReviewedColumns(columns.rows, "users", USER_COLUMN_TYPES);
  const identityColumns = validateReviewedColumns(
    columns.rows,
    "identities",
    IDENTITY_COLUMN_TYPES,
  );
  const hasUsersPk = hasConstraint(
    constraints.rows,
    (row) =>
      row.table_name === "users" &&
      row.constraint_type === "PRIMARY KEY" &&
      row.column_name === "id",
  );
  const hasIdentitiesPk = hasConstraint(
    constraints.rows,
    (row) =>
      row.table_name === "identities" &&
      row.constraint_type === "PRIMARY KEY" &&
      row.column_name === "id",
  );
  const hasIdentityFk = hasConstraint(
    constraints.rows,
    (row) =>
      row.table_name === "identities" &&
      row.constraint_type === "FOREIGN KEY" &&
      row.column_name === "user_id" &&
      row.foreign_table_schema === "auth" &&
      row.foreign_table_name === "users" &&
      row.foreign_column_name === "id",
  );
  const uniqueConstraints = new Map();
  for (const row of constraints.rows.filter(
    (candidate) => candidate.table_name === "identities" && candidate.constraint_type === "UNIQUE",
  )) {
    const columns = uniqueConstraints.get(row.constraint_name) ?? new Set();
    columns.add(row.column_name);
    uniqueConstraints.set(row.constraint_name, columns);
  }
  const hasUniqueSubject = [...uniqueConstraints.values()].some(
    (columns) => columns.size === 2 && columns.has("provider") && columns.has("provider_id"),
  );
  if (!hasUsersPk || !hasIdentitiesPk || !hasIdentityFk || !hasUniqueSubject) {
    throw new RehearsalError("schema_contract_mismatch", 503);
  }
  return { userColumns, identityColumns };
}

const placeholders = (count) =>
  Array.from({ length: count }, (_, index) => `$${index + 1}`).join(", ");

function evidenceFromRows(userRows, identityRows) {
  const providers = { email: 0, google: 0 };
  for (const identity of identityRows) {
    if (!PROVIDERS.has(identity.provider))
      throw new RehearsalError("post_insert_verification_failed", 500);
    providers[identity.provider] += 1;
  }
  return {
    users: userRows.length,
    identities: identityRows.length,
    user_uuid_fingerprint: userUuidFingerprint(userRows.map(({ id }) => String(id))),
    identity_fingerprint: identityFingerprint(identityRows),
    provider_distribution: providers,
    status: "ok",
  };
}

export async function importRehearsal(client, validated) {
  const { users, identities } = validated;
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
    await client.query(
      "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))",
      ["auth-migration-rehearsal"],
    );
    const contract = await preflightAuthInsertability(client);
    const counts = await client.query(
      "SELECT (SELECT pg_catalog.count(*)::int FROM auth.users) AS users, (SELECT pg_catalog.count(*)::int FROM auth.identities) AS identities",
    );
    if (counts.rows[0].users !== 0 || counts.rows[0].identities !== 0)
      throw new RehearsalError("destination_not_empty", 409);
    for (const user of users) {
      await client.query(
        `INSERT INTO auth.users (${contract.userColumns.join(", ")}) VALUES (${placeholders(contract.userColumns.length)})`,
        contract.userColumns.map((field) => user[field] ?? null),
      );
    }
    for (const identity of identities) {
      await client.query(
        `INSERT INTO auth.identities (${contract.identityColumns.join(", ")}) VALUES (${placeholders(contract.identityColumns.length)})`,
        contract.identityColumns.map((field) => identity[field] ?? null),
      );
    }
    const duplicateSubjects = await client.query(
      "SELECT pg_catalog.count(*)::int AS count FROM (SELECT provider, provider_id FROM auth.identities GROUP BY provider, provider_id HAVING pg_catalog.count(*) > 1) AS duplicates",
    );
    const orphanIdentities = await client.query(
      "SELECT pg_catalog.count(*)::int AS count FROM auth.identities AS i LEFT JOIN auth.users AS u ON u.id = i.user_id WHERE u.id IS NULL",
    );
    const actualUsers = await client.query("SELECT id::text AS id FROM auth.users ORDER BY id");
    const actualIdentities = await client.query(
      "SELECT user_id::text AS user_id, provider, provider_id FROM auth.identities ORDER BY user_id, provider, provider_id",
    );
    if (
      duplicateSubjects.rows[0].count !== 0 ||
      orphanIdentities.rows[0].count !== 0 ||
      actualUsers.rows.length !== users.length ||
      actualIdentities.rows.length !== identities.length
    ) {
      throw new RehearsalError("post_insert_verification_failed", 500);
    }
    const evidence = evidenceFromRows(actualUsers.rows, actualIdentities.rows);
    const expectedEvidence = evidenceFromRows(
      users.map(({ id }) => ({ id })),
      identities.map(({ user_id, provider, provider_id }) => ({
        user_id,
        provider,
        provider_id,
      })),
    );
    if (
      evidence.user_uuid_fingerprint !== expectedEvidence.user_uuid_fingerprint ||
      evidence.identity_fingerprint !== expectedEvidence.identity_fingerprint ||
      evidence.provider_distribution.email !== expectedEvidence.provider_distribution.email ||
      evidence.provider_distribution.google !== expectedEvidence.provider_distribution.google
    ) {
      throw new RehearsalError("post_insert_verification_failed", 500);
    }
    await client.query("COMMIT");
    return evidence;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The original database error remains authoritative and contains no request payload.
    }
    if (error instanceof RehearsalError) throw error;
    throw new RehearsalError("database_operation_failed", 503);
  }
}
