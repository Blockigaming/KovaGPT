import assert from "node:assert/strict";
import test from "node:test";
import { narrowOpenAiBrowserInputs } from "../../scripts/azure/narrow-openai-browser-inputs.mjs";

const expected = Object.freeze({ projectRef: "mfbycmbjygcfkrsuepxf" });
const browserKey = `sb_publishable_${"fixture".repeat(4)}`;
const stripeKey = `pk_live_${"fixture".repeat(4)}`;
const valid = Object.freeze({
  KOVA_PRODUCTION_BROWSER_INPUT_MODE: "narrow-openai",
  KOVA_PRODUCTION_SUPABASE_URL: `https://${expected.projectRef}.supabase.co`,
  KOVA_PRODUCTION_SUPABASE_PUBLISHABLE_KEY: browserKey,
  KOVA_PRODUCTION_STRIPE_PUBLISHABLE_KEY: stripeKey,
});

test("explicit narrow mode returns only qualified browser fields without reading a PLAN document", () => {
  const accessed = [];
  const env = new Proxy(valid, {
    get(target, property) {
      assert.ok(Object.hasOwn(target, property), "Unexpected input access");
      accessed.push(property);
      return target[property];
    },
  });
  assert.deepEqual(narrowOpenAiBrowserInputs(env, expected), {
    supabaseUrl: valid.KOVA_PRODUCTION_SUPABASE_URL,
    publishableKey: browserKey,
    stripeKey,
  });
  assert.deepEqual(accessed.sort(), Object.keys(valid).sort());
});

for (const mode of [undefined, "", "auto", "plan", "NARROW-OPENAI", "narrow-openai "]) {
  test(`explicit mode is required (${mode === undefined ? "missing" : JSON.stringify(mode)})`, () => {
    assert.throws(
      () =>
        narrowOpenAiBrowserInputs({ ...valid, KOVA_PRODUCTION_BROWSER_INPUT_MODE: mode }, expected),
      { message: "narrow_openai_browser_inputs_explicit_mode_required" },
    );
  });
}

for (const [name, field, value, code] of [
  ["missing URL", "KOVA_PRODUCTION_SUPABASE_URL", undefined, "supabase_url_invalid"],
  [
    "wrong project",
    "KOVA_PRODUCTION_SUPABASE_URL",
    `https://${"z".repeat(20)}.supabase.co`,
    "supabase_url_invalid",
  ],
  [
    "HTTP URL",
    "KOVA_PRODUCTION_SUPABASE_URL",
    `http://${expected.projectRef}.supabase.co`,
    "supabase_url_invalid",
  ],
  [
    "URL path",
    "KOVA_PRODUCTION_SUPABASE_URL",
    `${valid.KOVA_PRODUCTION_SUPABASE_URL}/`,
    "supabase_url_invalid",
  ],
  [
    "URL userinfo",
    "KOVA_PRODUCTION_SUPABASE_URL",
    `https://fixture@${expected.projectRef}.supabase.co`,
    "supabase_url_invalid",
  ],
  [
    "missing Supabase browser key",
    "KOVA_PRODUCTION_SUPABASE_PUBLISHABLE_KEY",
    undefined,
    "supabase_publishable_key_invalid",
  ],
  [
    "empty Supabase browser key",
    "KOVA_PRODUCTION_SUPABASE_PUBLISHABLE_KEY",
    "",
    "supabase_publishable_key_invalid",
  ],
  [
    "Supabase server key",
    "KOVA_PRODUCTION_SUPABASE_PUBLISHABLE_KEY",
    `sb_secret_${"fixture".repeat(4)}`,
    "supabase_publishable_key_invalid",
  ],
  [
    "legacy JWT",
    "KOVA_PRODUCTION_SUPABASE_PUBLISHABLE_KEY",
    "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.fixture",
    "supabase_publishable_key_invalid",
  ],
  [
    "short Supabase key",
    "KOVA_PRODUCTION_SUPABASE_PUBLISHABLE_KEY",
    "sb_publishable_short",
    "supabase_publishable_key_invalid",
  ],
  [
    "missing Stripe key",
    "KOVA_PRODUCTION_STRIPE_PUBLISHABLE_KEY",
    undefined,
    "stripe_publishable_key_invalid",
  ],
  [
    "empty Stripe key",
    "KOVA_PRODUCTION_STRIPE_PUBLISHABLE_KEY",
    "",
    "stripe_publishable_key_invalid",
  ],
  [
    "test Stripe key",
    "KOVA_PRODUCTION_STRIPE_PUBLISHABLE_KEY",
    `pk_test_${"fixture".repeat(4)}`,
    "stripe_publishable_key_invalid",
  ],
  [
    "Stripe server key",
    "KOVA_PRODUCTION_STRIPE_PUBLISHABLE_KEY",
    `sk_live_${"fixture".repeat(4)}`,
    "stripe_publishable_key_invalid",
  ],
  [
    "Stripe restricted key",
    "KOVA_PRODUCTION_STRIPE_PUBLISHABLE_KEY",
    `rk_live_${"fixture".repeat(4)}`,
    "stripe_publishable_key_invalid",
  ],
  [
    "whitespace Stripe key",
    "KOVA_PRODUCTION_STRIPE_PUBLISHABLE_KEY",
    `${stripeKey}\n`,
    "stripe_publishable_key_invalid",
  ],
]) {
  test(`${name} fails closed with a fixed sanitized error`, () => {
    const env = { ...valid, [field]: value };
    assert.throws(() => narrowOpenAiBrowserInputs(env, expected), {
      message: `narrow_openai_browser_inputs_${code}`,
    });
  });
}

test("a full PLAN document cannot supply missing dedicated fields or enable billing omission", () => {
  const env = {
    KOVA_PRODUCTION_BROWSER_INPUT_MODE: "narrow-openai",
    KOVA_PRODUCTION_BICEP_PARAMETERS_JSON: JSON.stringify({
      parameters: {
        supabaseUrl: { value: valid.KOVA_PRODUCTION_SUPABASE_URL },
        supabasePublishableKey: { value: browserKey },
      },
    }),
  };
  assert.throws(() => narrowOpenAiBrowserInputs(env, expected), {
    message: "narrow_openai_browser_inputs_supabase_url_invalid",
  });
});

test("malformed environment or unpinned expected project is rejected", () => {
  for (const env of [undefined, null, [], "fixture"])
    assert.throws(() => narrowOpenAiBrowserInputs(env, expected), {
      message: "narrow_openai_browser_inputs_environment_invalid",
    });
  for (const target of [undefined, null, {}, { projectRef: "" }, { projectRef: "../fixture" }])
    assert.throws(() => narrowOpenAiBrowserInputs(valid, target), {
      message: "narrow_openai_browser_inputs_expected_project_invalid",
    });
});
