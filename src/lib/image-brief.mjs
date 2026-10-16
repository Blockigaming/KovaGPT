export const EMPTY_IMAGE_BRIEF = Object.freeze({ prompt: "", aspectRatio: "1:1", inspiration: "" });
export function isImageBrief(v) {
  return Boolean(
    v &&
    typeof v.prompt === "string" &&
    v.prompt.length <= 2000 &&
    ["1:1", "2:3", "3:2"].includes(v.aspectRatio) &&
    typeof v.inspiration === "string" &&
    v.inspiration.length <= 120,
  );
}
export function replaceImageBrief(before, suggestion) {
  return {
    ...before,
    prompt: suggestion.prompt.slice(0, 2000),
    inspiration: suggestion.label.slice(0, 120),
  };
}
export function undoImageBrief(current, operation) {
  if (JSON.stringify(current) !== JSON.stringify(operation.after))
    throw new Error(
      "Your image brief changed after replacement. Keep the current draft, or copy the previous brief before editing it yourself.",
    );
  return operation.before;
}
