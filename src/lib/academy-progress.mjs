export const ACADEMY_CATEGORIES = Object.freeze(["all", "core", "roles", "workflows"]);
export function academyCategory(slug) {
  if (
    /^(?:ai-fundamentals|what-is-ai|responsible-and-safe-use|using-chatgpt|prompting|skills)$/.test(
      slug,
    )
  )
    return "core";
  if (/^(?:chatgpt-for-|champion-programs|sales$|marketing$|operations$|hr$|finance$)/.test(slug))
    return "roles";
  return "workflows";
}
export function academyReturnSearch(search) {
  return {
    q: typeof search.academyQ === "string" ? search.academyQ.slice(0, 200) : "",
    category: ACADEMY_CATEGORIES.includes(search.academyCategory) ? search.academyCategory : "all",
  };
}
export const EMPTY_ACADEMY_PROGRESS = Object.freeze({ notes: "", completed: false, checked: [] });
export function isAcademyProgress(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof value.notes === "string" &&
    value.notes.length <= 20000 &&
    typeof value.completed === "boolean" &&
    Array.isArray(value.checked) &&
    value.checked.length <= 100 &&
    value.checked.every((x) => typeof x === "string" && x.length <= 2000),
  );
}
