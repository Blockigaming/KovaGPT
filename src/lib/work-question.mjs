export function parseWorkQuestionOptions(value) {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    value.length > 6 ||
    value.some(
      (option) =>
        typeof option !== "string" ||
        !option.trim() ||
        option.length > 300 ||
        /\u0000/.test(option),
    ) ||
    new Set(value.map((option) => option.trim())).size !== value.length
  )
    throw Error("work_question_options_invalid");
  return value.map((option) => option.trim());
}
