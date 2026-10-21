import assert from "node:assert/strict";
import test from "node:test";
import {
  targetFromEnvironment,
  admitExistingReference,
  inspectOpenAiMetadata,
  main,
} from "../../scripts/azure/production-openai-only-metadata-preflight.mjs";

const env = {
  KOVA_METADATA_SUBSCRIPTION_ID: "00000000-0000-0000-0000-000000000001",
  KOVA_METADATA_RESOURCE_GROUP: "rg-kovagpt-prod",
  KOVA_METADATA_CONTAINER_APP: "kovagpt-prod-web",
};
const target = targetFromEnvironment(env);
const url = "https://fixture-vault.vault.azure.net/secrets/openai-api-key/" + "0".repeat(31) + "1";
function app() {
  return {
    name: target.app,
    id: target.appId,
    identity: { type: "UserAssigned", userAssignedIdentities: { [target.identityId]: {} } },
    properties: {
      configuration: {
        secrets: [{ name: "openai-api-key", identity: target.identityId, keyVaultUrl: url }],
      },
    },
  };
}

test("default off never admits a target or starts private reads", async () => {
  assert.deepEqual(
    await main([], {
      env: {},
      inspect: () => {
        throw Error("unexpected");
      },
    }),
    { enabled: false, actualVaultReadAttempts: 0, actualProviderGetAttempts: 0 },
  );
});

test("only exact app, attached expected identity and one pinned HTTPS slot are admitted", () => {
  assert.equal(admitExistingReference(app(), target).versionedKeyVaultUrl, url);
  for (const change of [
    (value) => {
      value.id = value.id.replace("kovagpt-prod-web", "other");
    },
    (value) => {
      value.identity.userAssignedIdentities = {};
    },
    (value) => {
      value.properties.configuration.secrets[0].identity = "system";
    },
    (value) => {
      value.properties.configuration.secrets.push(value.properties.configuration.secrets[0]);
    },
    (value) => {
      value.properties.configuration.secrets[0].keyVaultUrl = url.replace("https:", "http:");
    },
    (value) => {
      value.properties.configuration.secrets[0].keyVaultUrl = url.replace(/\/[a-f0-9]+$/, "");
    },
    (value) => {
      value.properties.configuration.secrets[0].keyVaultUrl = url + "?x=1";
    },
    (value) => {
      value.properties.configuration.secrets[0].value = "inlined-credential";
    },
  ]) {
    const value = app();
    change(value);
    assert.throws(() => admitExistingReference(value, target));
  }
  assert.throws(() => targetFromEnvironment({ ...env, KOVA_METADATA_RESOURCE_GROUP: "other" }));
});

test("one management read, one admitted vault read, one GET, no key projection or credential inheritance", async () => {
  const calls = [],
    gets = [];
  const key = "sk-proj-" + "a".repeat(40);
  const report = await inspectOpenAiMetadata(
    {
      ...env,
      KOVA_PRODUCTION_BACKUP_PASSPHRASE: "synthetic-phrase",
      GITHUB_TOKEN: "synthetic-github-token",
    },
    {
      spawn: (program, args, options) => {
        assert.equal(program, "az");
        calls.push(args);
        assert.equal(options.shell, false);
        assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
        assert.equal(options.env.KOVA_PRODUCTION_BACKUP_PASSPHRASE, undefined);
        assert.equal(options.env.GITHUB_TOKEN, undefined);
        const output = args[0] === "containerapp" ? JSON.stringify(app()) : key + "\n";
        if (args[0] === "keyvault") assert.equal(args[args.indexOf("--id") + 1], url);
        return { status: 0, stdout: Buffer.from(output), stderr: Buffer.alloc(0) };
      },
      fetcher: async (requestUrl, options) => {
        gets.push(requestUrl);
        assert.equal(options.method, "GET");
        assert.equal(options.redirect, "error");
        assert.equal(options.headers.Authorization, `Bearer ${key}`);
        return Response.json({
          data: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"].map((id) => ({
            id,
            object: "model",
          })),
        });
      },
    },
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(gets, ["https://api.openai.com/v1/models"]);
  assert.equal(report.actualAppReadAttempts, 1);
  assert.equal(report.actualVaultReadAttempts, 1);
  assert.equal(report.actualProviderGetAttempts, 1);
  assert.equal(report.elevenLabsVaultReads, 0);
  assert.equal(report.existingReference.versionedKeyVaultUrl, url);
  assert.ok(report.openAI.intendedModels.every((row) => row.metadataListed));
  assert.equal(JSON.stringify(report).includes(key), false);
  assert.equal(report.generationUsabilityVerified, false);
});

test("unadmitted configuration prevents vault/provider reads; private diagnostics stay private", async () => {
  let calls = 0,
    gets = 0;
  const report = await inspectOpenAiMetadata(env, {
    spawn: () => {
      calls += 1;
      return {
        status: 1,
        stdout: Buffer.alloc(0),
        stderr: Buffer.from("ForbiddenByRbac synthetic-private-detail"),
      };
    },
    fetcher: () => {
      gets += 1;
      throw Error("unexpected");
    },
  });
  assert.equal(calls, 1);
  assert.equal(gets, 0);
  assert.equal(report.actualVaultReadAttempts, 0);
  assert.equal(report.openAI.status, "authorization_denied");
  assert.equal(JSON.stringify(report).includes("synthetic-private-detail"), false);
});
