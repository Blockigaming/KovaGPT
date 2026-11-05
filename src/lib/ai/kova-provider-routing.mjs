/**
 * Pure routing policy for a gradual Kova inference migration.
 * No network requests, credentials, or production provider changes here.
 * A caller must run health checks and enforce the resulting provider choice.
 */
import { KOVA_MODEL_CATALOG } from "./kova-model-migration.mjs";

const MODEL_IDS = new Set(Object.values(KOVA_MODEL_CATALOG).map((model) => model.id));
const SAFE_CAPABILITIES = new Set([
  "chat",
  "streaming",
  "reasoning",
  "tool_calls",
  "vision",
  "file_analysis",
  "web_search",
  "embeddings",
  "image_generation",
]);

export function normalizeMigrationConfig(config = {}) {
  const percent = Number(config.rolloutPercent ?? 0);
  const rolloutPercent = Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : 0;
  return {
    enabled: config.enabled === true,
    rolloutPercent,
    emergencyRollback: config.emergencyRollback === true,
  };
}

/**
 * Stable bucket [0, 99] from an opaque user/request routing key.
 * Callers should use a pseudonymous stable key; never log the raw key.
 */
export function migrationBucket(key) {
  if (typeof key !== "string" || !key) return null;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

export function chooseKovaProvider({
  modelId,
  routingKey,
  requiredCapabilities = ["chat", "streaming"],
  verifiedCapabilities = [],
  healthy = false,
  config = {},
} = {}) {
  const settings = normalizeMigrationConfig(config);
  const bucket = migrationBucket(routingKey);
  if (
    !MODEL_IDS.has(modelId) ||
    !settings.enabled ||
    settings.emergencyRollback ||
    !healthy ||
    bucket === null ||
    bucket >= settings.rolloutPercent ||
    !Array.isArray(requiredCapabilities) ||
    !Array.isArray(verifiedCapabilities) ||
    requiredCapabilities.some(
      (capability) =>
        !SAFE_CAPABILITIES.has(capability) || !verifiedCapabilities.includes(capability),
    )
  ) {
    return { provider: "existing", reason: "migration_not_eligible" };
  }
  return { provider: "kova_self_hosted", reason: "canary_eligible" };
}
