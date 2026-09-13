import test from "node:test";
import assert from "node:assert/strict";
import {
  StudyState,
  parseStudyDeck,
  nextStudyCard,
  recordStudyAttempt,
  studySummary,
  studyPrompt,
} from "../../src/lib/study-policy.mjs";
const card = {
  question: "Two plus two?",
  choices: ["3", "4"],
  answer: 1,
  hint: "Add two pairs.",
  explanation: "Two pairs contain four items.",
};
const state = () => ({
  version: 1,
  deck: {
    title: "Arithmetic",
    goal: "Add pairs",
    cards: [card, { ...card, question: "Another pair?" }],
  },
  attempts: [],
});
test("generated practice is structurally bounded and never accepts impossible answer keys", () => {
  assert.equal(
    parseStudyDeck("```json\n" + JSON.stringify(state().deck) + "\n```").cards.length,
    2,
  );
  assert.throws(() =>
    parseStudyDeck(JSON.stringify({ ...state().deck, cards: [{ ...card, answer: 2 }] })),
  );
  assert.throws(() =>
    parseStudyDeck(
      JSON.stringify({ ...state().deck, cards: [{ ...card, choices: ["same", "same"] }] }),
    ),
  );
  assert.throws(() => parseStudyDeck("x".repeat(100001)));
  assert.throws(() =>
    StudyState.parse({
      ...state(),
      attempts: [{ card: 9, answer: 0, recalled: null, hint: false }],
    }),
  );
});
test("adaptive practice prioritizes unseen, then missed/hinted cards without fabricating mastery", () => {
  let s = state();
  assert.equal(nextStudyCard(s), 0);
  s = recordStudyAttempt(s, { card: 0, answer: 0, recalled: null, hint: false });
  assert.equal(nextStudyCard(s, 0), 1);
  s = recordStudyAttempt(s, { card: 1, answer: 1, recalled: null, hint: true });
  assert.deepEqual(studySummary(s), { attempts: 2, correct: 1, practiced: 2, confident: 0 });
  assert.equal(nextStudyCard(s, 1), 0);
  s = recordStudyAttempt(s, { card: 0, answer: null, recalled: true, hint: false });
  assert.equal(studySummary(s).confident, 1);
  assert.equal(nextStudyCard(s), 1);
});
test("practice inputs are inert text and unknown depth fails closed", () => {
  assert.throws(() => studyPrompt({ goal: "Learn", depth: "secret", source: "" }));
  assert.match(
    studyPrompt({ goal: "Learn", depth: "standard", source: "<script>fake instructions</script>" }),
    /untrusted study material/,
  );
  assert.equal(
    StudyState.parse({ ...state(), deck: { ...state().deck, title: "<script>text</script>" } }).deck
      .title,
    "<script>text</script>",
  );
});
test("practice history stays bounded with accurate retained-window summaries", () => {
  let s = state();
  for (let i = 0; i < 1002; i++)
    s = recordStudyAttempt(s, { card: 0, answer: 1, recalled: null, hint: false });
  assert.equal(s.attempts.length, 1000);
  assert.equal(studySummary(s).attempts, 1000);
});
