import {
  ACCEPTANCE_PROMPT,
  acceptanceDigest,
  createGenerationAcceptanceGuard,
} from "../../src/lib/generation-acceptance.server.mjs";

// Every price, identity and evidence hash below is a synthetic fixture. No live
// account, quote, authorization, provider or database is contacted by these tests.
const SHA = "a".repeat(64);
// Live route tests need a plan that remains inside one hourly claim bucket.
// The guard uses this fixture clock; provider admission also checks real expiry.
export const liveAcceptanceFixtureTime = (wallNow = Date.now()) =>
  Math.ceil(wallNow / 3_600_000) * 3_600_000 + 10 * 60_000;

export const syntheticAcceptanceBody = () => ({
  model: "gpt-5.6-luna",
  input: [{ role: "user", content: ACCEPTANCE_PROMPT }],
  instructions: "Synthetic fixture system instructions.",
  stream: true,
  store: false,
  service_tier: "default",
  max_output_tokens: 64,
});
export function createAcceptanceFixture({
  shared = new Map(),
  now = Date.UTC(2026, 9, 20, 0, 10),
  ownerId = "22222222-2222-4222-8222-222222222222",
  chatId = "33333333-3333-4333-8333-333333333333",
  providerBody = syntheticAcceptanceBody(),
  verifiedInputTokens = 40,
  maximumInputUtf8Bytes = 4096,
} = {}) {
  let time = now;
  const quotedBody = { ...providerBody, max_output_tokens: 64 };
  const plan = {
    version: 1,
    operationId: "11111111-1111-4111-8111-111111111111",
    ownerId,
    chatId,
    notBefore: time,
    expiresAt: time + 180000,
    target: {
      environment: "ca-kovagpt-staging",
      commit: "1".repeat(40),
      tree: "2".repeat(40),
      imageDigest: `sha256:${SHA}`,
      revision: "ca-kovagpt-staging--fixture",
      configurationEvidenceSha256: SHA,
    },
    openAI: {
      model: "gpt-5.6-luna",
      maximumOutputTokens: 64,
      userPrompt: ACCEPTANCE_PROMPT,
      bodySha256: acceptanceDigest(quotedBody),
      tokenCountEvidenceSha256: SHA,
      verifiedInputTokens,
      maximumInputUtf8Bytes,
    },
    speech: {
      model: "eleven_multilingual_v2",
      maximumTextCharacters: 120,
      voiceId: "fixtureVoice",
    },
    quote: {
      currency: "USD",
      unit: "nanoUSD",
      pricingEvidenceSha256: SHA,
      verifiedAt: time - 1000,
      validUntil: time + 180000,
      inputPerMillion: "200000000",
      outputPerMillion: "1200000000",
      speechPerCharacter: "1000000",
      maximumTotal: String(BigInt(verifiedInputTokens) * 200n + 76800n + 120000000n),
    },
  };
  let config;
  const bind = () => {
    const hash = acceptanceDigest(plan);
    const approvalReceipt = {
      version: 1,
      planSha256: hash,
      approvedMaximumCostNanos: plan.quote?.maximumTotal,
      approvedAt: plan.notBefore - 1000,
      expiresAt: plan.expiresAt,
      authorizationEvidenceSha256: SHA,
    };
    config = {
      enabled: true,
      plan,
      expectedPlanSha256: hash,
      approvalReceipt,
      expectedApprovalReceiptSha256: acceptanceDigest(approvalReceipt),
    };
  };
  bind();
  const calls = [];
  const claim = async (input) => {
    calls.push(input);
    const bucket = Math.floor(time / 3600000);
    const key = `${input.identity}:${input.action}:${bucket}`;
    const count = (shared.get(key) ?? 0) + 1;
    shared.set(key, count);
    return {
      allowed: count <= input.limit,
      retryAfter: Math.ceil(((bucket + 1) * 3600000 - time) / 1000),
    };
  };
  const build = (overrides = {}) =>
    createGenerationAcceptanceGuard({
      getConfig: () => config,
      claim,
      now: () => time,
      ...overrides,
    });
  const scope = () => ({
    ownerId: plan.ownerId,
    chatId: plan.chatId,
    operationId: plan.operationId,
  });
  const ai = (guard, extra = {}) =>
    guard.run(scope(), () =>
      guard.openAI({
        provider: "openai",
        path: "/responses",
        body: quotedBody,
        ...extra,
      }),
    );
  const speech = (guard, extra = {}) =>
    guard.run(scope(), () =>
      guard.speech({
        ownerId: plan.ownerId,
        chatId: plan.chatId,
        messageId: "assistant-1",
        voiceId: "fixtureVoice",
        modelId: "eleven_multilingual_v2",
        text: "Kova speech test.",
        ...extra,
      }),
    );
  return {
    plan,
    bind,
    build,
    ai,
    speech,
    scope,
    calls,
    shared,
    get config() {
      return config;
    },
    set config(value) {
      config = value;
    },
    get time() {
      return time;
    },
    set time(value) {
      time = value;
    },
  };
}
