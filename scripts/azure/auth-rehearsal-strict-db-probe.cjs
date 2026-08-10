"use strict";

const net = require("node:net");
const tls = require("node:tls");
const { pathToFileURL } = require("node:url");

const PROBE_VERSION = "1";
const EXPECTED_DESTINATION = "oztdrjtdglkizlewnulh";
const FORBIDDEN_DESTINATION = "mfbycmbjygcfkrsuepxf";
const BUNDLED_PG_MODULE = "/app/dist/server/_libs/pg.mjs";
const CONNECT_TIMEOUT_MS = 10_000;

const TLS_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_OSSL_X509_CERT_ALREADY_IN_HASH_TABLE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

const DNS_CODES = new Set(["EAI_AGAIN", "ENOTFOUND"]);
const NETWORK_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTDOWN",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
]);

function safeCode(error) {
  const code = typeof error?.code === "string" ? error.code.toUpperCase() : "";
  return /^[A-Z0-9_.-]{1,32}$/.test(code) ? code : "redacted";
}

function classifyConnectionError(error) {
  const code = safeCode(error);
  const message = typeof error?.message === "string" ? error.message.toLowerCase() : "";

  if (
    TLS_CODES.has(code) ||
    /(?:self[- ]signed|unable to verify|unable to get issuer|certificate has expired|hostname.*certificate|certificate.*altname|unknown ca)/u.test(
      message,
    )
  ) {
    return { category: "tls_trust", code };
  }
  if (DNS_CODES.has(code)) return { category: "dns", code };
  if (NETWORK_CODES.has(code)) return { category: "network", code };
  if (/network.*(?:ban|block)|temporarily.*(?:ban|block)/u.test(message)) {
    return { category: "network_ban", code };
  }
  if (/circuit breaker/u.test(message)) return { category: "pooler_circuit_breaker", code };
  if (/tenant or user not found|invalid tenant/u.test(message)) {
    return { category: "pooler_tenant", code };
  }
  if (code.startsWith("28") || /password authentication failed|sasl|scram/u.test(message)) {
    return { category: "authentication", code };
  }
  if (code === "53300" || /max(?:imum)? client connections|too many connections/u.test(message)) {
    return { category: "capacity", code };
  }
  if (code === "57P03" || /cannot connect now|database system is starting up/u.test(message)) {
    return { category: "database_not_ready", code };
  }
  if (code.startsWith("08")) return { category: "postgres_connection", code };
  return { category: "unknown", code };
}

function validateDatabaseAffinity(databaseUrl) {
  if (typeof databaseUrl !== "string" || databaseUrl.length === 0) {
    throw Object.assign(new Error("missing database url"), { code: "CONFIG_MISSING" });
  }

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw Object.assign(new Error("invalid database url"), { code: "CONFIG_INVALID" });
  }

  let username;
  try {
    username = decodeURIComponent(parsed.username);
  } catch {
    throw Object.assign(new Error("invalid database username"), { code: "CONFIG_INVALID" });
  }

  const hostname = parsed.hostname.toLowerCase();
  const normalizedUsername = username.toLowerCase();
  const port = parsed.port || "5432";
  const database = parsed.pathname.replace(/^\//u, "");
  const protocolAllowed = parsed.protocol === "postgres:" || parsed.protocol === "postgresql:";

  if (
    !protocolAllowed ||
    parsed.search ||
    parsed.hash ||
    port !== "5432" ||
    database !== "postgres" ||
    hostname.includes(FORBIDDEN_DESTINATION) ||
    normalizedUsername.includes(FORBIDDEN_DESTINATION)
  ) {
    throw Object.assign(new Error("database affinity rejected"), { code: "AFFINITY_REJECTED" });
  }

  const direct = hostname === `db.${EXPECTED_DESTINATION}.supabase.co` && username === "postgres";
  const sessionPooler =
    hostname.endsWith(".pooler.supabase.com") &&
    hostname !== ".pooler.supabase.com" &&
    username === `postgres.${EXPECTED_DESTINATION}`;

  if (!direct && !sessionPooler) {
    throw Object.assign(new Error("database affinity rejected"), { code: "AFFINITY_REJECTED" });
  }

  return {
    kind: direct ? "direct" : "session_pooler",
    hostname,
    port: Number(port),
  };
}

