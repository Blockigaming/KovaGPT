#!/usr/bin/env node
// Read-only Azure Cost Management and resource inventory. No Azure writes.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dimensions = ["ServiceName", "ResourceId"];
const resourceGroups = ["rg-kovagpt-prod", "rg-kovagpt-staging", "rg-kovagpt-dev"];

export function costQuery(dimension) {
  if (!dimensions.includes(dimension)) throw new Error("unsupported_cost_dimension");
  return {
    type: "ActualCost",
    timeframe: "MonthToDate",
    dataset: {
      granularity: "None",
      aggregation: { totalCost: { name: "PreTaxCost", function: "Sum" } },
      grouping: [{ type: "Dimension", name: dimension }],
    },
  };
}

export function summarizeCostResponse(response, dimension) {
  const table = response?.properties;
  if (!Array.isArray(table?.columns) || !Array.isArray(table?.rows))
    throw new Error("invalid_cost_response");
  // Do not silently report a truncated Cost Management page as the full bill.
  if (table.nextLink) throw new Error("cost_query_paginated");
  const columns = table.columns.map((column) => column.name);
  const amountIndex = ["totalCost", "PreTaxCost", "Cost"]
    .map((name) => columns.indexOf(name))
    .find((index) => index >= 0);
  const dimensionIndex = columns.indexOf(dimension);
  const currencyIndex = columns.indexOf("Currency");
  if (amountIndex === undefined || dimensionIndex < 0 || currencyIndex < 0)
    throw new Error("unexpected_cost_columns");
  const totals = new Map();
  let currency = null;
  for (const row of table.rows) {
    if (!Array.isArray(row) || !Number.isFinite(row[amountIndex]))
      throw new Error("invalid_cost_row");
    const nextCurrency = row[currencyIndex];
    if (typeof nextCurrency !== "string" || !/^[A-Z]{3}$/.test(nextCurrency))
      throw new Error("invalid_cost_currency");
    if (currency && currency !== nextCurrency) throw new Error("mixed_cost_currencies");
    currency = nextCurrency;
    const name = String(row[dimensionIndex] || "(unattributed)");
    totals.set(name, (totals.get(name) || 0) + row[amountIndex]);
  }
  return {
    currency,
    total: [...totals.values()].reduce((sum, value) => sum + value, 0),
    rows: [...totals].map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount),
  };
}

function az(args) {
  // No shell evaluation; never fetch or print credentials.
  return JSON.parse(execFileSync("az", [...args, "--output", "json", "--only-show-errors"], {
    encoding: "utf8",
    timeout: 45000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }));
}

function inventory(group, warnings) {
  const probes = [
    ["apps", ["containerapp", "list", "--resource-group", group,
      "--query", "[].{name:name,minReplicas:properties.template.scale.minReplicas,maxReplicas:properties.template.scale.maxReplicas,workloadProfileName:properties.workloadProfileName,runningStatus:properties.runningStatus}"]],
    ["jobs", ["containerapp", "job", "list", "--resource-group", group,
      "--query", "[].{name:name,trigger:properties.configuration.triggerType,cron:properties.configuration.scheduleTriggerConfig.cronExpression,replicaTimeout:properties.configuration.replicaTimeout}"]],
    ["environments", ["containerapp", "env", "list", "--resource-group", group,
      "--query", "[].{name:name,workloadProfiles:properties.workloadProfiles}"]],
    ["logAnalytics", ["monitor", "log-analytics", "workspace", "list", "--resource-group", group,
      "--query", "[].{name:name,sku:sku.name,retentionInDays:retentionInDays,dailyQuotaGb:workspaceCapping.dailyQuotaGb}"]],
    ["aiAccounts", ["cognitiveservices", "account", "list", "--resource-group", group,
      "--query", "[].{name:name,kind:kind,sku:sku.name}"]],
  ];
  const result = {};
  for (const [label, args] of probes) {
    try {
      result[label] = az(args);
    } catch {
      result[label] = null;
      warnings.push(group + "." + label + "_read_unavailable");
    }
  }
  return result;
}

export function runAudit() {
  const account = az(["account", "show", "--query", "{subscriptionId:id,tenantId:tenantId}"]);
  const expected = process.env.KOVA_EXPECTED_SUBSCRIPTION_ID;
  if (!/^[a-f0-9-]{36}$/i.test(account.subscriptionId) ||
      (expected && account.subscriptionId.toLowerCase() !== expected.toLowerCase()))
    throw new Error("azure_subscription_mismatch");
  const warnings = [];
  const costs = {};
  const uri = "https://management.azure.com/subscriptions/" + account.subscriptionId +
    "/providers/Microsoft.CostManagement/query?api-version=2025-03-01";
  for (const dimension of dimensions) {
    try {
      const response = az(["rest", "--method", "post", "--uri", uri,
        "--headers", "Content-Type=application/json",
        "--body", JSON.stringify(costQuery(dimension))]);
      costs[dimension] = summarizeCostResponse(response, dimension);
    } catch {
      costs[dimension] = null;
      warnings.push(dimension + "_cost_unavailable_or_incomplete");
    }
  }
  const inventoryByGroup = Object.fromEntries(
    resourceGroups.map((group) => [group, inventory(group, warnings)]),
  );
  return {
    observedAt: new Date().toISOString(),
    scope: "current Azure subscription",
    period: "MonthToDate; billing data may lag 8-24 hours",
    costByService: costs.ServiceName,
    costByResource: costs.ResourceId,
    resourceGroups: inventoryByGroup,
    warnings,
    readOnly: true,
    changesApplied: 0,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.stdout.write(JSON.stringify(runAudit(), null, 2) + "\n");
  } catch {
    process.stderr.write("Azure cost audit unavailable. No changes made.\n");
    process.exitCode = 1;
  }
}
