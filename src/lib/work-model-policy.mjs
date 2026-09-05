/** A logical Work choice is resolved by trusted role configuration, never by a client model ID. */
export const WORK_MODEL_MODES = Object.freeze([
  { id: "instant", label: "Instant", role: "DEFAULT_CHAT", outputCeiling: 1200 },
  { id: "normal", label: "Normal", role: "DEFAULT_CHAT", outputCeiling: 2048 },
  { id: "thinking", label: "Thinking", role: "ADVANCED_REASONING", outputCeiling: 4096 },
  { id: "deep", label: "Deep", role: "PREMIUM_REASONING", outputCeiling: 8192 },
]);
export const WORK_REASONING_EFFORTS = Object.freeze([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export function parseWorkModelChoice(input) {
  const mode = input.mode ?? "normal",
    reasoningEffort = input.reasoningEffort ?? null;
  if (
    !WORK_MODEL_MODES.some((item) => item.id === mode) ||
    (reasoningEffort !== null && !WORK_REASONING_EFFORTS.includes(reasoningEffort))
  )
    throw new Error("work_model_choice_invalid");
  return { mode, reasoningEffort };
}
export function parseWorkModelCapabilities(input) {
  if (!Array.isArray(input) || input.length > 20)
    throw new Error("work_model_capabilities_invalid");
  const ids = new Set();
  return input.map((item) => {
    if (
      !item ||
      Object.keys(item).some(
        (key) => !["model", "reasoningEfforts", "maxOutputTokens"].includes(key),
      ) ||
      typeof item.model !== "string" ||
      !/^[a-zA-Z0-9._:-]{1,100}$/.test(item.model) ||
      ids.has(item.model) ||
      !Array.isArray(item.reasoningEfforts) ||
      item.reasoningEfforts.length > WORK_REASONING_EFFORTS.length ||
      new Set(item.reasoningEfforts).size !== item.reasoningEfforts.length ||
      item.reasoningEfforts.some((effort) => !WORK_REASONING_EFFORTS.includes(effort)) ||
      !Number.isSafeInteger(item.maxOutputTokens) ||
      item.maxOutputTokens < 1 ||
      item.maxOutputTokens > 8192
    )
      throw new Error("work_model_capabilities_invalid");
    ids.add(item.model);
    return {
      model: item.model,
      reasoningEfforts: [...item.reasoningEfforts],
      maxOutputTokens: item.maxOutputTokens,
    };
  });
}
export function workModelOptions({ capabilities, models, roles, plan }) {
  const configured = parseWorkModelCapabilities(capabilities ?? []);
  return WORK_MODEL_MODES.map((mode) => {
    const modelId = roles[mode.role],
      model = models.find((item) => item.id === modelId),
      provider = configured.find((item) => item.model === modelId);
    const reason = !["plus", "pro"].includes(plan)
      ? "Work requires Plus or Pro."
      : mode.id === "deep" && plan !== "pro"
        ? "Deep requires Pro."
        : !model || !model.tools || !model.tiers.includes(plan)
          ? "This model is unavailable for your plan."
          : !provider
            ? "This model is not configured on the connected runner."
            : null;
    return {
      mode: mode.id,
      label: mode.label,
      model: model?.id ?? null,
      available: reason === null,
      reason,
      reasoningEfforts: model?.reasoning && provider ? provider.reasoningEfforts : [],
      maxOutputTokens: Math.min(
        mode.outputCeiling,
        model?.maxOutputTokens ?? 0,
        provider?.maxOutputTokens ?? 0,
      ),
      service: "provider_default",
    };
  });
}
export function selectWorkModel(choice, options) {
  const parsed = parseWorkModelChoice(choice),
    option = options.find((item) => item.mode === parsed.mode);
  if (
    !option?.available ||
    !option.model ||
    (parsed.reasoningEffort !== null && !option.reasoningEfforts.includes(parsed.reasoningEffort))
  )
    throw new Error("work_model_choice_unavailable");
  return {
    model: option.model,
    premium: parsed.mode === "deep",
    selection: { ...parsed, maxOutputTokens: option.maxOutputTokens, service: "provider_default" },
  };
}
export function assertWorkRunnerModel(run, runner) {
  // Historical runs preserve their original provider-default request. New runs
  // carry immutable choices, which may never fall back after configuration drift.
  if (!run.modelSelection) return;
  const models = parseWorkModelCapabilities(runner.modelCapabilities ?? []),
    model = models.find((item) => item.model === run.model),
    choice = run.modelSelection;
  parseWorkModelChoice(choice);
  if (
    !model ||
    choice.service !== "provider_default" ||
    !Number.isSafeInteger(choice.maxOutputTokens) ||
    choice.maxOutputTokens < 1 ||
    choice.maxOutputTokens > model.maxOutputTokens ||
    (choice.reasoningEffort !== null && !model.reasoningEfforts.includes(choice.reasoningEffort))
  )
    throw new Error("work_model_choice_unavailable");
}
