// Centralized, server-only AI model router.
//
// Every model choice in KovaGPT flows through routeModel(). The frontend can
// request a mode (instant/thinking/deep) but can never name a model, and the
// router always picks the cheapest model capable of the task.
//
// Pure and dependency-free so it can be unit tested with node:test.

import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  MODE_MAX_OUTPUT_TOKENS,
  ROUTING_THRESHOLDS,
  UTILITY_MAX_OUTPUT_TOKENS,
  costPerMTok,
  getModelConfig,
} from "./model-config.mjs";

/** @typedef {import("./model-config.mjs").ModelRole} ModelRole */

export const UTILITY_TASKS = /** @type {const} */ ([
  "chat_title",
  "summary",
  "memory_summary",
  "classification",
  "json_format",
  "keyword_extraction",
  "language_detection",
  "sentiment",
  "safety_label",
  "search_query",
  "suggestion",
]);

const UTILITY_TASK_SET = new Set(UTILITY_TASKS);

const ADVANCED_MODES = new Set(["thinking", "high", "extra_high", "pro"]);
const PREMIUM_MODES = new Set(["extra_high", "pro"]);

// Signals that extra reasoning will noticeably improve the answer. Length is
// deliberately NOT one of them.
const COMPLEXITY_PATTERNS = [
  {
    weight: 2,
    re: /\b(refactor|multi[- ]?file|monorepo|migrate this codebase|architect(ure)?)\b/i,
  },
  { weight: 2, re: /\b(debug|stack trace|race condition|memory leak|deadlock|regression)\b/i },
  { weight: 2, re: /\b(prove|proof|theorem|derive|optimi[sz]ation problem|np[- ]hard)\b/i },
  { weight: 2, re: /\b(research report|literature review|synthesi[sz]e|cross[- ]reference)\b/i },
  { weight: 2, re: /\b(financial model|valuation|dcf|cap table|forecast model)\b/i },
  { weight: 2, re: /\b(legal|contract|clause|liability|compliance|regulat(ion|ory))\b/i },
  { weight: 1, re: /\b(algorithm design|time complexity|big[- ]o|distributed system)\b/i },
  { weight: 1, re: /\b(business strategy|go[- ]to[- ]market|roadmap|risk analysis)\b/i },
  { weight: 1, re: /\b(step[- ]by[- ]step reasoning|think carefully|be rigorous|edge cases)\b/i },
  { weight: 1, re: /\b(spreadsheet formula|array formula|sql query plan|regex that)\b/i },
  { weight: 1, re: /\b(scientific|clinical|pharmacolog|thermodynamic|quantum)\b/i },
  { weight: 1, re: /\b(compare (?:all|every|the) \d+|trade[- ]offs? between)\b/i },
];

/**
 * @param {number} chars
 * @returns {number}
 */
export function approxTokens(chars) {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / 4);
}

/**
 * @param {string} modelId
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @returns {number} estimated USD cost
 */
