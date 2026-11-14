import assert from "node:assert/strict";
import test from "node:test";
import { parseChartSpec, extractCharts } from "../../src/components/chat-chart-utils.ts";
import { splitGenerativeContent } from "../../src/lib/generative-ui.mjs";

test("a chart survives alongside a calendar widget in response order", () => {
  const chart =
    '\x60\x60\x60kova-chart\n{"type":"bar","data":[{"name":"A","value":4}]}\n\x60\x60\x60';
  const widget =
    '\x60\x60\x60kova-ui\n{"version":1,"type":"date","title":"Choose a day","value":""}\n\x60\x60\x60';
  const parts = splitGenerativeContent(chart + "\n\n" + widget);
  assert.equal(parts[1]?.kind, "widget");
  assert.equal(extractCharts(parts[0].text)[0].kind, "chart");
});

test("invalid chart cells and color metadata fall back to text", () => {
  assert.equal(parseChartSpec('{"type":"bar","data":[{"x":{"nested":1}}]}'), null);
  assert.equal(parseChartSpec('{"type":"bar","colors":"red","data":[{"x":1}]}'), null);
});

test("heatmaps and radar charts use the same bounded data contract", () => {
  for (const type of ["heatmap", "radar"]) {
    assert.equal(
      parseChartSpec(
        JSON.stringify({
          type,
          xKey: "name",
          keys: ["score"],
          data: [{ name: "A", score: 4 }],
        }),
      )?.type,
      type,
    );
  }
  assert.equal(
    parseChartSpec('{"type":"heatmap","keys":["score","score"],"data":[{"score":4}]}'),
    null,
  );
  assert.equal(parseChartSpec('{"type":"radar","colors":["#12345"],"data":[{"score":4}]}'), null);
});

test("nested chart and study examples remain literal while top-level fences compose", async () => {
  const { splitInteractiveContent } = await import("../../src/lib/interactive-ui.mjs");
  const fence = "`".repeat(3);
  const outer = fence + "`";
  const chart = fence + 'kova-chart\n{"type":"bar","data":[{"score":4}]}\n' + fence;
  const quiz =
    fence +
    'kova-interactive\n{"version":1,"type":"flashcards","id":"test","title":"Study","cards":[{"front":"A","back":"B"}]}\n' +
    fence;
  const sample = [outer + "md", chart, quiz, outer].join("\n") + "\n";
  assert.deepEqual(extractCharts(sample), [{ kind: "text", value: sample }]);
  assert.deepEqual(splitInteractiveContent(sample), [{ kind: "text", text: sample }]);
  assert.equal(extractCharts(sample + chart)[1].kind, "chart");
  assert.equal(splitInteractiveContent(sample + quiz)[1].kind, "interactive");
});
