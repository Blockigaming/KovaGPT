import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  TARGET,
  SECRET_NAMES,
  parseArgs,
  runSetup,
} from "../../scripts/azure/provision-owned-auth.mjs";

const opts = {
  execute: true,
  issuer: TARGET.issuer,
  issuerConfirmed: true,
  emptyOwnedAuthConfirmed: true,
};
function fixture(overrides = {}) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "kova-auth-mock-test-"));
  const active = [...(overrides.active ?? [])];
  const calls = [];
  let generated = 0;
  let writes = 0;
  const fake = {
    values: SECRET_NAMES.map((_, i) => `PRIVATE_TEST_SENTINEL_${i}`),
    kid: "test-kid",
    signingFingerprint: "a".repeat(64),
    encryptionFingerprint: "b".repeat(64),
  };
  const dependencies = {
    temporaryRoot,
    generate() {
      generated++;
      return { ...fake, values: [...fake.values] };
    },
    azure(args, json = true) {
      calls.push(args);
      const command = args.slice(0, 3).join(" ");
      if (args[0] === "account")
        return {
          subscription: overrides.subscription ?? TARGET.subscription,
          tenant: TARGET.tenant,
          state: "Enabled",
        };
      if (args[0] === "keyvault" && args[1] === "show")
        return {
          id: `/subscriptions/${TARGET.subscription}/resourceGroups/${TARGET.group}/providers/Microsoft.KeyVault/vaults/${TARGET.vault}`,
          tenant: TARGET.tenant,
        };
      if (command === "keyvault secret list") return active;
      if (command === "keyvault secret list-deleted") return overrides.deleted ?? [];
      const name = args[args.indexOf("--name") + 1];
      if (command === "keyvault secret set") {
        assert.equal(json, false);
        assert.equal(args.includes("--value"), false);
        const path = args[args.indexOf("--file") + 1];
        assert.equal(statSync(path).mode & 0o777, 0o600);
        assert.equal(statSync(dirname(path)).mode & 0o777, 0o700);
        assert.match(readFileSync(path, "utf8"), /^PRIVATE_TEST_SENTINEL_/);
        if (overrides.failAtWrite === writes++) throw new Error("CLI_PRIVATE_VALUE_MUST_NOT_LEAK");
        active.push(name);
        return null;
      }
      if (command === "keyvault secret list-versions")
        return Array.from(
          { length: overrides.versionCount ?? 1 },
          () => `https://${TARGET.vault}.vault.azure.net/secrets/${name}/${"c".repeat(32)}`,
        );
      throw new Error("unexpected mock command");
    },
  };
  return {
    dependencies,
    calls,
    generated: () => generated,
    temporaryRoot,
    cleanup: () => rmSync(temporaryRoot, { recursive: true, force: true }),
  };
}

test("default plan performs no Azure operations or generation", () => {
  const f = fixture();
  try {
    assert.equal(runSetup({}, f.dependencies).operation, "plan_only");
    assert.equal(f.calls.length, 0);
    assert.equal(f.generated(), 0);
  } finally {
    f.cleanup();
  }
});
test("rejects omitted issuer and empty-state confirmations before any Azure operation", () => {
  const f = fixture();
  try {
    assert.throws(
      () => runSetup({ ...opts, issuerConfirmed: false }, f.dependencies),
      /explicit_project_issuer_required/,
    );
    assert.throws(
      () => runSetup({ ...opts, emptyOwnedAuthConfirmed: false }, f.dependencies),
      /empty_owned_auth_confirmation_required/,
    );
    assert.equal(f.calls.length, 0);
  } finally {
    f.cleanup();
  }
});
test("rejects another Azure subscription before generating anything", () => {
  const f = fixture({ subscription: "other" });
  try {
    assert.throws(() => runSetup(opts, f.dependencies), /wrong_azure_account/);
    assert.equal(f.generated(), 0);
  } finally {
    f.cleanup();
  }
});
test("refuses existing target secret, including metadata, without generating", () => {
  const f = fixture({ active: ["kova-auth-jwt-key-id"] });
  try {
    assert.throws(() => runSetup(opts, f.dependencies), /target_secret_already_exists/);
    assert.equal(f.generated(), 0);
  } finally {
    f.cleanup();
  }
});
test("refuses soft-deleted target secret without generating", () => {
  const f = fixture({ deleted: ["kova-auth-encryption-key"] });
  try {
    assert.throws(() => runSetup(opts, f.dependencies), /target_secret_soft_deleted/);
    assert.equal(f.generated(), 0);
  } finally {
    f.cleanup();
  }
});
test("creates exactly eight protected file-input secrets and returns only sanitized metadata", () => {
  const f = fixture({ active: ["openai-api-key", "elevenlabs-api-key"] });
  try {
    const result = runSetup(opts, f.dependencies);
    assert.equal(f.generated(), 1);
    assert.deepEqual(Object.keys(result.secretReferences), SECRET_NAMES);
    assert.equal(result.appBindingsApplied, false);
    assert.equal(result.signingImportPerformed, false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_TEST_SENTINEL/);
    assert.equal(f.calls.filter((a) => a[2] === "set").length, 8);
    assert.deepEqual(readdirSync(f.temporaryRoot), []);
  } finally {
    f.cleanup();
  }
});
test("failure sanitizes CLI diagnostics, cleans files, and retains a truthful partial-write list", () => {
  const f = fixture({ failAtWrite: 2 });
  try {
    assert.throws(
      () => runSetup(opts, f.dependencies),
      (e) => {
        assert.equal(e.message, "private_setup_failed");
        assert.deepEqual(e.completedSecretNames, SECRET_NAMES.slice(0, 2));
        assert.equal(e.uncertainSecretName, SECRET_NAMES[2]);
        assert.doesNotMatch(JSON.stringify(e), /CLI_PRIVATE|PRIVATE_TEST/);
        return true;
      },
    );
    assert.deepEqual(readdirSync(f.temporaryRoot), []);
    assert.equal(
      f.calls.some((a) => a.includes("delete") || a.includes("purge")),
      false,
    );
  } finally {
    f.cleanup();
  }
});
test("multiple versions abort rather than claim custody or overwrite", () => {
  const f = fixture({ versionCount: 2 });
  try {
    assert.throws(() => runSetup(opts, f.dependencies), /unexpected_secret_version_state/);
    assert.deepEqual(readdirSync(f.temporaryRoot), []);
  } finally {
    f.cleanup();
  }
});
test("a target arriving after initial inventory aborts before the first write", () => {
  const f = fixture();
  const original = f.dependencies.azure;
  let inventories = 0;
  f.dependencies.azure = (args, json) => {
    if (args.slice(0, 3).join(" ") === "keyvault secret list" && ++inventories === 2)
      return [SECRET_NAMES[0]];
    return original(args, json);
  };
  try {
    assert.throws(() => runSetup(opts, f.dependencies), /target_secret_already_exists/);
    assert.equal(f.generated(), 1);
    assert.equal(
      f.calls.some((a) => a[2] === "set"),
      false,
    );
    assert.deepEqual(readdirSync(f.temporaryRoot), []);
  } finally {
    f.cleanup();
  }
});
test("argument parser accepts only explicit known flags", () => {
  assert.deepEqual(
    parseArgs([
      "--execute",
      "--issuer",
      TARGET.issuer,
      "--confirm-project-issuer",
      "--confirm-empty-owned-auth",
    ]),
    opts,
  );
  assert.throws(() => parseArgs(["--overwrite"]), /invalid_arguments/);
});
