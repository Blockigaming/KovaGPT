import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

function fixture({
  apply = false,
  cap = "7",
  identity = true,
  malformed = false,
  hostedOnly = false,
  noModelPolicy = false,
} = {}) {
  const calls = [],
    output = [];
  const process = {
    argv: [
      "node",
      "configure-elevenlabs.mjs",
      "--resource-group",
      "existing-group",
      "--voice-id",
      "existingVoice",
      "--key-vault-secret-uri",
      "https://existing-vault.vault.azure.net/secrets/elevenlabs/0123456789abcdef0123456789abcdef",
      ...(apply ? ["--apply"] : []),
    ],
    exitCode: 0,
  };
  const app = {
    identity: identity ? { type: "SystemAssigned" } : {},
    properties: {
      template: {
        containers: [
          {
            name: "web",
            env: [
              { name: "KOVA_VOICE_DAILY_REQUEST_LIMIT", value: cap },
              { name: "KOVA_VOICE_MODEL_PROOF_SECRET", secretRef: "existing-signing-secret" },
              ...(!hostedOnly && !noModelPolicy
                ? [{ name: "KOVA_VOICE_OPENAI_MODELS_JSON", value: '["existing-model"]' }]
                : []),
              ...(hostedOnly
                ? [{ name: "KOVA_VOICE_HOSTED_MODELS_JSON", value: '["kova-xenon-5"]' }]
                : []),
              { name: "UNRELATED_SECRET", value: "private-canary" },
            ],
          },
        ],
      },
    },
  };
  const source = readFileSync("scripts/azure/configure-elevenlabs.mjs", "utf8").replace(
    'import { execFileSync } from "node:child_process";',
    "",
  );
  new Function("execFileSync", "process", "console", source)(
    (command, args) => {
      calls.push([command, args]);
      return args[1] === "show" ? (malformed ? "private-canary" : JSON.stringify(app)) : "";
    },
    process,
    {
      log: (...args) => output.push(args.join(" ")),
      error: (...args) => output.push(args.join(" ")),
    },
  );
  return { calls, output: output.join("\n"), exitCode: process.exitCode };
}
test("ElevenLabs setup defaults to read-only review without exposing configuration", () => {
  const f = fixture();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][1][1], "show");
  assert.equal(f.exitCode, 0);
  assert.match(f.output, /"mode": "review"/);
  assert.match(f.output, /"preservedDailyRequestCap": 7/);
  assert.doesNotMatch(f.output, /private-canary|existing-signing-secret/);
});
test("explicit apply changes only the targeted voice references and preserves the existing cap", () => {
  const f = fixture({ apply: true });
  assert.equal(f.exitCode, 0);
  assert.equal(f.calls.length, 3);
  const mutation = JSON.stringify(f.calls.slice(1));
  assert.match(mutation, /keyvaultref:/);
  assert.match(mutation, /ELEVENLABS_API_KEY=secretref:elevenlabs-api-key/);
  assert.doesNotMatch(
    mutation,
    /private-canary|KOVA_VOICE_DAILY_REQUEST_LIMIT|min-replicas|ingress|KOVA_GENERATION_DISABLED/,
  );
  assert.doesNotMatch(f.output, /private-canary/);
});
test("existing hosted-only voice policy qualifies without exposing Kova model secrets", () => {
  const f = fixture({ hostedOnly: true, apply: true });
  assert.equal(f.exitCode, 0);
  assert.equal(f.calls.length, 3);
  assert.doesNotMatch(f.output, /kova-xenon-5|existing-signing-secret/);
});
test("missing rollout prerequisites and malformed Azure output cannot change resources or leak values", () => {
  for (const options of [
    { cap: "" },
    { identity: false },
    { malformed: true },
    { noModelPolicy: true },
  ]) {
    const f = fixture({ ...options, apply: true });
    assert.equal(f.exitCode, 1);
    assert.equal(f.calls.length, 1);
    assert.doesNotMatch(f.output, /private-canary/);
  }
});