export function estimateCostUsd(modelId, inputTokens, outputTokens) {
  const cost = costPerMTok(modelId);
  const safeInput = Math.max(0, inputTokens);
  const safeOutput = Math.max(0, outputTokens);
  const longContext = modelId.startsWith("gpt-5.6-") && safeInput > 272_000;
  const value =
    (safeInput / 1_000_000) * cost.input * (longContext ? 2 : 1) +
    (safeOutput / 1_000_000) * cost.output * (longContext ? 1.5 : 1);
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * @param {string} text
 * @param {{ contextChars?: number, attachmentCount?: number, historyTurns?: number, needsTools?: boolean }} [signals]
 * @returns {{ score: number, reasons: string[] }}
 */
export function scoreComplexity(text, signals = {}) {
  const prompt = typeof text === "string" ? text : "";
  let score = 0;
  /** @type {string[]} */
  const reasons = [];
  for (const { weight, re } of COMPLEXITY_PATTERNS) {
    if (re.test(prompt)) {
      score += weight;
      reasons.push(`signal:${re.source.slice(0, 24)}`);
    }
  }
  if ((signals.contextChars ?? 0) >= ROUTING_THRESHOLDS.contextUpgradeChars) {
    score += 1;
    reasons.push("large_context");
  }
  if ((signals.attachmentCount ?? 0) >= ROUTING_THRESHOLDS.attachmentUpgradeCount) {
    score += 1;
    reasons.push("multi_attachment");
  }
  if ((signals.historyTurns ?? 0) >= ROUTING_THRESHOLDS.historyUpgradeTurns) {
    score += 1;
    reasons.push("deep_history");
  }
  if (signals.needsTools) {
    score += 1;
    reasons.push("tool_use");
  }
  return { score, reasons: reasons.slice(0, 8) };
}

/**
 * @typedef {Object} RouteInput
 * @property {"chat"|"utility"|"deep_research"|"image_generation"|"image_analysis"|"embedding"} task
 * @property {string} [utilityTask]
 * @property {string} [mode]
 * @property {"free"|"plus"|"pro"|"business"} [tier]
 * @property {boolean} [deepMode]
 * @property {boolean} [hasImages]
 * @property {boolean} [needsTools]
 * @property {string} [text]
 * @property {number} [contextChars]
 * @property {number} [attachmentCount]
 * @property {number} [historyTurns]
 * @property {Record<string, string | undefined>} [env]
 */

/**
 * @param {RouteInput} input
 * @returns {{
 *   role: ModelRole,
 *   modelId: string,
 *   maxOutputTokens: number,
 *   complexityScore: number,
 *   reasons: string[],
 *   estimatedCostUsd: number,
 *   downgradedFrom?: ModelRole,
 * }}
 */
export function routeModel(input) {
  const env = input.env ?? {};
  const config = getModelConfig(env);
  const tier = input.tier ?? "free";
  const mode = typeof input.mode === "string" ? input.mode : "instant";

  /** @param {ModelRole} role @param {number} maxOutputTokens @param {string[]} reasons @param {number} score @param {ModelRole=} downgradedFrom */
  const decide = (role, maxOutputTokens, reasons, score, downgradedFrom) => {
    const modelId = config[role];
    return {
      role,
      modelId,
      maxOutputTokens,
      complexityScore: score,
      reasons,
      estimatedCostUsd: estimateCostUsd(
        modelId,
        approxTokens(input.contextChars ?? input.text?.length ?? 0),
        maxOutputTokens,
      ),
      ...(downgradedFrom ? { downgradedFrom } : {}),
    };
  };

  // Utility work is always cheapest-model work, regardless of tier or mode.
  if (input.task === "utility" || (input.utilityTask && UTILITY_TASK_SET.has(input.utilityTask))) {
    return decide("UTILITY", UTILITY_MAX_OUTPUT_TOKENS, ["utility_task"], 0);
  }
  if (input.task === "image_generation") {
    return decide("IMAGE_GENERATION", 0, ["image_generation"], 0);
  }
  if (input.task === "embedding") {
    return decide("EMBEDDING", 0, ["embedding"], 0);
  }

  const modeCap = MODE_MAX_OUTPUT_TOKENS[mode] ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const { score, reasons } = scoreComplexity(input.text ?? "", {
    contextChars: input.contextChars,
    attachmentCount: input.attachmentCount,
    historyTurns: input.historyTurns,
    needsTools: input.needsTools,
  });

  const explicitDeep = Boolean(input.deepMode) || PREMIUM_MODES.has(mode);
  const premiumAllowed = tier === "pro" || tier === "business";

  // PREMIUM_REASONING requires explicit user intent AND a paid premium tier.
  // It is never selected automatically, and never for free users.
  if (explicitDeep || input.task === "deep_research") {
    if (premiumAllowed) {
      return decide("PREMIUM_REASONING", modeCap, [...reasons, "explicit_deep_mode"], score);
    }
    // Fail safe by downgrading rather than refusing the request.
    const role = tier === "plus" ? "ADVANCED_REASONING" : "DEFAULT_CHAT";
    return decide(
      role,
      role === "DEFAULT_CHAT" ? Math.min(modeCap, MODE_MAX_OUTPUT_TOKENS.medium) : modeCap,
      [...reasons, "premium_not_entitled"],
      score,
      "PREMIUM_REASONING",
    );
  }

  // ADVANCED_REASONING: explicit thinking modes, or genuinely complex work.
  const complexEnough = score >= ROUTING_THRESHOLDS.advancedComplexityScore;
  if (ADVANCED_MODES.has(mode) || complexEnough) {
    if (tier === "free" && !ADVANCED_MODES.has(mode)) {
      // Free users stay on the default model for auto-upgrades.
      return decide(
        "DEFAULT_CHAT",
        modeCap,
        [...reasons, "auto_upgrade_blocked_free"],
        score,
        "ADVANCED_REASONING",
      );
    }
    return decide(
      "ADVANCED_REASONING",
      modeCap,
      [...reasons, ADVANCED_MODES.has(mode) ? "explicit_thinking_mode" : "complexity_upgrade"],
      score,
    );
  }

  if (input.hasImages || input.task === "image_analysis") {
    return decide("IMAGE_ANALYSIS", modeCap, [...reasons, "image_understanding"], score);
  }

  return decide("DEFAULT_CHAT", modeCap, [...reasons, "default_cheapest"], score);
}
