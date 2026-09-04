import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const chart = readFileSync(join(process.cwd(), "src/components/ChatChart.tsx"), "utf8");

test("chart controls report export failures and remain touch accessible", () => {
  assert.match(chart, /await navigator\.clipboard\.writeText\(chartToCsv\(spec\)\)/);
  assert.match(chart, /Could not copy the chart data/);
  assert.match(chart, /Could not download the chart data/);
  assert.match(chart, /document\.body\.appendChild\(anchor\)/);
  assert.match(chart, /finally\s*\{\s*anchor\?\.remove\(\)/);
  assert.match(chart, /window\.setTimeout\(\(\) => URL\.revokeObjectURL\(completedUrl\), 1_000\)/);
  assert.match(chart, /const chartTypeId = useId\(\)/);
  assert.match(chart, /htmlFor=\{chartTypeId\}/);
  assert.match(chart, /id=\{chartTypeId\}/);
  assert.ok((chart.match(/min-h-11/g) ?? []).length >= 4);
  assert.ok((chart.match(/min-w-11/g) ?? []).length >= 3);
});
