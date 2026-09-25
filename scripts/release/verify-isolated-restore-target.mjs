#!/usr/bin/env node

// Read-only M18 guard. Run only against an independently approved isolated target.
// The passwordless URI and private pgpass file are supplied at execution time.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const sourceCatalog = new URL(
  "../../docs/release-reconciliation/managed-schema-recovery-catalog-20260923.json",
  import.meta.url,
);

const inventorySql = `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH application_relations AS (
  SELECT count(*)::int AS n
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname IN ('public', 'kova_private')
    AND c.relkind IN ('r', 'p', 'f', 'S', 'v', 'm')
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_class'::regclass
        AND d.objid = c.oid
        AND d.deptype = 'e'
    )
)
SELECT jsonb_build_object(
  'database', current_database(),
  'serverAddress', inet_server_addr()::text,
  'serverPort', inet_server_port(),
  'serverVersionNum', current_setting('server_version_num')::int,
  'systemIdentifier', (SELECT system_identifier::text FROM pg_control_system()),
  'authUsers', (SELECT count(*)::int FROM auth.users),
  'authIdentities', (SELECT count(*)::int FROM auth.identities),
  'authSessions', (SELECT count(*)::int FROM auth.sessions),
  'storageBuckets', (SELECT count(*)::int FROM storage.buckets),
  'storageObjects', (SELECT count(*)::int FROM storage.objects),
  'applicationRelations', (SELECT n FROM application_relations),
  'extensions', (
    SELECT coalesce(jsonb_agg(
      jsonb_build_object('name', e.extname, 'version', e.extversion, 'schema', ns.nspname)
      ORDER BY e.extname
    ), '[]'::jsonb)
    FROM pg_extension e
    JOIN pg_namespace ns ON ns.oid = e.extnamespace
  )
)::text;
COMMIT;
`;

function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function validateTargetConfig(env) {
  const rawUri = required(env, "APPROVED_ISOLATED_PG17_DATABASE_URL");
  let uri;
  try {
    uri = new URL(rawUri);
  } catch {
    throw new Error("approved target URI is malformed");
  }
  if (!["postgres:", "postgresql:"].includes(uri.protocol)) {
    throw new Error("approved target URI must use PostgreSQL");
  }
  if (!uri.username || uri.password || uri.hash) {
    throw new Error("approved target URI needs a user and must contain no password or fragment");
  }
  const host = uri.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const database = decodeURIComponent(uri.pathname.slice(1));
  const port = Number(uri.port || "5432");
  if (
    !host ||
    !database ||
    database.includes("/") ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error("approved target URI needs a single database, host, and port");
  }
  if (
    rawUri.toLowerCase().includes("mfbycmbjygcfkrsuepxf") ||
    host.endsWith(".pooler.supabase.com") ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0"
  ) {
    throw new Error("production or local tunnel target is forbidden");
  }
  const allowedParams = new Set(["sslmode", "sslrootcert", "connect_timeout"]);
  for (const key of uri.searchParams.keys()) {
    if (!allowedParams.has(key) || uri.searchParams.getAll(key).length !== 1) {
      throw new Error("approved target URI has an unapproved connection parameter");
    }
  }
  if (env.PGPASSWORD) throw new Error("use a private PGPASSFILE, not PGPASSWORD");
  const passfile = required(env, "PGPASSFILE");
  const info = lstatSync(passfile);
  if (!info.isFile() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid()) {
    throw new Error("PGPASSFILE must be an owned regular file with mode 0600 or stricter");
  }
  const expectedHost = required(env, "APPROVED_ISOLATED_HOST").toLowerCase();
  const expectedDatabase = required(env, "APPROVED_ISOLATED_DBNAME");
  const expectedPort = Number(required(env, "APPROVED_ISOLATED_PORT"));
  const expectedIp = required(env, "APPROVED_ISOLATED_SERVER_IP");
  const expectedSystemId = required(env, "APPROVED_ISOLATED_SYSTEM_IDENTIFIER");
  if (host !== expectedHost || database !== expectedDatabase || port !== expectedPort) {
    throw new Error("URI does not match the separately approved target host, database, or port");
  }
  if (!/^\d+$/.test(expectedSystemId) || !isIP(expectedIp)) {
    throw new Error("approved cluster system identifier and server IP are required");
  }
  return { uri: rawUri, host, database, port, expectedIp, expectedSystemId };
}

