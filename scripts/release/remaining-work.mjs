import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ledgerPath = "docs/day16/MASTER_LEDGER.json";
const acceptedStatuses = new Set(["verified_local", "verified_production", "not_applicable"]);
const productionAcceptedStatuses = new Set(["verified_production", "not_applicable"]);

function groupCount(items, key) {
  return Object.fromEntries(
    [...new Set(items.map((item) => item[key]))]
      .sort()
      .map((value) => [value, items.filter((item) => item[key] === value).length]),
  );
}

function summarize(items, accepted) {
  const complete = items.filter((item) => accepted.has(item.status));
  const remaining = items.filter((item) => !accepted.has(item.status));
  return {
    total: items.length,
    complete: complete.length,
    remaining: remaining.length,
    percentComplete:
      items.length === 0 ? 100 : Number(((complete.length / items.length) * 100).toFixed(1)),
    completeIds: complete.map((item) => item.id),
    remainingIds: remaining.map((item) => item.id),
  };
}

export async function calculateRemainingWork({ path = ledgerPath } = {}) {
  const ledger = JSON.parse(await readFile(path, "utf8"));
  const required = ledger.items.filter((item) => item.required !== false);
  const source = required.filter((item) => item.verification === "source");
  const production = required.filter((item) => item.verification === "production");
  const remaining = required.filter((item) => {
    const accepted =
      item.verification === "production" ? productionAcceptedStatuses : acceptedStatuses;
    return !accepted.has(item.status);
  });

  return {
    schemaVersion: 1,
    calculatedAt: new Date().toISOString(),
    ledgerPath: path,
    authoritativeBaselineSha: ledger.authoritativeBaselineSha,
    completionRule: ledger.completionRule,
    required: summarize(required, acceptedStatuses),
    source: summarize(source, acceptedStatuses),
    production: summarize(production, productionAcceptedStatuses),
    remainingByStatus: groupCount(remaining, "status"),
    remainingByCategory: groupCount(remaining, "category"),
    remaining: remaining.map((item) => ({
      id: item.id,
      category: item.category,
      requirement: item.requirement,
      verification: item.verification,
      status: item.status,
      evidence: Array.isArray(item.evidence) ? item.evidence : [],
    })),
  };
}

function markdown(result) {
  const lines = [
    "# KovaGPT Remaining Work Snapshot",
    "",
    `Calculated: \`${result.calculatedAt}\``,
    "",
    "This snapshot is derived from `docs/day16/MASTER_LEDGER.json`. It does not replace the broader final-product specification or the authoritative overall progress metric.",
    "",
    "## Exact required-gate counts",
    "",
    `- Required gates: **${result.required.total}**`,
    `- Verified gates: **${result.required.complete}**`,
    `- Remaining gates: **${result.required.remaining}**`,
    `- Source: **${result.source.complete}/${result.source.total} verified; ${result.source.remaining} remaining**`,
    `- Production: **${result.production.complete}/${result.production.total} verified; ${result.production.remaining} remaining**`,
    "",
    "## Remaining gates",
    "",
    "| ID | Category | Verification | Status | Requirement |",
    "| --- | --- | --- | --- | --- |",
    ...result.remaining.map(
      (item) =>
        `| \`${item.id}\` | ${item.category} | ${item.verification} | ${item.status} | ${item.requirement} |`,
    ),
    "",
    "## Remaining by category",
    "",
    ...Object.entries(result.remainingByCategory).map(
      ([category, count]) => `- ${category}: **${count}**`,
    ),
    "",
    "## Remaining by status",
    "",
    ...Object.entries(result.remainingByStatus).map(
      ([status, count]) => `- ${status}: **${count}**`,
    ),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = await calculateRemainingWork();
  const json = JSON.stringify(result, null, 2);
  const write = process.argv.includes("--write");
  const requireComplete = process.argv.includes("--require-complete");

  if (write) {
    const jsonPath = "artifacts/release/day16-remaining-work.json";
    const markdownPath = "artifacts/release/day16-remaining-work.md";
    await mkdir(dirname(resolve(jsonPath)), { recursive: true });
    await writeFile(jsonPath, `${json}\n`);
    await writeFile(markdownPath, markdown(result));
    console.log(`KOVA_REMAINING_WORK_JSON=${jsonPath}`);
    console.log(`KOVA_REMAINING_WORK_MARKDOWN=${markdownPath}`);
  } else {
    console.log(json);
  }

  console.log(`KOVA_REQUIRED_GATES=${result.required.total}`);
  console.log(`KOVA_VERIFIED_GATES=${result.required.complete}`);
  console.log(`KOVA_REMAINING_GATES=${result.required.remaining}`);
  console.log(`KOVA_SOURCE_GATES=${result.source.complete}/${result.source.total}`);
  console.log(`KOVA_PRODUCTION_GATES=${result.production.complete}/${result.production.total}`);

  if (requireComplete && result.required.remaining > 0) process.exitCode = 1;
}
