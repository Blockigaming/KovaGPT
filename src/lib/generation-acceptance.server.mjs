import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

export const ACCEPTANCE_PROMPT = "Reply exactly: Kova speech test.";
const SHA = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const HOUR = 3_600_000;
const fail = () => Object.assign(new Error("generation_acceptance_denied"), { status: 503 });
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const money = (n) => typeof n === "string" && /^(0|[1-9]\d{0,17})$/u.test(n);
const canonical = (v) => {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical(v[k])]),
    );
  return v;
};
export const acceptanceDigest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
const ceilDivide = (n, d) => (n + d - 1n) / d;

// Rates and the exact final-input token count are external, reviewed facts.
// Their booleans are deliberately not accepted as proof. The operator must bind
// the reviewed plan AND actual authorization receipt by independently expected
// hashes. This module cannot authenticate an account price or owner approval.
function reviewed(config, now) {
  const plan = config.plan;
  const receipt = config.approvalReceipt;
  if (
    !plan ||
    !receipt ||
    !SHA.test(config.expectedPlanSha256 ?? "") ||
    acceptanceDigest(plan) !== config.expectedPlanSha256 ||
    !SHA.test(config.expectedApprovalReceiptSha256 ?? "") ||
    acceptanceDigest(receipt) !== config.expectedApprovalReceiptSha256
  )
    throw fail();
  const { openAI: ai, speech, quote, target } = plan;
  if (
    plan.version !== 1 ||
    !UUID.test(plan.operationId ?? "") ||
    !UUID.test(plan.ownerId ?? "") ||
    !UUID.test(plan.chatId ?? "") ||
    !integer(plan.notBefore, 1, Number.MAX_SAFE_INTEGER) ||
    !integer(plan.expiresAt, 1, Number.MAX_SAFE_INTEGER) ||
    plan.expiresAt <= plan.notBefore ||
    plan.expiresAt - plan.notBefore > 180_000 ||
    now < plan.notBefore ||
    now >= plan.expiresAt ||
    Math.floor(plan.notBefore / HOUR) !== Math.floor(plan.expiresAt / HOUR) ||
    plan.expiresAt > (Math.floor(plan.notBefore / HOUR) + 1) * HOUR - 30_000 ||
    target?.environment !== "ca-kovagpt-staging" ||
    !/^[a-f0-9]{40}$/u.test(target.commit ?? "") ||
    !/^[a-f0-9]{40}$/u.test(target.tree ?? "") ||
    !/^sha256:[a-f0-9]{64}$/u.test(target.imageDigest ?? "") ||
    typeof target.revision !== "string" ||
    !/^[A-Za-z0-9._-]{1,120}$/u.test(target.revision) ||
    !SHA.test(target.configurationEvidenceSha256 ?? "") ||
    ai?.model !== "gpt-5.6-luna" ||
    ai.maximumOutputTokens !== 64 ||
    ai.userPrompt !== ACCEPTANCE_PROMPT ||
    !SHA.test(ai.bodySha256 ?? "") ||
    !SHA.test(ai.tokenCountEvidenceSha256 ?? "") ||
    !integer(ai.verifiedInputTokens, 1, 8192) ||
    !integer(ai.maximumInputUtf8Bytes, 1, 32768) ||
    speech?.model !== "eleven_multilingual_v2" ||
    speech.maximumTextCharacters !== 120 ||
    !/^[A-Za-z0-9_-]{1,80}$/u.test(speech.voiceId ?? "") ||
    quote?.currency !== "USD" ||
    quote.unit !== "nanoUSD" ||
    !SHA.test(quote.pricingEvidenceSha256 ?? "") ||
    !integer(quote.verifiedAt, 1, now) ||
    !integer(quote.validUntil, plan.expiresAt, Number.MAX_SAFE_INTEGER) ||
    !money(quote.inputPerMillion) ||
    !money(quote.outputPerMillion) ||
    !money(quote.speechPerCharacter) ||
    !money(quote.maximumTotal) ||
    BigInt(quote.inputPerMillion) === 0n ||
    BigInt(quote.outputPerMillion) === 0n ||
    BigInt(quote.speechPerCharacter) === 0n ||
    receipt.version !== 1 ||
    receipt.planSha256 !== config.expectedPlanSha256 ||
    receipt.approvedMaximumCostNanos !== quote.maximumTotal ||
    !SHA.test(receipt.authorizationEvidenceSha256 ?? "") ||
    !integer(receipt.approvedAt, 1, plan.notBefore) ||
    !integer(receipt.expiresAt, plan.expiresAt, Number.MAX_SAFE_INTEGER)
  )
    throw fail();
  const maximum =
    ceilDivide(BigInt(ai.verifiedInputTokens) * BigInt(quote.inputPerMillion), 1_000_000n) +
    ceilDivide(64n * BigInt(quote.outputPerMillion), 1_000_000n) +
    120n * BigInt(quote.speechPerCharacter);
  if (maximum > BigInt(quote.maximumTotal)) throw fail();
  return { plan: JSON.parse(JSON.stringify(plan)), hash: config.expectedPlanSha256 };
}

