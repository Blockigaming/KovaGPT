import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

test('Kova eval corpus validates and covers initial critical categories', () => {
  const stdout = execFileSync(process.execPath, ['scripts/model-eval.mjs'], { encoding: 'utf8' });
  const result = JSON.parse(stdout);
  assert.equal(result.valid, true);
  assert.ok(result.cases >= 9);
  for (const category of ['general_chat','coding','instruction_following','reasoning_math','tool_use','deep_research','safety_privacy','factuality','kova_specific']) {
    assert.ok(result.categories.includes(category), `missing ${category}`);
  }
});