function looksLikeClient(candidate) {
  return (
    typeof candidate === "function" &&
    candidate.prototype &&
    typeof candidate.prototype.connect === "function" &&
    typeof candidate.prototype.query === "function" &&
    typeof candidate.prototype.end === "function"
  );
}

function resolveClientExport(value, seen = new Set(), depth = 0) {
  if (depth > 4 || value === null || value === undefined) return undefined;
  if (looksLikeClient(value)) return value;
  if ((typeof value !== "object" && typeof value !== "function") || seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  const preferredKeys = ["Client", "default", "pg"];
  for (const key of preferredKeys) {
    let child;
    try {
      child = value[key];
    } catch {
      continue;
    }
    const resolved = resolveClientExport(child, seen, depth + 1);
    if (resolved) return resolved;
  }

  if (depth < 2) {
    for (const key of Object.keys(value).slice(0, 32)) {
      if (preferredKeys.includes(key)) continue;
      let child;
      try {
        child = value[key];
      } catch {
        continue;
      }
      const resolved = resolveClientExport(child, seen, depth + 1);
      if (resolved) return resolved;
    }
  }
  return undefined;
}

function strictTlsPreflight({ hostname, port, ca }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let rawSocket;
    let tlsSocket;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (tlsSocket) tlsSocket.destroy();
      else if (rawSocket) rawSocket.destroy();
      if (error) reject(error);
      else resolve(result);
    };

    rawSocket = net.createConnection({ host: hostname, port });
    rawSocket.setTimeout(CONNECT_TIMEOUT_MS, () => {
      finish(Object.assign(new Error("connect timeout"), { code: "ETIMEDOUT" }));
    });
    rawSocket.once("error", (error) => finish(error));
    rawSocket.once("connect", () => {
      const sslRequest = Buffer.alloc(8);
      sslRequest.writeInt32BE(8, 0);
      sslRequest.writeInt32BE(80877103, 4);
      rawSocket.write(sslRequest);
    });
    rawSocket.once("data", (chunk) => {
      if (!chunk || chunk[0] !== 0x53) {
        finish(Object.assign(new Error("postgres ssl unsupported"), { code: "SSL_UNSUPPORTED" }));
        return;
      }
      rawSocket.removeAllListeners();
      rawSocket.setTimeout(0);
      tlsSocket = tls.connect({
        socket: rawSocket,
        servername: hostname,
        rejectUnauthorized: true,
        ...(ca ? { ca } : {}),
      });
      tlsSocket.setTimeout(CONNECT_TIMEOUT_MS, () => {
        finish(Object.assign(new Error("tls timeout"), { code: "ETIMEDOUT" }));
      });
      tlsSocket.once("error", (error) => finish(error));
      tlsSocket.once("secureConnect", () => {
        finish(null, {
          protocol: tlsSocket.getProtocol() || "unknown",
          authorized: tlsSocket.authorized === true,
        });
      });
    });
  });
}

