/**
 * Stable customer-facing Kova model identities.
 *
 * This module deliberately does not alter production provider selection.
 * Underlying model IDs are configured server-side and must never be inferred
 * from customer-facing aliases.
 */
export const KOVA_MODEL_CATALOG = Object.freeze({
  xenon: Object.freeze({
    id: "kova-xenon-5",
    name: "Kova Xenon 5",
    tier: "flagship",
    purpose: "Advanced reasoning, coding and multi-step agents",
  }),
  neon: Object.freeze({
    id: "kova-neon-4.6",
    name: "Kova Neon 4.6",
    tier: "balanced",
    purpose: "General chat, research and connected tools",
  }),
  argon: Object.freeze({
    id: "kova-argon-4.6",
    name: "Kova Argon 4.6",
    tier: "fast",
    purpose: "Low-latency chat and lightweight reasoning",
  }),
  legacy0: Object.freeze({
    id: "kova-argon-4.5",
    name: "Kova Argon 4.5",
    tier: "flagship",
    purpose: "Previous-generation model",
  }),
  legacy1: Object.freeze({
    id: "kova-neon-4.5",
    name: "Kova Neon 4.5",
    tier: "flagship",
    purpose: "Previous-generation model",
  }),
  legacy2: Object.freeze({
    id: "kova-xenon-4.6",
    name: "Kova Xenon 4.6",
    tier: "flagship",
    purpose: "Previous-generation model",
  }),
  legacy3: Object.freeze({
    id: "kova-xenon-6.1",
    name: "Kova Xenon 6.1",
    tier: "flagship",
    purpose: "Most capable reasoning",
  }),
});

export const KOVA_SELF_HOSTED_DEFAULT_ENABLED = false;

export function resolveKovaModelAlias(alias) {
  return (
    Object.values(KOVA_MODEL_CATALOG).find((model) => model.id === alias || model.name === alias) ??
    null
  );
}

/**
 * A request may be routed to self-hosted infrastructure only after the
 * operator enables it, the target is healthy, and the required capabilities
 * have been verified. Unknown capabilities fail closed.
 */
export function eligibleForSelfHosted({
  enabled = false,
  healthy = false,
  requiredCapabilities = [],
  verifiedCapabilities = [],
} = {}) {
  return (
    enabled === true &&
    healthy === true &&
    Array.isArray(requiredCapabilities) &&
    Array.isArray(verifiedCapabilities) &&
    requiredCapabilities.every(
      (capability) => typeof capability === "string" && verifiedCapabilities.includes(capability),
    )
  );
}
