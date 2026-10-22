import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { TARGET, SECRET_NAMES } from "../../scripts/azure/provision-owned-auth.mjs";
import {
  APP,
  IDENTITY,
  PROVIDERS,
  validateContext,
  permissionAllows,
  databaseEnvironment,
  checkEmptyAuth,
  executeOperator,
} from "../../scripts/azure/production-api-operator.mjs";

const root = `/subscriptions/${TARGET.subscription}/resourceGroups/${TARGET.group}/providers`;
const identityId = `${root}/Microsoft.ManagedIdentity/userAssignedIdentities/${IDENTITY}`;
const client = "12345678-1234-1234-1234-123456789abc";
const env = (op = "CHECK") => ({
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: "Blockigaming/KovaGPT",
  GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: "a".repeat(40),
  KOVA_OPERATOR_SOURCE_SHA: "a".repeat(40),
  KOVA_OPERATOR_AZURE_CLIENT_ID: client,
  KOVA_OPERATOR_OPERATION: op,
  KOVA_OPERATOR_CONFIRMATION: op,
});

function fixture(options = {}) {
  const calls = [];
  const writes = [];
  const slots =
    options.slots ??
    Object.entries(PROVIDERS).map(([name, version]) => ({
      name,
      keyVaultUrl: `https://${TARGET.vault}.vault.azure.net/secrets/${name}/${version}`,
      identity: identityId,
    }));
  const az = (args, json = true) => {
    calls.push(args);
    const op = args.slice(0, 3).join(" ");
    if (args[0] === "account")
      return {
        subscription: TARGET.subscription,
        tenant: TARGET.tenant,
        state: "Enabled",
        user: { type: "servicePrincipal", name: options.client ?? client },
      };
    if (args[0] === "containerapp" && args[1] === "show")
      return {
        id: `${root}/Microsoft.App/containerApps/${APP}`,
        running: "Running",
        revision: "unchanged-live-revision",
        identities: { [identityId]: {} },
        secrets: slots,
      };
    if (args[0] === "keyvault" && args[1] === "show")
      return {
        id: `${root}/Microsoft.KeyVault/vaults/${TARGET.vault}`,
        tenant: TARGET.tenant,
        rbac: true,
      };
    if (op === "keyvault secret list") {
      if (args.includes("[].name")) return options.activeNames ?? [];
      return options.names ?? Object.keys(PROVIDERS).map((name) => ({ name, enabled: true }));
    }
    if (op === "keyvault secret list-deleted") return options.deleted ?? [];
    if (args[0] === "rest") {
      if (options.permissionError) throw Error("SENSITIVE_PRIVATE_DIAGNOSTIC");
      return {
        value: [
          {
            actions: options.actions ?? ["*"],
            dataActions: options.dataActions ?? ["Microsoft.KeyVault/vaults/secrets/*"],
          },
        ],
      };
    }
    if (op === "keyvault secret list-versions") {
      const name = args[args.indexOf("--name") + 1];
      const id = `https://${TARGET.vault}.vault.azure.net/secrets/${name}/${PROVIDERS[name] ?? "b".repeat(32)}`;
      return args.includes("[].id") ? [id] : [{ id, enabled: true }];
    }
    if (op === "containerapp secret set") {
      assert.equal(json, false);
      assert.equal(
        args.some((a) => a.includes("PRIVATE_SENTINEL")),
        false,
      );
      writes.push(args);
      for (const [name, version] of Object.entries(PROVIDERS))
        if (!slots.some((s) => s.name === name))
          slots.push({
            name,
            keyVaultUrl: `https://${TARGET.vault}.vault.azure.net/secrets/${name}/${version}`,
            identity: identityId,
          });
      return null;
    }
    if (op === "keyvault secret set") {
      assert.equal(json, false);
      const path = args[args.indexOf("--file") + 1];
      assert.equal(statSync(path).mode & 0o777, 0o600);
      assert.equal(statSync(dirname(path)).mode & 0o777, 0o700);
      assert.equal(readFileSync(path, "utf8"), "re_PRIVATE_SENTINEL_SECRET_VALUE");
      writes.push(args);
      if (options.writeError) throw Error("PRIVATE_SENTINEL_SECRET_VALUE");
      return null;
    }
    throw Error(`Unexpected mock command: ${op}`);
  };
  return { az, calls, writes };
}

