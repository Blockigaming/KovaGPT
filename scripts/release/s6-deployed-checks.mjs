import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetch, EnvHttpProxyAgent } from "undici";
import { ownedPrivateFileLink } from "../../src/lib/kova-auth-private-download.mjs";
import { requiredDeployedChecks } from "./kova-auth-cutover-gate.mjs";

export const PROJECT = "oztdrjtdglkizlewnulh";
export const ORIGIN =
  "https://ca-kovagpt-auth-rehearsal.whitepebble-42e8ad60.eastus.azurecontainerapps.io";
export const SUPABASE = `https://${PROJECT}.supabase.co`;
export const TARGET =
  "/subscriptions/ab732127-11c3-46a7-a1cb-6ee8d86594f4/resourceGroups/rg-kovagpt-dev/providers/Microsoft.App/containerApps/ca-kovagpt-auth-rehearsal";
const literal = (x) => "'" + String(x).replaceAll("'", "''") + "'";
const password = () => randomBytes(30).toString("base64url") + "!S6";
const fixtureEmail =
  /^s6-[a-f0-9]{12}-(signup|legacy|other|realtime|rollback-hosted|rollback-owned)@example\.invalid$/;
export function totp(secret, at = Date.now()) {
  let bits = "";
  for (const c of secret.toUpperCase().replace(/=+$/, "")) {
    const n = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(c);
    assert.ok(n >= 0);
    bits += n.toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g).map((x) => parseInt(x, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}
export function validateWatchdog(state, now = Date.now()) {
  assert.equal(state.target, TARGET);
  assert.equal(state.status, "armed");
  assert.equal(state.selfTest, true);
  assert.ok(state.pid > 0 && state.pid !== state.launcherPid);
  assert.ok(now - Date.parse(state.heartbeatAt) < 8000, "watchdog heartbeat stale");
  assert.ok(state.deadlineEpoch * 1000 - now > 180000, "insufficient remaining run envelope");
  assert.ok(state.deadlineEpoch * 1000 - now <= 1200000, "run envelope exceeds authorization");
  assert.ok(Date.parse(state.tokenExpires) > state.deadlineEpoch * 1000 + 120000);
  return state.deadlineEpoch * 1000;
}
export class IsolatedDatabase {
  constructor(url, ca) {
    const parsed = new URL(url);
    const user = decodeURIComponent(parsed.username);
    assert.ok(["postgresql:", "postgres:"].includes(parsed.protocol));
    assert.ok(
      parsed.hostname === `db.${PROJECT}.supabase.co` ||
        (/^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(parsed.hostname) &&
          user.endsWith("." + PROJECT)),
      "wrong database",
    );
    this.directory = mkdtempSync(join(tmpdir(), "kova-s6-ca-"));
    const cert = join(this.directory, "ca.pem");
    writeFileSync(cert, ca, { mode: 0o600 });
    this.env = {
      ...process.env,
      PGHOST: parsed.hostname,
      PGPORT: parsed.port || "5432",
      PGUSER: user,
      PGPASSWORD: decodeURIComponent(parsed.password),
      PGDATABASE: parsed.pathname.slice(1),
      PGSSLMODE: "verify-full",
      PGSSLROOTCERT: cert,
      PGCONNECT_TIMEOUT: "10",
      PGOPTIONS: "-c statement_timeout=15000 -c lock_timeout=5000",
    };
  }
  query(sql) {
    try {
      return execFileSync("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"], {
        input: sql,
        encoding: "utf8",
        env: this.env,
        timeout: 20000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch {
      throw new Error("isolated_database_operation_failed");
    }
  }
  json(sql) {
    const raw = this.query(sql);
    return raw ? JSON.parse(raw) : null;
  }
  close() {
    this.env.PGPASSWORD = "";
    rmSync(this.directory, { recursive: true, force: true });
  }
}
export class S6Run {
  constructor({ database, serviceKey, apiKey, deadline, sourceSha, reportFile, request = fetch }) {
    assert.match(sourceSha, /^[a-f0-9]{40}$/);
    this.db = database;
    this.serviceKey = serviceKey;
    this.apiKey = apiKey;
    this.deadline = deadline;
    this.liveDeadline = deadline;
    this.sourceSha = sourceSha;
    this.reportFile = reportFile;
    this.request = request;
    this.dispatcher = new EnvHttpProxyAgent();
    this.runId = randomBytes(6).toString("hex");
    this.fixtures = [];
    this.objects = [];
    this.projects = [];
    this.records = [];
    this.sockets = [];
    this.cleanupComplete = false;
  }
  budget() {
    assert.ok(Date.now() < this.deadline - 110000, "cleanup and stop reserve reached");
  }
  async http(
    base,
    path,
    { method = "GET", body, headers = {}, cookie, principal, form, raw } = {},
  ) {
    this.budget();
    assert.ok([ORIGIN, SUPABASE].includes(base));
    assert.ok(path.startsWith("/") && !path.startsWith("//"));
    const h = { Accept: "application/json", ...headers };
    if (base === ORIGIN) {
      h["Sec-Fetch-Site"] = "same-origin";
      if (method !== "GET") h.Origin = ORIGIN;
    }
    if (cookie) h.Cookie = cookie;
    if (principal) {
      h["X-Kova-Owner"] = principal.accountId;
      h["X-Kova-Session"] = principal.sessionId;
    }
    if (form) h["Content-Type"] = "application/x-www-form-urlencoded";
    else if (body !== undefined) h["Content-Type"] = "application/json";
    const response = await this.request(base + path, {
      method,
      headers: h,
      body:
        raw ??
        (form ? new URLSearchParams(body) : body === undefined ? undefined : JSON.stringify(body)),
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
      dispatcher: this.dispatcher,
    });
    this.lastHttpStatus = response.status;
    const bytes = Buffer.from(await response.arrayBuffer());
    const text = bytes.toString("utf8");
    let data;
    try {
      data = JSON.parse(text);
    } catch {}
    return {
      status: response.status,
      headers: response.headers,
      data,
      text,
      bytes,
      cookie: response.headers
        .getSetCookie()
        .find((x) => x.startsWith("__Host-kova_session="))
        ?.split(";")[0],
    };
  }
  service(path, opts = {}) {
    return this.http(SUPABASE, path, {
      ...opts,
      headers: {
        apikey: this.serviceKey,
        Authorization: `Bearer ${this.serviceKey}`,
        ...opts.headers,
      },
    });
  }
  bearer(path, token, opts = {}) {
    return this.http(SUPABASE, path, {
      ...opts,
      headers: { apikey: this.apiKey, Authorization: `Bearer ${token}`, ...opts.headers },
    });
  }
  app(path, opts = {}) {
    return this.http(ORIGIN, path, opts);
  }
  note(check, assertions) {
    this.records.push({
      check,
      status: "PASS",
      kind: "DEPLOYED",
      at: new Date().toISOString(),
      sourceSha: this.sourceSha,
      assertions,
    });
    this.save();
  }
  save() {
    if (this.reportFile)
      writeFileSync(
        this.reportFile,
        JSON.stringify(
          {
            runId: this.runId,
            harnessSha: typeof S6_HARNESS_SHA === "undefined" ? null : S6_HARNESS_SHA,
            sourceSha: this.sourceSha,
            target: TARGET,
            deadline: new Date(this.liveDeadline).toISOString(),
            records: this.records,
            cleanupComplete: this.cleanupComplete,
            cleanupReadback: this.cleanupReadback ?? null,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
  }
  async check(name, fn) {
    this.stage = name;
    this.lastHttpStatus = undefined;
    this.failureDiagnostics = undefined;
    try {
      await fn();
    } catch (error) {
      this.records.push({
        check: name,
        status: "FAIL",
        kind: "DEPLOYED",
        at: new Date().toISOString(),
        errorType: error.name,
        stage: error.s6Stage ?? this.stage,
        assertionId: error.s6Stage ?? this.stage,
        diagnostics: Object.fromEntries(
          Object.entries(this.failureDiagnostics ?? {}).filter(
            ([key, value]) =>
              [
                "messages",
                "denied",
                "closed",
                "subscribed",
                "socketErrors",
                "channelErrors",
                "timedOut",
                "socketOpen",
              ].includes(key) &&
              Number.isSafeInteger(value) &&
              value >= 0,
          ),
        ),
        ...(Number.isInteger(this.lastHttpStatus) ? { httpStatus: this.lastHttpStatus } : {}),
        // No response bodies, arbitrary messages, tokens, SQL or assertion strings.
        ...(typeof error.actual === "number" || typeof error.actual === "boolean"
          ? { actual: error.actual }
          : {}),
        ...(typeof error.expected === "number" || typeof error.expected === "boolean"
          ? { expected: error.expected }
          : {}),
        sourceLocations: [
          ...String(error.stack ?? "").matchAll(
            /(?:[a-z0-9_-]*s6[a-z0-9_-]*|runner)\.(?:mjs|cjs):\d+:\d+/g,
          ),
        ].map((m) => m[0]),
      });
      this.save();
    }
  }
  fixture(kind) {
    const f = { email: `s6-${this.runId}-${kind}@example.invalid`, password: password() };
    assert.match(f.email, fixtureEmail);
    this.fixtures.push(f);
    return f;
  }
  prepareOwner(expectedEmail) {
    assert.match(expectedEmail, /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    assert.equal(expectedEmail, expectedEmail.toLowerCase());
    const counts = this.db.json(
      `select json_build_object('existingAccounts',(select count(*) from kova_private.auth_accounts where primary_email=${literal(expectedEmail)}),'existingHostedUsers',(select count(*) from auth.users where lower(email)=${literal(expectedEmail)}))`,
    );
    assert.deepEqual(
      counts,
      { existingAccounts: 0, existingHostedUsers: 0 },
      "owner fixture must be entirely new in staging",
    );
    const capturedAt = new Date().toISOString();
    const f = { email: expectedEmail, disposableGoogle: true, createdAfter: capturedAt };
    this.ownerFixture = f;
    this.fixtures.push(f);
    return {
      origin: ORIGIN,
      runId: this.runId,
      expectedEmail,
      deadline: this.deadline - 300000,
      sourceSha: this.sourceSha,
      capturedAt,
      ...counts,
      authorizedDisposableGoogleIdentity: true,
    };
  }
  async session(f) {
    const r = await this.app("/api/auth/session", { cookie: f.cookie });
    assert.equal(r.status, 200);
    f.principal = r.data.session;
    return f.principal;
  }
  async token(f) {
    const r = await this.app("/api/auth/token", { cookie: f.cookie, principal: f.principal });
    assert.equal(r.status, 200);
    return r.data.accessToken;
  }
  async login(f) {
    const r = await this.app("/api/auth/login", {
      method: "POST",
      body: { email: f.email, password: f.password },
    });
    assert.equal(r.status, 200);
    assert.ok(r.cookie);
    f.cookie = r.cookie;
    f.principal = r.data.session;
    return f;
  }
  async signup(kind = "signup", preparedOwner) {
    if (preparedOwner)
      assert.ok(preparedOwner === this.ownerFixture && preparedOwner.disposableGoogle);
    const f = preparedOwner ?? this.fixture(kind);
    f.password ??= password();
    const r = await this.app("/api/auth/signup", {
      method: "POST",
      body: { email: f.email, password: f.password, displayName: "Disposable S6 fixture" },
    });
    assert.equal(r.status, 202);
    const queued = this.db.json(
      `select row_to_json(t) from (select message from pgmq.q_auth_emails where message->>'to'=${literal(f.email)} and message->>'label'='kova-auth-verification' order by msg_id desc limit 1) t`,
    );
    assert.ok(queued?.message?.text, "public signup queue item missing");
    const link = queued.message.text.match(
      /https:\/\/[^\s]+\/api\/auth\/verify\?token=[A-Za-z0-9_-]+/,
    )?.[0];
    assert.ok(link);
    const url = new URL(link);
    assert.equal(url.origin, ORIGIN);
    const before = await this.app(url.pathname + url.search);
    assert.equal(before.status, 200);
    const verified = await this.app("/api/auth/verify", {
      method: "POST",
      body: { token: url.searchParams.get("token") },
      form: true,
    });
    assert.equal(verified.status, 303);
    assert.match(verified.headers.get("location"), /[?&]verified=1/);
    assert.equal(verified.cookie, undefined);
    const replay = await this.app("/api/auth/verify", {
      method: "POST",
      body: { token: url.searchParams.get("token") },
      form: true,
    });
    assert.match(replay.headers.get("location"), /invalid_verification/);
    await this.login(f);
    assert.equal(f.principal.email, f.email);
    assert.equal(f.principal.emailVerified, true);
    return f;
  }
  async bootstrapOwner() {
    // An owned password provides the last-key removal fallback. Its random value
    // remains solely in the coordinator, never in the invitation or browser kit.
    const f = await this.signup("owner", this.ownerFixture);
    const loggedOut = await this.app("/api/auth/logout", {
      method: "POST",
      body: {},
      cookie: f.cookie,
      principal: f.principal,
    });
    assert.equal(loggedOut.status, 204);
    f.cookie = undefined;
    return f.principal.accountId;
  }
  async signupCheck() {
    this.signupOwner = await this.signup();
    this.note("public_login_and_signup", [
      "same public identity queued, verified and logged in",
      "verification GET non-consuming",
      "POST replay denied",
      "no login cookie issued by verification",
    ]);
  }
  async legacyCheck() {
    const f = this.fixture("legacy");
    this.stage = "legacy_hosted_create";
    const created = await this.service("/auth/v1/admin/users", {
      method: "POST",
      body: { email: f.email, password: f.password, email_confirm: true },
    });
    assert.ok([200, 201].includes(created.status));
    f.id = created.data.user?.id ?? created.data.id;
    assert.match(f.id, /^[a-f0-9-]{36}$/i);
    this.stage = "legacy_hosted_login";
    const signed = await this.bearer("/auth/v1/token?grant_type=password", this.apiKey, {
      method: "POST",
      body: { email: f.email, password: f.password },
    });
    assert.equal(signed.status, 200);
    const aal1 = signed.data.access_token;
    this.stage = "legacy_hosted_enroll";
    const enrolled = await this.bearer("/auth/v1/factors", aal1, {
      method: "POST",
      body: { factor_type: "totp", friendly_name: "Disposable S6 hosted factor" },
    });
    assert.equal(enrolled.status, 200);
    assert.ok(enrolled.data.totp.secret);
    this.stage = "legacy_hosted_challenge";
    const challenge = await this.bearer(`/auth/v1/factors/${enrolled.data.id}/challenge`, aal1, {
      method: "POST",
      body: {},
    });
    assert.equal(challenge.status, 200);
    this.stage = "legacy_hosted_verify";
    const verified = await this.bearer(`/auth/v1/factors/${enrolled.data.id}/verify`, aal1, {
      method: "POST",
      body: { challenge_id: challenge.data.id, code: totp(enrolled.data.totp.secret) },
    });
    assert.equal(verified.status, 200);
    f.hostedBearer = verified.data.access_token;
    this.stage = "legacy_fixture_mapping";
    // Model the pre-existing adopted legacy population. The admin-created user
    // is new to this run; no real identity or active owned credential is changed.
    assert.match(f.email, fixtureEmail);
    this.db
      .query(`insert into kova_private.auth_accounts(id,legacy_supabase_user_id,primary_email,email_verified_at)
      select id,id,lower(email),email_confirmed_at from auth.users
      where id=${literal(f.id)}::uuid and email=${literal(f.email)} and email_confirmed_at is not null
      and deleted_at is null and (banned_until is null or banned_until<=now())`);
    const h = { Authorization: `Bearer ${f.hostedBearer}`, "X-Kova-Owner": f.id };
    this.stage = "legacy_aal1_denied";
    const denied = await this.app("/api/auth/mfa/enroll", {
      method: "POST",
      headers: { ...h, Authorization: `Bearer ${aal1}` },
      body: { legacyMigration: true, newPassword: f.password },
    });
    assert.equal(denied.status, 403);
    this.stage = "legacy_owned_enroll";
    const next = await this.app("/api/auth/mfa/enroll", {
      method: "POST",
      headers: h,
      body: {
        legacyMigration: true,
        newPassword: f.password,
        friendlyName: "Disposable S6 owned factor",
      },
    });
    assert.equal(next.status, 200);
    f.totp = next.data.secret;
    this.stage = "legacy_owned_activate";
    const activate = await this.app("/api/auth/mfa/verify", {
      method: "POST",
      headers: h,
      body: { legacyMigration: true, factorId: next.data.factorId, code: totp(f.totp) },
    });
    assert.equal(activate.status, 200);
    assert.equal(activate.data.migrated, true);
    f.cookie = activate.cookie;
    f.principal = activate.data.session;
    assert.equal(f.principal.accountId, f.id);
    assert.equal(f.principal.assuranceLevel, "aal2");
    const status = this.db.json(
      `select json_build_object('retired',exists(select 1 from kova_private.auth_legacy_retirements where account_id=${literal(f.id)}::uuid),'hostedSessions',(select count(*) from auth.sessions where user_id=${literal(f.id)}::uuid),'ownedFactor',(select count(*) from kova_private.auth_mfa_factors where account_id=${literal(f.id)}::uuid and state='active' and disabled_at is null))`,
    );
    assert.equal(status.retired, true);
    assert.equal(Number(status.hostedSessions), 0);
    assert.ok(status.ownedFactor > 0);
    this.legacy = f;
    this.note("legacy_mfa_bridge", [
      "real hosted password and verified TOTP AAL2",
      "AAL1 denied",
      "owned enrollment and activation on same identity",
      "hosted sessions retired",
    ]);
  }
  async hostedCheck() {
    const f = this.legacy;
    assert.ok(f?.hostedBearer, "legacy_mfa_bridge prerequisite missing");
    const owned = await this.token(f);
    assert.equal(
      (await this.bearer("/rest/v1/user_preferences?select=user_id", owned)).status,
      200,
    );
    assert.equal(
      (await this.bearer("/rest/v1/user_preferences?select=user_id", f.hostedBearer)).status,
      401,
    );
    const bare = await this.app("/.mcp/invoke-tool/list_projects", {
      method: "POST",
      headers: { Authorization: `Bearer ${f.hostedBearer}` },
      body: { limit: 1 },
    });
    assert.equal(bare.data?.isError, true);
    const oldCookie = f.cookie;
    const logout = await this.app("/api/auth/logout", {
      method: "POST",
      body: {},
      cookie: f.cookie,
      principal: f.principal,
    });
    assert.equal(logout.status, 204);
    const fallback = await this.app("/.mcp/invoke-tool/list_projects", {
      method: "POST",
      cookie: oldCookie,
      headers: { Authorization: `Bearer ${f.hostedBearer}` },
      body: { limit: 1 },
    });
    assert.equal(fallback.data?.isError, true);
    this.retiredEvidence = { hosted: f.hostedBearer, cookie: oldCookie, owned };
    this.note("hosted_bearer_denied_after_retirement", [
      "valid owned bearer accepted",
      "real unmarked hosted bearer denied after migration",
      "MCP denies retired bearer",
      "revoked Kova cookie does not fall back",
    ]);
  }
  async prepareRollbackFixture() {
    // Fresh credentials are test inputs for rollback, not reruns of preserved gates.
    const f = this.fixture("rollback-hosted");
    this.stage = "rollback_fixture_hosted_create";
    const created = await this.service("/auth/v1/admin/users", {
      method: "POST",
      body: { email: f.email, password: f.password, email_confirm: true },
    });
    assert.ok([200, 201].includes(created.status));
    f.id = created.data.user?.id ?? created.data.id;
    assert.match(f.id, /^[a-f0-9-]{36}$/i);
    const signed = await this.bearer("/auth/v1/token?grant_type=password", this.apiKey, {
      method: "POST",
      body: { email: f.email, password: f.password },
    });
    assert.equal(signed.status, 200);
    assert.equal(typeof signed.data.access_token, "string");
    this.db.query(`select kova_private.retire_legacy_auth(id,now()) from auth.users
      where id=${literal(f.id)}::uuid and email=${literal(f.email)} and deleted_at is null`);
    const ownedFixture = await this.signup("rollback-owned");
    const owned = await this.token(ownedFixture);
    const cookie = ownedFixture.cookie;
    assert.equal(
      (
        await this.app("/api/auth/logout", {
          method: "POST",
          body: {},
          cookie,
          principal: ownedFixture.principal,
        })
      ).status,
      204,
    );
    this.retiredEvidence = { hosted: signed.data.access_token, cookie, owned };
  }
  storagePreflight() {
    this.stage = "storage_fixture_preflight";
    const state = this.db.json(`select json_build_object(
      'bucket',exists(select 1 from storage.buckets where id='project-files' and public=false and file_size_limit=10485760 and 'image/png'=any(allowed_mime_types)),
      'columns',(select count(*) from information_schema.columns where table_schema='public' and table_name='project_files' and column_name in ('status','content_sha256')))`);
    assert.equal(state.bucket, true, "storage_private_project_bucket");
    assert.equal(state.columns, 2, "storage_private_project_columns");
  }
  async storageCheck() {
    this.storagePreflight();
    const f = this.signupOwner ?? (this.signupOwner = await this.signup());
    const other = await this.signup("other");
    const id = randomUUID(),
      path = `${f.principal.accountId}/${this.runId}/fixture.png`;
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2XcAAAAASUVORK5CYII=",
      "base64",
    );
    this.stage = "storage_evidence_upload";
    const upload = await this.service("/storage/v1/object/agent-evidence/" + path, {
      method: "POST",
      raw: png,
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
    assert.equal(upload.status, 200);
    this.objects.push(path);
    this.stage = "storage_project_fixture";
    // The agent runtime deliberately rejects new jobs. Use a supported private
    // project file for the byte proxy while retaining agent-evidence JWT/sign
    // probes below, including the original cache-boundary regression bucket.
    this.projects.push({ id, owner: f.principal.accountId });
    this.db.query(`insert into public.projects(id,owner_id,name)
      values(${literal(id)}::uuid,${literal(f.principal.accountId)}::uuid,${literal("S6 " + this.runId)})`);
    const projectPath = `${id}/${this.runId}/fixture.png`;
    const projectUpload = await this.service("/storage/v1/object/project-files/" + projectPath, {
      method: "POST",
      raw: png,
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
    assert.equal(projectUpload.status, 200);
    this.objects.push({ bucket: "project-files", path: projectPath, project: id });
    const row = this.db.json(`with i as (insert into public.project_files
      (project_id,name,storage_path,mime_type,size_bytes,kind,status,uploaded_by)
      values(${literal(id)}::uuid,'fixture.png',${literal(projectPath)},'image/png',${png.length},'image','ready',${literal(f.principal.accountId)}::uuid)
      returning id,project_id,name,storage_path,mime_type,size_bytes,kind,status,content_sha256) select row_to_json(i) from i`);
    const link = await ownedPrivateFileLink("project", f.principal.accountId, row),
      jwt = await this.token(f);
    this.stage = "storage_proxy_owner";
    const good = await this.app(link, { cookie: f.cookie });
    assert.equal(good.status, 200);
    assert.deepEqual(good.bytes, png);
    assert.match(good.headers.get("cache-control"), /no-store/);
    assert.ok([401, 403, 409].includes((await this.app(link, { cookie: other.cookie })).status));
    this.stage = "storage_direct_bytes_denied";
    for (let n = 0; n < 2; n++)
      assert.ok(
        [400, 401, 403, 404].includes(
          (await this.bearer("/storage/v1/object/authenticated/agent-evidence/" + path, jwt))
            .status,
        ),
        "direct byte cache must not warm",
      );
    this.stage = "storage_signed_capability";
    const signed = await this.bearer("/storage/v1/object/sign/agent-evidence/" + path, jwt, {
      method: "POST",
      body: { expiresIn: 20 },
    });
    assert.equal(signed.status, 200);
    const signedPath = "/storage/v1" + signed.data.signedURL;
    assert.equal((await this.http(SUPABASE, signedPath)).status, 200);
    const old = f.cookie;
    assert.equal(
      (
        await this.app("/api/auth/logout", {
          method: "POST",
          body: {},
          cookie: old,
          principal: f.principal,
        })
      ).status,
      204,
    );
    assert.equal((await this.app(link, { cookie: old })).status, 401);
    assert.ok(
      [400, 401, 403, 404].includes(
        (
          await this.bearer("/storage/v1/object/sign/agent-evidence/" + path, jwt, {
            method: "POST",
            body: { expiresIn: 20 },
          })
        ).status,
      ),
    );
    await new Promise((r) => setTimeout(r, 22000));
    assert.ok([400, 401, 403, 404].includes((await this.http(SUPABASE, signedPath)).status));
    assert.equal(
      (await this.service("/storage/v1/object/authenticated/agent-evidence/" + path)).status,
      200,
    );
    this.note("storage_revocation_and_url_lifetime", [
      "authenticated proxy reads valid owner bytes without cache",
      "cross-owner denied",
      "direct JWT byte path denied before cache warming",
      "revoked cookie and JWT denied",
      "20-second signed capability expires",
      "service-internal read preserved",
    ]);
  }
  async rollbackCheck(transition) {
    assert.ok(
      this.retiredEvidence && this.signupOwner,
      "rollback requires retained revoked credentials and synthetic owner",
    );
    const testAuthority = async (expectedSource) => {
      this.stage = "rollback_version_" + expectedSource.slice(0, 7);
      const end = Math.min(Date.now() + 60000, this.deadline - 150000);
      let matched = false;
      while (Date.now() < end) {
        const r = await this.app("/api/version");
        if (r.status === 200 && r.data.sha === expectedSource) {
          matched = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      assert.equal(matched, true, "rollback image source not serving");
      this.stage = "rollback_owned_login_" + expectedSource.slice(0, 7);
      await this.login(this.signupOwner);
      const valid = await this.token(this.signupOwner);
      assert.equal(
        (await this.bearer("/rest/v1/user_preferences?select=user_id", valid)).status,
        200,
      );
      for (const [kind, token] of Object.entries({
        hosted: this.retiredEvidence.hosted,
        owned: this.retiredEvidence.owned,
      })) {
        this.stage = "rollback_revoked_" + kind + "_" + expectedSource.slice(0, 7);
        assert.equal(
          (await this.bearer("/rest/v1/user_preferences?select=user_id", token)).status,
          401,
        );
      }
      this.stage = "rollback_mcp_no_fallback_" + expectedSource.slice(0, 7);
      const denied = await this.app("/.mcp/invoke-tool/list_projects", {
        method: "POST",
        body: { limit: 1 },
        cookie: this.retiredEvidence.cookie,
        headers: { Authorization: `Bearer ${this.retiredEvidence.hosted}` },
      });
      assert.equal(denied.data?.isError, true);
    };
    await testAuthority(this.sourceSha);
    try {
      const kova = await transition("switch-kova");
      assert.equal(kova.mode, "kova");
      assert.equal(kova.compiledMode, "kova");
      await testAuthority(this.sourceSha);
      // A real, otherwise valid hosted credential from before retirement still
      // cannot select legacy authority in pure Kova mode.
      const noFallback = await this.app("/api/auth/session", {
        headers: { Authorization: `Bearer ${this.retiredEvidence.hosted}` },
      });
      assert.equal(noFallback.status, 200);
      assert.equal(noFallback.data.session, null);
    } catch (error) {
      error.s6Stage = this.stage;
      throw error;
    } finally {
      const dual = await transition("restore");
      assert.equal(dual.mode, "dual");
      assert.equal(dual.compiledMode, "dual");
      this.rollbackRestored = true;
      await testAuthority("c92fdbfea58a0917f34c25264d7b8b40a78a47fb");
    }
    this.note("rollback_rehearsal", [
      "prepared dual to matching compiled kova to original pinned dual",
      "valid owned authority succeeds in each mode",
      "revoked owned and retired hosted bearers stay denied in each mode",
      "revoked cookie never restores hosted fallback",
      "forward-only database guards retained",
    ]);
  }
  async cleanup() {
    // Run even after a failed assertion, before the watchdog's stop margin.
    const old = this.deadline;
    this.deadline = Math.max(old, Date.now() + 125000);
    const errors = [];
    for (const object of this.objects) {
      const { bucket, path, project } =
        typeof object === "string" ? { bucket: "agent-evidence", path: object } : object;
      try {
        assert.ok(
          bucket === "agent-evidence"
            ? this.fixtures.some((f) => path.startsWith((f.principal?.accountId ?? f.id) + "/"))
            : bucket === "project-files" &&
                this.projects.some((p) => p.id === project && path.startsWith(p.id + "/")),
        );
        const r = await this.service("/storage/v1/object/" + bucket, {
          method: "DELETE",
          body: { prefixes: [path] },
        });
        assert.equal(r.status, 200);
      } catch {
        errors.push("object_cleanup");
      }
    }
    for (const project of this.projects) {
      try {
        assert.ok(this.fixtures.some((f) => f.principal?.accountId === project.owner));
        this.db.query(`begin;
          do $cleanup$ begin
          if to_regclass('public.project_storage_source_provenance') is not null then
          delete from public.project_storage_source_provenance
          where project_id=${literal(project.id)}::uuid and owner_id=${literal(project.owner)}::uuid
          and storage_path=${literal(project.id + "/" + this.runId + "/fixture.png")};
          end if;
          end $cleanup$;
          delete from public.projects where id=${literal(project.id)}::uuid
          and owner_id=${literal(project.owner)}::uuid and name=${literal("S6 " + this.runId)};
          commit;`);
      } catch {
        errors.push("project_cleanup");
      }
    }
    const emails = this.fixtures.map((f) => {
      if (f.disposableGoogle) {
        assert.equal(f, this.ownerFixture);
        assert.ok(f.createdAfter);
        const unsafe = this.db.json(
          `select json_build_object('n',count(*)) from kova_private.auth_accounts where primary_email=${literal(f.email)} and created_at<${literal(f.createdAfter)}::timestamptz`,
        );
        assert.equal(unsafe.n, 0, "refusing cleanup of a pre-existing Google identity");
      } else assert.match(f.email, fixtureEmail);
      return literal(f.email);
    });
    if (emails.length)
      try {
        const list = emails.join(",");
        this.db.query(`begin;
        update kova_private.auth_accounts set deleted_at=coalesce(deleted_at,now()),updated_at=now() where primary_email in (${list});
        update kova_private.auth_sessions set revoked_at=coalesce(revoked_at,now()) where account_id in (select id from kova_private.auth_accounts where primary_email in (${list}));
        update kova_private.auth_passkeys set disabled_at=coalesce(disabled_at,now()) where account_id in (select id from kova_private.auth_accounts where primary_email in (${list}));
        update kova_private.auth_mfa_factors set state='disabled',disabled_at=coalesce(disabled_at,now()),updated_at=now() where account_id in (select id from kova_private.auth_accounts where primary_email in (${list}));
        update kova_private.auth_mfa_recovery_codes set consumed_at=coalesce(consumed_at,now()) where account_id in (select id from kova_private.auth_accounts where primary_email in (${list}));
        update kova_private.auth_oauth_states set consumed_at=coalesce(consumed_at,now()) where return_to=${literal("/?s6_owner_return=1&s6_run=" + this.runId)};
        update kova_private.auth_email_verifications set consumed_at=coalesce(consumed_at,now()) where account_id in (select id from kova_private.auth_accounts where primary_email in (${list}));
        update kova_private.auth_password_recoveries set consumed_at=coalesce(consumed_at,now()) where account_id in (select id from kova_private.auth_accounts where primary_email in (${list}));
        update kova_private.auth_mfa_login_challenges set consumed_at=coalesce(consumed_at,now()) where account_id in (select id from kova_private.auth_accounts where primary_email in (${list}));
        update kova_private.auth_passkey_challenges set consumed_at=coalesce(consumed_at,now()) where account_id in (select id from kova_private.auth_accounts where primary_email in (${list}));
        update kova_private.auth_session_handoffs set consumed_at=coalesce(consumed_at,now()) where account_id in (select id from kova_private.auth_accounts where primary_email in (${list}));
        select kova_private.retire_legacy_auth(id,now()) from auth.users where email in (${list}) or id in (select id from kova_private.auth_accounts where primary_email in (${list}));
        update auth.users set banned_until='infinity',updated_at=now() where email in (${list}) or id in (select id from kova_private.auth_accounts where primary_email in (${list}));
        delete from public.agent_jobs where owner_id in (select id from kova_private.auth_accounts where primary_email in (${list})) and input='{}'::jsonb and status='cancelled';
        delete from pgmq.q_auth_emails where message->>'to' in (${list});
        commit;`);
        const remaining = this.db.json(
          `select json_build_object('sessions',(select count(*) from kova_private.auth_sessions s join kova_private.auth_accounts a on a.id=s.account_id where a.primary_email in (${list}) and s.revoked_at is null),'activeAccounts',(select count(*) from kova_private.auth_accounts where primary_email in (${list}) and deleted_at is null),'queued',(select count(*) from pgmq.q_auth_emails where message->>'to' in (${list})))`,
        );
        assert.deepEqual(remaining, { sessions: 0, activeAccounts: 0, queued: 0 });
        this.cleanupReadback = remaining;
      } catch {
        errors.push("database_cleanup");
      }
    this.deadline = old;
    this.cleanupComplete = errors.length === 0;
    this.save();
    assert.equal(errors.length, 0, "synthetic cleanup incomplete");
  }
}

export function reconcileChecks(previous, current, owner, stopped) {
  const rows = requiredDeployedChecks.map((check) => ({ check, status: "BLOCKED" }));
  for (const receipt of [...previous, ...current, ...owner]) {
    const row = rows.find((x) => x.check === receipt.check);
    assert.ok(row, "unknown check");
    if (receipt.status === "PASS")
      assert.ok(
        ["DEPLOYED", "REUSED_DEPLOYED"].includes(receipt.kind),
        "source tests cannot satisfy S6",
      );
    Object.assign(row, receipt);
  }
  return { rows, verified: stopped === true && rows.every((x) => x.status === "PASS") };
}
