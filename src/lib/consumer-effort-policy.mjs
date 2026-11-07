/** Six product efforts. `thinking` retains the existing Medium usage-ledger ID. */
export const CONSUMER_EFFORTS = Object.freeze(
  [
    {
      id: "instant",
      label: "Lite",
      outputTokens: 700,
      reviewTokens: 0,
      reviews: 0,
      effort: "none",
    },
    {
      id: "thinking",
      label: "Medium",
      outputTokens: 1400,
      reviewTokens: 192,
      reviews: 0,
      effort: "low",
    },
    {
      id: "high",
      label: "High",
      outputTokens: 2400,
      reviewTokens: 384,
      reviews: 1,
      effort: "high",
    },
    {
      id: "extra_high",
      label: "Extra High",
      outputTokens: 3200,
      reviewTokens: 512,
      reviews: 2,
      effort: "high",
    },
    { id: "max", label: "Max", outputTokens: 4000, reviewTokens: 768, reviews: 3, effort: "max" },
    {
      id: "ultra",
      label: "Ultra",
      outputTokens: 4800,
      reviewTokens: 1536,
      reviews: 4,
      effort: "max",
    },
  ].map(Object.freeze),
);

export function consumerEffort(mode) {
  return (
    CONSUMER_EFFORTS.find((item) => item.id === (mode === "medium" ? "thinking" : mode)) ?? null
  );
}

export function hostedEffortProfile(model, mode) {
  const profile = consumerEffort(mode);
  if (!profile || !["kova-argon-4.6", "kova-neon-4.6", "kova-xenon-5"].includes(model))
    throw new Error("invalid_hosted_effort");
  const nativeReasoning = model !== "kova-neon-4.6";
  return {
    ...profile,
    nativeReasoning,
    reviews:
      profile.reviews + (!nativeReasoning && !["instant", "ultra"].includes(profile.id) ? 1 : 0),
    parallel: profile.id === "ultra",
  };
}

/** Reserve every review and the final answer before any billable call starts.
 * One bounded note consumes at most reviewTokens*8 UTF-8 bytes. The estimator's
 * conservative bytes/2 bound therefore reserves four tokens per review token.
 */
export function hostedEffortBudget(model, mode, inputTokens, outputTokens, outerCalls = 1) {
  const p = hostedEffortProfile(model, mode);
  const n = p.reviews;
  const noteTokens = p.reviewTokens * 4;
  const reviewInputs = n * (inputTokens + 512) + (p.parallel ? 0 : Math.max(0, n - 1) * noteTokens);
  const finalInput = inputTokens + n * noteTokens + (n ? 512 : 0);
  const input = reviewInputs + finalInput + Math.max(0, outerCalls - 1) * inputTokens;
  const output = n * p.reviewTokens + outerCalls * outputTokens;
  return {
    inputTokens: input,
    outputTokens: output,
    reservedTokens: input + output,
    providerCalls: outerCalls + n,
  };
}
