function requireCondition(condition, code) {
  if (!condition) throw new Error(`narrow_openai_browser_inputs_${code}`);
}

// Explicit protected browser inputs for the narrow release. This is not a
// partial PLAN document and does not qualify server or deployment configuration.
// The caller supplies its source-pinned expected project; no environment value
// can select a different target. Values are returned only to the build caller.
export function narrowOpenAiBrowserInputs(env, expected) {
  requireCondition(env && typeof env === "object" && !Array.isArray(env), "environment_invalid");
  requireCondition(
    env.KOVA_PRODUCTION_BROWSER_INPUT_MODE === "narrow-openai",
    "explicit_mode_required",
  );
  requireCondition(
    typeof expected?.projectRef === "string" && /^[a-z0-9]{20}$/u.test(expected.projectRef),
    "expected_project_invalid",
  );

  const supabaseUrl = env.KOVA_PRODUCTION_SUPABASE_URL;
  const publishableKey = env.KOVA_PRODUCTION_SUPABASE_PUBLISHABLE_KEY;
  const stripeKey = env.KOVA_PRODUCTION_STRIPE_PUBLISHABLE_KEY;
  requireCondition(
    supabaseUrl === `https://${expected.projectRef}.supabase.co`,
    "supabase_url_invalid",
  );
  requireCondition(
    typeof publishableKey === "string" &&
      /^sb_publishable_[A-Za-z0-9_-]{16,}$/u.test(publishableKey),
    "supabase_publishable_key_invalid",
  );
  // An empty browser key would disable Checkout, so it is not an opt-out here.
  requireCondition(
    typeof stripeKey === "string" && /^pk_live_[A-Za-z0-9]{16,}$/u.test(stripeKey),
    "stripe_publishable_key_invalid",
  );
  return { supabaseUrl, publishableKey, stripeKey };
}