/**
 * Off by default. When enabled this is a global final-provider admission fence:
 * every provider call must be inside run() with a verified server-side owner.
 * claim MUST use the durable, atomic application limiter; in-memory substitutes
 * are test fixtures only. A claimed slot is never refunded for any outcome.
 */
export function createGenerationAcceptanceGuard({ getConfig, claim, now = Date.now }) {
  const context = new AsyncLocalStorage();
  const current = () => {
    try {
      const config = getConfig();
      if (!config || config.enabled === false) return null;
      if (config.enabled !== true) throw fail();
      return reviewed(config, now());
    } catch {
      throw fail();
    }
  };
  const checkScope = (review) => {
    const scope = context.getStore();
    if (
      !scope ||
      scope.hash !== review.hash ||
      scope.ownerId !== review.plan.ownerId ||
      scope.chatId !== review.plan.chatId ||
      scope.operationId !== review.plan.operationId
    )
      throw fail();
  };
  const consume = async (review, provider, signal) => {
    checkScope(review);
    if (signal?.aborted) throw fail();
    let result;
    try {
      result = await claim({
        identity: `acceptance:${review.plan.operationId}:${review.hash}`,
        action: `acceptance_${provider}`,
        limit: 1,
        windowSeconds: 3600,
      });
    } catch {
      throw fail();
    }
    // Recheck after network admission. The expiry and generous bucket-end
    // margin prevent a delayed claim from crossing into a fresh valid bucket.
    const again = current();
    if (
      !again ||
      again.hash !== review.hash ||
      !result?.allowed ||
      !integer(result.retryAfter, 1, 3600) ||
      result.retryAfter < Math.ceil((review.plan.expiresAt - now()) / 1000) + 5
    )
      throw fail();
    checkScope(again);
    if (signal?.aborted) throw fail();
    return { maximumCostNanos: review.plan.quote.maximumTotal, expiresAt: review.plan.expiresAt };
  };
  return {
    run(scope, operation) {
      const review = current();
      if (!review) return operation();
      if (
        scope?.ownerId !== review.plan.ownerId ||
        scope.chatId !== review.plan.chatId ||
        scope.operationId !== review.plan.operationId
      )
        throw fail();
      return context.run({ ...scope, hash: review.hash }, operation);
    },
    async openAI({ provider, path, body, signal }) {
      const review = current();
      if (!review) return null;
      const { openAI: ai } = review.plan;
      if (!integer(body?.max_output_tokens, 1, 128000)) throw fail();
      let boundedBody;
      try {
        boundedBody = JSON.parse(
          JSON.stringify({
            ...body,
            max_output_tokens: Math.min(body.max_output_tokens, 64),
          }),
        );
      } catch {
        throw fail();
      }
      const allowedFields = new Set([
        "model",
        "input",
        "instructions",
        "stream",
        "store",
        "service_tier",
        "max_output_tokens",
        "reasoning",
      ]);
      if (
        Object.keys(body).some((key) => !allowedFields.has(key)) ||
        provider !== "openai" ||
        path !== "/responses" ||
        body?.model !== ai.model ||
        body.stream !== true ||
        body.store !== false ||
        body.service_tier !== "default" ||
        boundedBody.max_output_tokens !== 64 ||
        body.tools !== undefined ||
        body.tool_choice !== undefined ||
        !Array.isArray(body.input) ||
        body.input.length !== 1 ||
        body.input[0]?.role !== "user" ||
        Object.keys(body.input[0]).some((key) => key !== "role" && key !== "content") ||
        body.input[0]?.content !== ACCEPTANCE_PROMPT ||
        Buffer.byteLength(JSON.stringify(boundedBody), "utf8") > ai.maximumInputUtf8Bytes ||
        acceptanceDigest(boundedBody) !== ai.bodySha256
      )
        throw fail();
      return { ...(await consume(review, "openai", signal)), body: boundedBody };
    },
    async speech({ ownerId, chatId, messageId, voiceId, modelId, text, signal }) {
      const review = current();
      if (!review) return null;
      const { speech } = review.plan;
      if (
        ownerId !== review.plan.ownerId ||
        chatId !== review.plan.chatId ||
        typeof messageId !== "string" ||
        !/^[A-Za-z0-9._:-]{1,200}$/u.test(messageId) ||
        voiceId !== speech.voiceId ||
        modelId !== speech.model ||
        typeof text !== "string" ||
        text.length < 1 ||
        text.length > 120 ||
        !/^[\x20-\x7e\n\r\t]+$/u.test(text)
      )
        throw fail();
      return consume(review, "elevenlabs", signal);
    },
  };
}
