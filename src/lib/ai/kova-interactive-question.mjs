/**
 * Validates model-proposed interactive chat questions.
 * Pure data only: no HTML, JavaScript, URLs or arbitrary actions.
 * Rendering and submitting an answer requires separate authenticated UI wiring.
 */
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const FIELD_TYPES = new Set(["text", "single_choice", "multiple_choice", "slider", "boolean"]);
const keysOnly = (obj, required, optional = []) =>
  obj &&
  typeof obj === "object" &&
  !Array.isArray(obj) &&
  Object.keys(obj).every((key) => [...required, ...optional].includes(key)) &&
  required.every((key) => Object.hasOwn(obj, key));
const boundedText = (s, max) => typeof s === "string" && s.trim().length > 0 && s.length <= max;

export function validateKovaQuestion(value) {
  if (
    !keysOnly(value, ["version", "type", "title", "fields"]) ||
    value.version !== 1 ||
    value.type !== "question" ||
    !boundedText(value.title, 160) ||
    !Array.isArray(value.fields) ||
    value.fields.length < 1 ||
    value.fields.length > 12
  )
    return null;
  const fields = [];
  for (const field of value.fields) {
    if (
      !keysOnly(field, ["id", "label", "kind"], ["required", "options", "min", "max", "step"]) ||
      typeof field.id !== "string" ||
      !ID.test(field.id) ||
      !boundedText(field.label, 200) ||
      !FIELD_TYPES.has(field.kind) ||
      (field.required !== undefined && typeof field.required !== "boolean")
    )
      return null;
    const choice = field.kind === "single_choice" || field.kind === "multiple_choice";
    if (choice) {
      if (
        !Array.isArray(field.options) ||
        field.options.length < 2 ||
        field.options.length > 12 ||
        field.options.some((o) => !boundedText(o, 100)) ||
        new Set(field.options).size !== field.options.length ||
        ["min", "max", "step"].some((key) => Object.hasOwn(field, key))
      )
        return null;
    } else if (Object.hasOwn(field, "options")) return null;
    if (field.kind === "slider") {
      if (
        ![field.min, field.max, field.step].every(Number.isFinite) ||
        field.min >= field.max ||
        field.step <= 0 ||
        (field.max - field.min) / field.step > 1000
      )
        return null;
    } else if (["min", "max", "step"].some((key) => Object.hasOwn(field, key))) return null;
    fields.push({
      id: field.id,
      label: field.label.trim(),
      kind: field.kind,
      required: field.required === true,
      ...(choice ? { options: [...field.options] } : {}),
      ...(field.kind === "slider" ? { min: field.min, max: field.max, step: field.step } : {}),
    });
  }
  if (new Set(fields.map((f) => f.id)).size !== fields.length) return null;
  return { version: 1, type: "question", title: value.title.trim(), fields };
}

export function validateKovaQuestionAnswers(question, answers) {
  const schema = validateKovaQuestion(question);
  if (
    !schema ||
    !keysOnly(
      answers,
      [],
      schema.fields.map((field) => field.id),
    )
  )
    return null;
  const normalized = {};
  for (const field of schema.fields) {
    const answer = answers[field.id];
    if (answer === undefined || answer === null || answer === "") {
      if (field.required) return null;
      continue;
    }
    if (field.kind === "text" && !(typeof answer === "string" && answer.length <= 4000))
      return null;
    if (field.kind === "boolean" && typeof answer !== "boolean") return null;
    if (field.kind === "single_choice" && !field.options.includes(answer)) return null;
    if (
      field.kind === "multiple_choice" &&
      (!Array.isArray(answer) ||
        answer.length > field.options.length ||
        new Set(answer).size !== answer.length ||
        answer.some((item) => !field.options.includes(item)))
    )
      return null;
    if (
      field.kind === "slider" &&
      (!Number.isFinite(answer) ||
        answer < field.min ||
        answer > field.max ||
        Math.abs(
          (answer - field.min) / field.step - Math.round((answer - field.min) / field.step),
        ) > 1e-7)
    )
      return null;
    normalized[field.id] = answer;
  }
  return normalized;
}