async function runProbe({
  env = process.env,
  moduleImporter = (specifier) => import(specifier),
  tlsPreflight = strictTlsPreflight,
  output = (line) => console.log(line),
} = {}) {
  output(`PROBE_VERSION=${PROBE_VERSION}`);

  let affinity;
  try {
    affinity = validateDatabaseAffinity(env.AUTH_MIGRATION_REHEARSAL_DATABASE_URL);
  } catch (error) {
    const classified = classifyConnectionError(error);
    output("DB_AFFINITY=invalid");
    output(`CA_CONFIGURED=${env.AUTH_MIGRATION_REHEARSAL_DATABASE_CA ? "yes" : "no"}`);
    output("PG_BUNDLED_MODULE_LOAD=not_attempted");
    output("PG_MODULE_RESOLUTION=not_attempted");
    output("RESULT=failure");
    output("CATEGORY=configuration");
    output(`ERROR_CODE=${safeCode(error)}`);
    output("QUERY_OK=false");
    return { ok: false, category: classified.category, exitCode: 2 };
  }

  const ca = env.AUTH_MIGRATION_REHEARSAL_DATABASE_CA || undefined;
  output(`DB_AFFINITY=${affinity.kind}`);
  output(`CA_CONFIGURED=${ca ? "yes" : "no"}`);

  let moduleNamespace;
  try {
    moduleNamespace = await moduleImporter(pathToFileURL(BUNDLED_PG_MODULE).href);
    output("PG_BUNDLED_MODULE_LOAD=success");
  } catch {
    output("PG_BUNDLED_MODULE_LOAD=failure");
  }

  const Client = resolveClientExport(moduleNamespace);
  if (!Client) {
    output("PG_MODULE_RESOLUTION=unavailable");
    try {
      const tlsResult = await tlsPreflight({ ...affinity, ca });
      output("RESULT=partial_success");
      output("CATEGORY=tls_preflight_success_pg_module_unavailable");
      output("ERROR_CODE=none");
      output(`TLS_PROTOCOL=${tlsResult.protocol}`);
      output(`TLS_AUTHORIZED=${tlsResult.authorized ? "true" : "false"}`);
      output("QUERY_OK=false");
      return { ok: false, category: "tls_preflight_success_pg_module_unavailable", exitCode: 3 };
    } catch (error) {
      const classified = classifyConnectionError(error);
      output("RESULT=failure");
      output(`CATEGORY=${classified.category}`);
      output(`ERROR_CODE=${classified.code}`);
      output("QUERY_OK=false");
      return { ok: false, category: classified.category, exitCode: 4 };
    }
  }

  output("PG_MODULE_RESOLUTION=bundled_module");
  let client;
  try {
    client = new Client({
      connectionString: env.AUTH_MIGRATION_REHEARSAL_DATABASE_URL,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      ssl: {
        rejectUnauthorized: true,
        ...(ca ? { ca } : {}),
      },
    });
    await client.connect();
    const result = await client.query("SELECT 1 AS ok");
    const queryOk =
      Array.isArray(result?.rows) && result.rows.length === 1 && Number(result.rows[0]?.ok) === 1;
    if (!queryOk) {
      throw Object.assign(new Error("unexpected query evidence"), { code: "QUERY_EVIDENCE" });
    }
    const stream = client.connection?.stream;
    output("RESULT=success");
    output("CATEGORY=success");
    output("ERROR_CODE=none");
    if (stream && typeof stream.getProtocol === "function") {
      output(`TLS_PROTOCOL=${stream.getProtocol() || "unknown"}`);
      output(`TLS_AUTHORIZED=${stream.authorized === true ? "true" : "false"}`);
    }
    output("QUERY_OK=true");
    return { ok: true, category: "success", exitCode: 0 };
  } catch (error) {
    const classified = classifyConnectionError(error);
    output("RESULT=failure");
    output(`CATEGORY=${classified.category}`);
    output(`ERROR_CODE=${classified.code}`);
    output("QUERY_OK=false");
    return { ok: false, category: classified.category, exitCode: 5 };
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        output("DATABASE_CLOSE=failure");
      }
    }
  }
}

module.exports = {
  BUNDLED_PG_MODULE,
  CONNECT_TIMEOUT_MS,
  EXPECTED_DESTINATION,
  FORBIDDEN_DESTINATION,
  PROBE_VERSION,
  classifyConnectionError,
  resolveClientExport,
  runProbe,
  safeCode,
  strictTlsPreflight,
  validateDatabaseAffinity,
};
