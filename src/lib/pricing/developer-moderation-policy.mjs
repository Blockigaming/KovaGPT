const standardModels = new Set(["omni-moderation-latest", "omni-moderation-2024-09-26"]);
export function validModerationRequest(body) {
  return (
    !!body &&
    standardModels.has(body.model) &&
    Object.keys(body).length === 2 &&
    typeof body.input === "string" &&
    !!body.input.trim() &&
    body.input.length <= 8000 &&
    !body.input.includes("\0")
  );
}

export function validModerationResult(response) {
  if (
    !response ||
    !standardModels.has(response.model) ||
    !Array.isArray(response.results) ||
    response.results.length !== 1
  )
    return false;
  const result = response.results[0];
  const categories = result?.categories;
  const scores = result?.category_scores;
  if (
    typeof result?.flagged !== "boolean" ||
    !categories ||
    typeof categories !== "object" ||
    Array.isArray(categories) ||
    !scores ||
    typeof scores !== "object" ||
    Array.isArray(scores)
  )
    return false;
  const keys = Object.keys(categories);
  return (
    keys.length >= 1 &&
    keys.length <= 64 &&
    keys.length === Object.keys(scores).length &&
    keys.every(
      (key) =>
        /^[a-z][a-z0-9/-]{0,63}$/.test(key) &&
        typeof categories[key] === "boolean" &&
        typeof scores[key] === "number" &&
        Number.isFinite(scores[key]) &&
        scores[key] >= 0 &&
        scores[key] <= 1,
    ) &&
    result.flagged === keys.some((key) => categories[key])
  );
}
