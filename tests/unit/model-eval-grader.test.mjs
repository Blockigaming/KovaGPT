import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gradeDeterministic, normalize } from '../../scripts/model-eval-grade.mjs';

test('normalize removes harmless formatting differences', () => {
  assert.equal(normalize('  $194.40  '), '194.40');
});

test('exact grader accepts expected answer embedded in a brief explanation', () => {
  const grade = gradeDeterministic({ grader: { type: 'exact', answer: '194.40' } }, 'The final price is $194.40.');
  assert.equal(grade.score, 1);
});

test('constraint grader scores all four initial instruction checks', () => {
  const item = { grader: { type: 'constraints', criteria: ['exactly three lines', 'lowercase only', 'one fruit per line', 'no extra text'] } };
  assert.equal(gradeDeterministic(item, 'apple\nbanana\npear').score, 1);
  assert.ok(gradeDeterministic(item, 'Apple\nbanana').score < 1);
});

test('rubric cases remain explicitly pending for blind judging', () => {
  assert.equal(gradeDeterministic({ grader: { type: 'rubric' } }, 'answer'), null);
});
