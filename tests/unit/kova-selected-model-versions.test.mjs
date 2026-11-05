import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HOSTED_MODEL_MAP,
  prepareKovaHostedRequest,
} from "../../src/lib/ai/kova-hosted-inference.server.mjs";
import {
  KOVA_MODEL_CATALOG,
  resolveKovaModelAlias,
} from "../../src/lib/ai/kova-model-migration.mjs";
import { KOVA_ASSISTANT_IDENTITY } from "../../src/lib/ai/kova-identity-policy.mjs";
import {
  KOVA_MODEL_FAMILIES,
  kovaModelIdentityForRole,
} from "../../src/lib/kova-model-identity.mjs";

const approved = [
  {
    id: "kova-xenon-5",
    label: "Kova Xenon 5",
    family: "nova",
    role: "PREMIUM_REASONING",
    foundation: "moonshotai/kimi-k3",
  },
  {
    id: "kova-neon-4.6",
    label: "Kova Neon 4.6",
    family: "orion",
    role: "ADVANCED_REASONING",
    foundation: "meta-llama/llama-4-maverick",
  },
  {
    id: "kova-argon-4.6",
    label: "Kova Argon 4.6",
    family: "cosmo",
    role: "DEFAULT_CHAT",
    foundation: "deepseek/deepseek-v4-flash-0731",
  },
];

test("all model identities use the owner's exact approved versions and foundation engines", () => {
  for (const model of approved) {
    assert.equal(resolveKovaModelAlias(model.id)?.name, model.label);
    assert.equal(KOVA_ASSISTANT_IDENTITY[model.id], model.label);
    assert.equal(
      KOVA_MODEL_FAMILIES.find((family) => family.id === model.family)?.label,
      model.label,
    );
    assert.equal(kovaModelIdentityForRole(model.role).label, model.label);
    assert.equal(HOSTED_MODEL_MAP[model.id], model.foundation);
    const body = JSON.parse(
      prepareKovaHostedRequest({
        model: model.id,
        stream: false,
        messages: [{ role: "user", content: "Hi" }],
        max_completion_tokens: 300,
      }).body,
    );
    assert.equal(body.model, model.foundation);
  }
  assert.deepEqual(Object.keys(HOSTED_MODEL_MAP).sort(), approved.map((m) => m.id).sort());
  assert.deepEqual(
    Object.values(KOVA_MODEL_CATALOG).map((m) => m.id),
    approved.map((m) => m.id),
  );
});

test("retired version aliases fail closed instead of silently switching versions", () => {
  for (const retired of ["kova-xenon-4.6", "kova-argon-5"]) {
    assert.equal(resolveKovaModelAlias(retired), null);
    assert.equal(Object.hasOwn(KOVA_ASSISTANT_IDENTITY, retired), false);
    assert.equal(Object.hasOwn(HOSTED_MODEL_MAP, retired), false);
    assert.throws(
      () =>
        prepareKovaHostedRequest({
          model: retired,
          messages: [{ role: "user", content: "Hi" }],
        }),
      /invalid_hosted_request/,
    );
  }
});

test("related staging code and pricing configuration use the new names", () => {
  for (const path of [
    "src/lib/ai/model-config.mjs",
    "src/lib/ai/model-catalog.server.ts",
    "src/lib/ai/kova-provider-routing.test.mjs",
    "src/lib/ai/kova-inference-staging.mjs",
    "src/routes/api/chat.ts",
    ".env.example",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.equal(source.includes("kova-xenon-4.6"), false);
    assert.equal(source.includes("kova-argon-5"), false);
  }
});

test("legacy effort picker does not mislabel all models as version 4.6", () => {
  const modes = readFileSync("src/lib/modes.ts", "utf8");
  assert.match(modes, /label: "Kova models"/);
  assert.equal(modes.includes("label: `KovaGPT Model " + "${KOVA_MODEL_VERSION}" + "`"), false);
});
