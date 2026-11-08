/** Owner-approved interim OpenAI foundations. Public metadata, no transport or credentials. */
export const HOSTED_MODEL_MAP = Object.freeze({
  "kova-xenon-5": "gpt-6.1-sol",
  "kova-neon-4.6": "gpt-6.1-terra",
  "kova-argon-4.6": "gpt-6-luna",
  "kova-argon-4.5": "gpt-5.6-luna",
  "kova-neon-4.5": "gpt-5.6-terra",
  "kova-xenon-4.6": "gpt-6-sol",
  "kova-xenon-6.1": "gpt-6-astra",
});

export const KOVA_MODEL_LABELS = Object.freeze({
  "kova-argon-4.6": "Kova Argon 4.6",
  "kova-neon-4.6": "Kova Neon 4.6",
  "kova-xenon-5": "Kova Xenon 5",
  "kova-argon-4.5": "Kova Argon 4.5",
  "kova-neon-4.5": "Kova Neon 4.5",
  "kova-xenon-4.6": "Kova Xenon 4.6",
  "kova-xenon-6.1": "Kova Xenon 6.1",
});
export function supportedKovaReasoningEfforts(model) {
  if (!Object.hasOwn(HOSTED_MODEL_MAP, model)) throw new Error("unknown_kova_model");
  return ["gpt-6.1-sol", "gpt-6-astra"].includes(HOSTED_MODEL_MAP[model])
    ? ["low", "medium", "high", "xhigh", "max"]
    : ["none", "low", "medium", "high", "xhigh", "max"];
}
export function resolveKovaReasoningEffort(model, effort = "none") {
  const allowed = supportedKovaReasoningEfforts(model);
  if (effort === "none" && !allowed.includes("none")) return "low";
  if (!allowed.includes(effort)) throw new Error("invalid_hosted_effort");
  return effort;
}