export function validateObservation(observed, approved, sourceExtensions) {
  if (
    observed.database !== approved.database ||
    observed.serverAddress !== approved.expectedIp ||
    observed.serverPort !== approved.port ||
    observed.systemIdentifier !== approved.expectedSystemId
  ) {
    throw new Error("connected server differs from the approved target fingerprint");
  }
  if (
    !Number.isInteger(observed.serverVersionNum) ||
    observed.serverVersionNum < 170000 ||
    observed.serverVersionNum >= 180000
  ) {
    throw new Error("isolated target must run PostgreSQL 17");
  }
  for (const name of [
    "authUsers",
    "authIdentities",
    "authSessions",
    "storageBuckets",
    "storageObjects",
    "applicationRelations",
  ]) {
    if (observed[name] !== 0) throw new Error(`isolated target is not empty: ${name}`);
  }
  const normalize = (items) =>
    JSON.stringify(
      items
        .map(({ name, version, schema }) => ({ name, version, schema }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  if (
    !Array.isArray(observed.extensions) ||
    normalize(observed.extensions) !== normalize(sourceExtensions)
  ) {
    throw new Error("isolated target extensions differ from the pinned source catalog");
  }
  return observed;
}

function main() {
  const approved = validateTargetConfig(process.env);
  const source = JSON.parse(readFileSync(sourceCatalog, "utf8"));
  const client = spawnSync("psql", ["--version"], { encoding: "utf8", timeout: 5000 });
  if (
    client.error ||
    client.status !== 0 ||
    !/^psql \(PostgreSQL\) 17\./.test(client.stdout.trim())
  ) {
    throw new Error("PostgreSQL 17 psql client is required");
  }
  const childEnv = { ...process.env, PGHOSTADDR: approved.expectedIp, PGCONNECT_TIMEOUT: "5" };
  for (const name of ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGSERVICE", "PGOPTIONS"]) {
    delete childEnv[name];
  }
  const result = spawnSync(
    "psql",
    [
      "--no-psqlrc",
      "--no-password",
      "--quiet",
      "--tuples-only",
      "--no-align",
      "--set",
      "ON_ERROR_STOP=1",
      "--dbname",
      approved.uri,
      "--file",
      "-",
    ],
    { input: inventorySql, encoding: "utf8", env: childEnv, timeout: 15000 },
  );
  if (result.error || result.status !== 0) {
    throw new Error("read-only psql target preflight failed; inspect private operator logs");
  }
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  if (lines.length !== 1) throw new Error("unexpected preflight output shape");
  let observed;
  try {
    observed = JSON.parse(lines[0]);
  } catch {
    throw new Error("preflight did not return JSON");
  }
  validateObservation(observed, approved, source.extensions);
  const receipt = {
    kind: "kova-isolated-restore-target-preflight",
    checkedAt: new Date().toISOString(),
    requestedHost: approved.host,
    ...observed,
  };
  const output = required(process.env, "APPROVED_ISOLATED_PREFLIGHT_OUTPUT");
  const bytes = JSON.stringify(receipt, null, 2) + "\n";
  writeFileSync(output, bytes, { mode: 0o600, flag: "wx" });
  console.log(
    `Isolated target preflight passed; private receipt SHA-256 ${createHash("sha256").update(bytes).digest("hex")}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(`Isolated target preflight stopped: ${error.message}`);
    process.exitCode = 1;
  }
}
