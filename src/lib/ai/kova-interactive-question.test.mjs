import test from "node:test";
import assert from "node:assert/strict";
import { validateKovaQuestion, validateKovaQuestionAnswers } from "./kova-interactive-question.mjs";

const question = {
  version: 1,
  type: "question",
  title: "Choose a plan",
  fields: [
    { id: "tier", label: "Plan", kind: "single_choice", required: true, options: ["Free", "Plus"] },
    { id: "speed", label: "Speed", kind: "slider", min: 0, max: 10, step: 2 },
    { id: "notes", label: "Notes", kind: "text" },
  ],
};

test("accepts safe question and valid answers", () => {
  assert.ok(validateKovaQuestion(question));
  assert.deepEqual(validateKovaQuestionAnswers(question, { tier: "Plus", speed: 4 }), {
    tier: "Plus",
    speed: 4,
  });
});
test("rejects missing required answer, unsupported choices and invalid steps", () => {
  assert.equal(validateKovaQuestionAnswers(question, { speed: 4 }), null);
  assert.equal(validateKovaQuestionAnswers(question, { tier: "Enterprise" }), null);
  assert.equal(validateKovaQuestionAnswers(question, { tier: "Free", speed: 3 }), null);
});
test("rejects arbitrary executable action fields", () => {
  assert.equal(validateKovaQuestion({ ...question, onSubmit: "fetch('/admin')" }), null);
  assert.equal(
    validateKovaQuestion({
      ...question,
      fields: [{ ...question.fields[0], javascript: "alert(1)" }],
    }),
    null,
  );
});
test("rejects duplicate IDs", () => {
  assert.equal(
    validateKovaQuestion({
      ...question,
      fields: [question.fields[0], question.fields[0]],
    }),
    null,
  );
});
