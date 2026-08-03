// SINGLE SOURCE OF TRUTH for AI model selection.
//
// Business logic never names a model. It asks for a logical role
// (DEFAULT_CHAT, ADVANCED_REASONING, PREMIUM_REASONING, UTILITY,
// IMAGE_ANALYSIS, IMAGE_GENERATION, EMBEDDING) and this file decides which
// concrete model id serves that role. Upgrading to a future model generation
// is a change to this file (or to the matching environment variable) only.
//
// This module is intentionally dependency-free and pure so it can be unit
// tested directly with node:test.

/** @typedef {"DEFAULT_CHAT"|"ADVANCED_REASONING"|"PREMIUM_REASONING"|"UTILITY"|"IMAGE_ANALYSIS"|"IMAGE_GENERATION"|"EMBEDDING"} ModelRole */

export const MODEL_ROLES = /** @type {const} */ ([
  "DEFAULT_CHAT",
  "ADVANCED_REASONING",
  "PREMIUM_REASONING",
  "UTILITY",
  "IMAGE_ANALYSIS",
  "IMAGE_GENERATION",
  "EMBEDDING",
]);

// Cheapest-capable-first defaults. Luna handles 90-95% of traffic.
export const DEFAULT_MODELS = Object.freeze({
  DEFAULT_CHAT: "gpt-5.6-luna",
  ADVANCED_REASONING: "gpt-5.6-terra",
  PREMIUM_REASONING: "gpt-5.6-sol",
  UTILITY: "gpt-5.6-luna",
  IMAGE_ANALYSIS: "gpt-5.6-luna",
  IMAGE_GENERATION: "gpt-image-1",
  EMBEDDING: "text-embedding-3-small",
});

// Environment override per role. Set any of these to migrate without a deploy
// of new application logic.
export const ROLE_ENV_KEYS = Object.freeze({
  DEFAULT_CHAT: "KOVA_MODEL_DEFAULT_CHAT",
  ADVANCED_REASONING: "KOVA_MODEL_ADVANCED_REASONING",
  PREMIUM_REASONING: "KOVA_MODEL_PREMIUM_REASONING",
  UTILITY: "KOVA_MODEL_UTILITY",
  IMAGE_ANALYSIS: "KOVA_MODEL_IMAGE_ANALYSIS",
  IMAGE_GENERATION: "KOVA_MODEL_IMAGE_GENERATION",
  EMBEDDING: "KOVA_MODEL_EMBEDDING",
});

// USD per 1M tokens. Used for cost estimates in routing logs only; it never
// changes which model is selected. Unknown models fall back to the
// DEFAULT_CHAT price so estimates stay conservative instead of throwing.
export const MODEL_COST_PER_MTOK = Object.freeze({
  "gpt-5.6-luna": { input: 0.1, output: 0.4 },
  "gpt-5.6-terra": { input: 1.25, output: 10 },
  "gpt-5.6-sol": { input: 5, output: 40 },
  "gpt-image-1": { input: 5, output: 40 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
});

// Cost controls. Output caps are the dominant lever on spend.
export const MODE_MAX_OUTPUT_TOKENS = Object.freeze({
  instant: 700,
  medium: 1600,
  thinking: 3000,
  high: 4000,
  extra_high: 6000,
  pro: 8000,
});

export const UTILITY_MAX_OUTPUT_TOKENS = 256;
export const DEFAULT_MAX_OUTPUT_TOKENS = 1600;

export const ROUTING_THRESHOLDS = Object.freeze({
  // Complexity score at or above which DEFAULT_CHAT is upgraded to
  // ADVANCED_REASONING.
  advancedComplexityScore: 3,
  // Long context alone never upgrades a model; it only contributes one point
  // toward the complexity score.
  contextUpgradeChars: 24_000,
  // Attachment payloads that imply real document analysis.
  attachmentUpgradeCount: 2,
  // Conversation depth that implies sustained multi-step work.
  historyUpgradeTurns: 24,
});

const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/i;

/**
 * Model ids are configuration, so an invalid or placeholder value must fail
 * safe (fall back to the built-in default) instead of reaching the provider.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidModelId(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!MODEL_ID_PATTERN.test(trimmed)) return false;
  if (/^(undefined|null|none|todo|changeme|your[-_]?model)$/i.test(trimmed)) return false;
  return true;
}

/**
 * @param {ModelRole} role
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ modelId: string, source: "env" | "default", invalidOverride?: string }}
 */
export function resolveRoleModel(role, env = {}) {
  const fallback = DEFAULT_MODELS[role];
  const key = ROLE_ENV_KEYS[role];
  const raw = key ? env[key] : undefined;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return { modelId: fallback, source: "default" };
  }
  if (!isValidModelId(raw)) {
    return { modelId: fallback, source: "default", invalidOverride: String(raw).slice(0, 64) };
  }
  return { modelId: String(raw).trim(), source: "env" };
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {Record<ModelRole, string>}
 */
export function getModelConfig(env = {}) {
  /** @type {Record<string, string>} */
  const config = {};
  for (const role of MODEL_ROLES) config[role] = resolveRoleModel(role, env).modelId;
  return /** @type {Record<ModelRole, string>} */ (config);
}

/**
 * @param {string} modelId
 * @returns {{ input: number, output: number }}
 */
export function costPerMTok(modelId) {
  return MODEL_COST_PER_MTOK[modelId] ?? MODEL_COST_PER_MTOK[DEFAULT_MODELS.DEFAULT_CHAT];
}
