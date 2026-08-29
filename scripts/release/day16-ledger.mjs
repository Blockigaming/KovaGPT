import fs from "node:fs";

const path = "docs/day16/MASTER_LEDGER.json";
const ledger = JSON.parse(fs.readFileSync(path, "utf8"));
const required = ledger.items.filter((item) => item.required !== false);

const sourceItems = required.filter((item) => item.verification === "source");
const productionItems = required.filter((item) => item.verification === "production");

const sourcePassed = sourceItems.filter((item) =>
  ["verified_local", "verified_production", "not_applicable"].includes(item.status),
);

const productionPassed = productionItems.filter((item) =>
  ["verified_production", "not_applicable"].includes(item.status),
);

const unresolved = required.filter((item) => {
  if (item.verification === "production") {
    return !["verified_production", "not_applicable"].includes(item.status);
  }

  return !["verified_local", "verified_production", "not_applicable"].includes(item.status);
});

const result = {
  source: {
    passed: sourcePassed.length,
    total: sourceItems.length,
    coveragePercent:
      sourceItems.length === 0
        ? 100
        : Number(((sourcePassed.length / sourceItems.length) * 100).toFixed(1)),
  },
  production: {
    passed: productionPassed.length,
    total: productionItems.length,
    coveragePercent:
      productionItems.length === 0
        ? 100
        : Number(((productionPassed.length / productionItems.length) * 100).toFixed(1)),
  },
  unresolved: unresolved.map((item) => ({
    id: item.id,
    status: item.status,
    verification: item.verification,
  })),
  overallComplete: unresolved.length === 0,
};

console.log(JSON.stringify(result, null, 2));

if (process.argv.includes("--require-complete") && !result.overallComplete) {
  process.exitCode = 1;
}
