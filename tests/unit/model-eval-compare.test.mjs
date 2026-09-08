import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareRuns } from '../../scripts/model-eval-compare.mjs';

test('compares quality, cost, latency and category deltas', () => {
  const reference = [
    { id:'a', category:'coding', score:1, cost_usd:0.02, latency_ms:100 },
    { id:'b', category:'safety_privacy', score:1, cost_usd:0.02, latency_ms:200 },
  ];
  const candidate = [
    { id:'a', category:'coding', score:0.9, cost_usd:0.01, latency_ms:80 },
    { id:'b', category:'safety_privacy', score:1, cost_usd:0.01, latency_ms:120 },
  ];
  const result = compareRuns(reference, candidate);
  assert.equal(result.relative_quality, 0.95);
  assert.equal(result.cost_ratio, 0.5);
  assert.equal(result.latency_ratio, 2/3);
  assert.equal(result.category_delta.coding, -0.1);
  assert.equal(result.category_delta.safety_privacy, 0);
});

test('refuses incomparable case sets', () => {
  assert.throws(() => compareRuns([{id:'a',category:'x',score:1}], [{id:'b',category:'x',score:1}]), /must match exactly/u);
});
