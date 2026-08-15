# Auth rehearsal strict database connection probe

This operator tool diagnoses the existing disposable Auth rehearsal runtime after the live receiver returned:

```text
HTTP_STATUS: 503
SAFE_RECEIVER_STATUS: database_connect_failed
DATABASE_STATE: 0|0
INGRESS_DISABLED
```

It is deliberately separate from the migration request. It does **not** call `/api/internal/auth-migration/rehearsal`, create or consume a nonce, enable ingress, create a revision, modify a secret, change a database setting, or write an Auth row.

## Two guarded modes

Run the initial diagnostic against the exact currently diagnosed revision with no arguments:

```bash
bash scripts/azure/run-auth-rehearsal-strict-db-probe.sh
```

That mode requires:

```text
revision=ca-kovagpt-auth-rehearsal--0000006
CA state=absent
```

If and only if a separately reviewed remediation later adds the exact Supabase root CA and creates a new ready revision, run the same strict probe by naming both the new revision and the required CA state:

```bash
bash scripts/azure/run-auth-rehearsal-strict-db-probe.sh \
  ca-kovagpt-auth-rehearsal--<new-revision-suffix> \
  present
```

The wrapper rejects baseline revision `0000006` with `present`, any later revision with `absent`, an invalid CA state, and malformed revision names. This prevents accidentally testing a different revision or silently skipping the expected CA-state transition.

## Fixed safety boundary

The wrapper refuses to run unless it proves all of the following immediately before console access:

- Azure subscription `ab732127-11c3-46a7-a1cb-6ee8d86594f4`;
- Azure tenant `18a67414-b56e-4b79-8dc8-435494fcc9be`;
- app `ca-kovagpt-auth-rehearsal`, never `ca-kovagpt-dev`;
- provisioning state `Succeeded` and running state `Running`;
- latest and latest-ready revision equal the explicitly expected revision;
- immutable image digest `sha256:1ed6f0d0f0e7e42d4747391e0bc54309760ea3c68b1612b371d31c80aef4d00b`;
- exactly one template container;
- ingress disabled;
- min/max replicas exactly `1/1`;
- destination `oztdrjtdglkizlewnulh`, never `mfbycmbjygcfkrsuepxf`;
- `AUTH_MIGRATION_REHEARSAL_ENABLED=true`;
- source ID `legacy-auth-rehearsal-source`;
- `AI_GENERATION_ENABLED=false`;
- `KOVA_GENERATION_DISABLED=true`;
- the database URL and bridge secret each have exactly one expected `secretRef` and no literal value;
- CA-absent mode has no `AUTH_MIGRATION_REHEARSAL_DATABASE_CA` environment entry;
- CA-present mode has exactly one `AUTH_MIGRATION_REHEARSAL_DATABASE_CA` entry referencing only `auth-migration-rehearsal-database-ca`;
- CA-present mode retrieves that public CA without printing it and verifies the exact reviewed fingerprint, serial, self-signature, and remaining validity;
- no `NODE_TLS_REJECT_UNAUTHORIZED`, `NODE_OPTIONS`, alternate CA-store, or `PGSSLMODE` override is configured on the app;
- no model-provider credential is configured on the rehearsal app;
- no non-secret environment value references the prohibited real project;
- database URL still passes the receiver's direct-or-Session-Pooler affinity rules;
- disposable destination counts remain exactly `0|0`;
- exactly one replica and one container exist.

The reviewed Supabase root certificate evidence required in CA-present mode is:

```text
SHA-256 fingerprint=807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA
serial=6CBC4CA1DEB63F692D0A2024C67289C2D13D54F6
```

The wrapper hashes the local in-container probe before use and requires this reviewed SHA-256:

```text
b6279417f589848069354af93b49866ab297a89fba8c9410dfb21590499a36ba
```

The wrapper also repeats the immutable-image, latest-ready revision, CA environment state, ingress, and `0|0` checks after the probe. Its count checks keep the database URL out of the `psql` command line, pass credentials only through a minimal child-process environment, force encrypted PostgreSQL transport with `PGSSLMODE=require`, suppress raw client errors, and run `\\conninfo` plus the count query in the same `psql` process and require client-side SSL evidence from `psql` without printing connection metadata. The actual in-container diagnostic remains stricter: it verifies both the certificate chain and hostname.

### Azure exec transport

