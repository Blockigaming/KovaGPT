import assert from "node:assert/strict";
import test from "node:test";
import {
  costQuery,
  summarizeCostResponse,
} from "../../scripts/azure/read-production-costs.mjs";

const sample = {
  properties: {
    columns: [{ name: "PreTaxCost" }, { name: "ServiceName" }, { name: "Currency" }],
    rows: [
      [1.6, "Container Apps", "USD"],
      [1.2, "Container Apps", "USD"],
      [0.4, "Azure OpenAI", "USD"],
    ],
    nextLink: null,
  },
};

test("cost request is read-only ActualCost and grouped by service", () => {
  assert.deepEqual(costQuery("ServiceName"), {
    type: "ActualCost",
    timeframe: "MonthToDate",
    dataset: {
      granularity: "None",
      aggregation: { totalCost: { name: "PreTaxCost", function: "Sum" } },
      grouping: [{ type: "Dimension", name: "ServiceName" }],
    },
  });
  assert.throws(() => costQuery("SecretName"), /unsupported_cost_dimension/);
});

test("cost summaries aggregate all rows without mixing currencies", () => {
  const summary = summarizeCostResponse(sample, "ServiceName");
  assert.equal(summary.currency, "USD");
  assert.ok(Math.abs(summary.total - 3.2) < 1e-8);
  assert.deepEqual(summary.rows.map((row) => row.name), [
    "Container Apps",
    "Azure OpenAI",
  ]);
});

test("pagination and malformed responses are never counted as a complete bill", () => {
  assert.throws(
    () => summarizeCostResponse({
      properties: { ...sample.properties, nextLink: "https://example.com/next" },
    }, "ServiceName"),
    /paginated/,
  );
  assert.throws(
    () => summarizeCostResponse({ properties: { rows: [], columns: [] } }, "ServiceName"),
    /unexpected_cost_columns/,
  );
});

test("mixed currencies fail closed", () => {
  assert.throws(
    () => summarizeCostResponse({
      properties: {
        ...sample.properties,
        rows: [
          [1, "Container Apps", "USD"],
          [2, "Container Apps", "EUR"],
        ],
      },
    }, "ServiceName"),
    /mixed_cost_currencies/,
  );
});