test("default CLI plan contacts neither Azure nor database", () => {
  const out = execFileSync(process.execPath, ["scripts/azure/production-api-operator.mjs"], {
    encoding: "utf8",
  });
  assert.equal(JSON.parse(out).azureContacted, false);
});
test("rejects PRs, other branches, forks, missing confirmation, and a different SHA before cloud calls", () => {
  for (const change of [
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_REPOSITORY: "other/KovaGPT" },
    { KOVA_OPERATOR_CONFIRMATION: "" },
    { KOVA_OPERATOR_SOURCE_SHA: "b".repeat(40) },
  ]) {
    const f = fixture();
    assert.throws(() => executeOperator({ ...env(), ...change }, { azure: f.az }));
    assert.equal(f.calls.length, 0);
  }
});
test("uses the expected service principal, not an unrelated Azure sign-in", () => {
  const f = fixture({ client: "wrong" });
  assert.throws(() => executeOperator(env(), { azure: f.az }), /wrong_federated_azure_account/);
  assert.equal(f.calls.length, 1);
});
test("CHECK reads only metadata; write capability is reported as declared, never proven", () => {
  const f = fixture();
  const receipt = executeOperator(env(), { azure: f.az });
  assert.equal(receipt.declaredPermissions.appWrite, true);
  assert.equal(receipt.productionObservation.runningStatus, "Running");
  assert.equal(
    receipt.providerReferenceState["openai-api-key"].matchesReviewedVersionAndIdentity,
    true,
  );
  assert.equal(receipt.writePermissionActuallyExercised, false);
  assert.equal(f.writes.length, 0);
  assert.equal(
    f.calls.some((a) => ["show", "download", "get"].includes(a[2]) && a[1] === "secret"),
    false,
  );
  assert.equal(
    f.calls.some((a) => a.includes("listSecrets")),
    false,
  );
});
test("unreadable permission data yields unknown and blocks writes without echoing diagnostics", () => {
  const f = fixture({ permissionError: true });
  const receipt = executeOperator(env(), { azure: f.az });
  assert.equal(receipt.declaredPermissions.appWrite, null);
  assert.doesNotMatch(JSON.stringify(receipt), /SENSITIVE_PRIVATE/);
  assert.throws(
    () => executeOperator(env("BIND_PROVIDER_REFERENCES"), { azure: f.az }),
    /declared_app_write_not_established/,
  );
  assert.equal(f.writes.length, 0);
});
test("permission matching respects wildcard exclusions and alternate role grants", () => {
  const action = "Microsoft.App/containerApps/write";
  assert.equal(permissionAllows([{ actions: ["*"], notActions: [action] }], action), false);
  assert.equal(
    permissionAllows([{ actions: ["*"], notActions: [action] }, { actions: [action] }], action),
    true,
  );
  assert.equal(
    permissionAllows(
      [{ actions: ["*"], dataActions: [] }],
      "Microsoft.KeyVault/vaults/secrets/setSecret/action",
      true,
    ),
    false,
  );
});
test("fresh database check requires exact production target and verified TLS", () => {
  const u = `postgresql://postgres:PRIVATE_SENTINEL_SECRET_VALUE@db.mfbycmbjygcfkrsuepxf.supabase.co:5432/postgres?sslmode=disable&options=unsafe`;
  const d = databaseEnvironment(u, { PGSSLMODE: "disable", PGOPTIONS: "unsafe", PATH: "/bin" });
  assert.equal(d.PGSSLMODE, "verify-full");
  assert.match(d.PGOPTIONS, /default_transaction_read_only=on/);
  assert.equal(d.PGDATABASE, "postgres");
  assert.throws(
    () => databaseEnvironment(u.replace("mfbycmbjygcfkrsuepxf", "other")),
    /wrong_database_target/,
  );
});
test("database guard checks owned accounts, sessions, encrypted MFA and OAuth state while preserving hosted users", () => {
  const u = "postgresql://postgres:x@db.mfbycmbjygcfkrsuepxf.supabase.co/postgres";
  const runner = (binary, args, opts) => {
    assert.equal(binary, "psql");
    assert.match(opts.input, /^BEGIN READ ONLY;/);
    assert.match(opts.input, /ROLLBACK;/);
    assert.doesNotMatch(args.join(" "), /postgresql:\/\//);
    return "0|0|0|0|2\n";
  };
  assert.equal(checkEmptyAuth(u, runner).hostedUsersPreserved, 2);
  for (const result of ["1|0|0|0|2", "0|0|1|0|2", "0|0|0|1|2", "garbage", "0|0|0|0|2\nextra"]) {
    assert.throws(() => checkEmptyAuth(u, () => result));
  }
});
test("CREATE_AUTH calls no generator when database guard fails", () => {
  const f = fixture();
  let setup = 0;
  assert.throws(
    () =>
      executeOperator(
        { ...env("CREATE_AUTH"), KOVA_OPERATOR_DATABASE_URL: "invalid" },
        {
          azure: f.az,
          setup: () => {
            setup++;
          },
        },
      ),
    /protected_database_url_required/,
  );
  assert.equal(setup, 0);
});
test("CREATE_AUTH executes existing helper only after live read-only empty-state check", () => {
  const f = fixture();
  let guarded = false;
  const r = executeOperator(
    {
      ...env("CREATE_AUTH"),
      KOVA_OPERATOR_DATABASE_URL:
        "postgresql://postgres:x@db.mfbycmbjygcfkrsuepxf.supabase.co/postgres",
    },
    {
      azure: f.az,
      run: () => {
        guarded = true;
        return "0|0|0|0|2";
      },
      setup: (opts) => {
        assert.equal(guarded, true);
        assert.equal(opts.emptyOwnedAuthConfirmed, true);
        return { ok: true, created: SECRET_NAMES };
      },
    },
  );
  assert.equal(r.writePermissionActuallyExercised, true);
  assert.equal(r.deployed, false);
});
test("provider setup reuses exact existing references without reading provider values", () => {
  const f = fixture();
  const r = executeOperator(env("BIND_PROVIDER_REFERENCES"), { azure: f.az });
  assert.equal(r.providerReferences.existingReferencesReused, 2);
  assert.equal(f.writes.length, 0);
});
test("provider setup adds missing pinned references and keeps image/revision/env untouched", () => {
  const f = fixture({ slots: [] });
  const r = executeOperator(env("BIND_PROVIDER_REFERENCES"), { azure: f.az });
  assert.equal(f.writes.length, 1);
  assert.equal(r.providerReferences.referencesAdded.length, 2);
  assert.equal(r.runtimeBindingsApplied, false);
  assert.equal(
    f.calls.some(
      (a) => a.includes("--image") || a.includes("--set-env-vars") || a.includes("update"),
    ),
    false,
  );
});
test("provider setup refuses a conflicting existing reference without overwriting it", () => {
  const f = fixture({
    slots: [
      { name: "openai-api-key", keyVaultUrl: "https://wrong.example/secret", identity: identityId },
    ],
  });
  assert.throws(
    () => executeOperator(env("BIND_PROVIDER_REFERENCES"), { azure: f.az }),
    /existing_app_reference_differs/,
  );
  assert.equal(f.writes.length, 0);
});
test("Resend import takes the private protected input through a 0600 file and cleans it", () => {
  const f = fixture();
  const r = executeOperator(
    { ...env("IMPORT_RESEND"), KOVA_OPERATOR_RESEND_KEY: "re_PRIVATE_SENTINEL_SECRET_VALUE" },
    { azure: f.az },
  );
  assert.equal(f.writes.length, 1);
  assert.equal(existsSync(f.writes[0][f.writes[0].indexOf("--file") + 1]), false);
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE_SENTINEL/);
  assert.equal(r.resendImport.providerCredentialValidated, false);
});
test("Resend import never overwrites active or soft-deleted credentials", () => {
  for (const options of [{ activeNames: ["resend-api-key"] }, { deleted: ["resend-api-key"] }]) {
    const f = fixture(options);
    assert.throws(
      () =>
        executeOperator(
          { ...env("IMPORT_RESEND"), KOVA_OPERATOR_RESEND_KEY: "re_PRIVATE_SENTINEL_SECRET_VALUE" },
          { azure: f.az },
        ),
      /resend_secret_exists/,
    );
    assert.equal(f.writes.length, 0);
  }
});
test("uncertain Resend writes are not retried and private files are removed", () => {
  const f = fixture({ writeError: true });
  assert.throws(
    () =>
      executeOperator(
        { ...env("IMPORT_RESEND"), KOVA_OPERATOR_RESEND_KEY: "re_PRIVATE_SENTINEL_SECRET_VALUE" },
        { azure: f.az },
      ),
    /resend_write_uncertain/,
  );
  assert.equal(f.writes.length, 1);
  assert.equal(existsSync(f.writes[0][f.writes[0].indexOf("--file") + 1]), false);
});
test("workflow keeps live operations off PRs and uses exact-source production OIDC", () => {
  const y = readFileSync(".github/workflows/production-api-operator.yml", "utf8");
  assert.match(y, /github.event_name == 'workflow_dispatch'/);
  assert.match(y, /github.ref == 'refs\/heads\/main'/);
  assert.match(y, /inputs.source_sha == github.sha/);
  assert.match(y, /name: production/);
  assert.match(y, /id-token: write/);
  assert.match(y, /path: \$\{\{ runner.temp \}\}\/production-api-operator\/receipt.json/);
  assert.doesNotMatch(y, /pull_request_target|secrets: inherit|--debug|set -x/);
});