Azure Container Apps console access is interactive. The Azure CLI places the `--command` value on the WebSocket connection request, and testing against the exact rehearsal replica showed that short commands succeed while larger command payloads can fail during the WebSocket handshake. Directly piping stdin into `az containerapp exec` also fails because the CLI expects a TTY.

To avoid both failure modes, the wrapper keeps the remote startup command tiny (`sh`), launches the Azure CLI through the local `script` utility to provide a pseudo-terminal, and disables remote terminal echo in the initial short remote startup command before any probe bytes are written. The compressed base64 probe is then framed as short 256-character lines inside a Node here-document before reconstruction and execution. This avoids both the Azure WebSocket command-URL limit and the PTY canonical-line truncation that occurs with one oversized input line. The compressed probe is therefore not embedded in the `--command` URL. This transport still performs exactly one `az containerapp exec`, still targets the exact reviewed revision/replica/container, and does not alter the probe source or its strict TLS behavior.

## What runs inside the container

The one-shot Node process:

1. reads the existing database URL and optional CA only from the container environment;
2. validates the same disposable direct or Supavisor Session Pooler affinity rules;
3. imports only `/app/dist/server/_libs/pg.mjs`;
4. resolves the bundled `Client` export without printing module contents;
5. constructs `Client` with `connectionTimeoutMillis: 10_000` and `ssl.rejectUnauthorized: true`;
6. attempts one database connection;
7. runs only `SELECT 1 AS ok` after connecting;
8. closes the client;
9. prints only fixed status fields and a sanitized error-code token.

If the bundled module cannot expose a `Client`, the process performs one PostgreSQL SSLRequest plus strict TLS handshake. That fallback verifies only DNS, TCP, certificate trust, and hostname verification. It does not authenticate or run SQL.

The process never prints the database URI, hostname, username, password, CA PEM, raw exception message, or stack trace.

## Output interpretation

A complete PostgreSQL success ends with:

```text
PG_BUNDLED_MODULE_LOAD=success
PG_MODULE_RESOLUTION=bundled_module
RESULT=success
CATEGORY=success
ERROR_CODE=none
QUERY_OK=true
```

Failure categories are intentionally narrow:

- `tls_trust`: strict certificate or hostname verification failed;
- `dns`: the database hostname could not be resolved;
- `network`: timeout, refusal, reset, or route failure;
- `network_ban`: the safe internal classifier matched a temporary network-block indication;
- `pooler_circuit_breaker`: Supavisor circuit breaker indication;
- `pooler_tenant`: pooler tenant/user routing indication;
- `authentication`: PostgreSQL class `28`, password, SASL, or SCRAM failure;
- `capacity`: `53300` or a safe capacity indication;
- `database_not_ready`: `57P03` or startup/not-ready indication;
- `postgres_connection`: PostgreSQL class `08` connection exception;
- `unknown`: redacted unclassified failure;
- `tls_preflight_success_pg_module_unavailable`: strict TLS succeeded, but the bundled `Client` could not be resolved, so authentication and `SELECT 1` were not tested.

After any result, preserve the output and do not run the probe or authenticated rehearsal again until the category is reviewed.

## Verification

The focused tests cover:

- exact disposable database-affinity acceptance and rejection;
- fixed error classification and code sanitization;
- bundled ESM `Client` resolution;
- strict `pg.Client` options;
- exact read-only query text;
- redaction of raw error messages;
- strict-TLS fallback behavior;
- rejection of invalid revision/CA-state combinations before Azure access;
- one-and-only-one `az containerapp exec` call;
- PTY-backed stdin transport with a short `--command sh` startup command;
- bounded 256-character PTY payload framing so no probe input line exceeds the terminal-safe limit;
- absence of the compressed probe payload from the Azure `--command` argument;
- probe-source SHA pinning;
- secret-reference, CA-state, TLS-override, and model-provider gates;
- exact post-CA certificate fingerprint and serial checks;
- encrypted count checks that do not place the database URL on the `psql` command line;
- absence of ingress enablement, app updates, secret writes, TLS bypasses, and database mutation SQL.

Run:

```bash
node --test tests/unit/auth-rehearsal-strict-db-probe.test.mjs
bash -n scripts/azure/run-auth-rehearsal-strict-db-probe.sh
node --check scripts/azure/auth-rehearsal-strict-db-probe.cjs
```
