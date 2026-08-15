import { statSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const assetDirectory = new URL("../../dist/client/assets/", import.meta.url);
const reportUrl = new URL("../../artifacts/release/bundle-report.json", import.meta.url);
const viteConfigUrl = new URL("../../vite.config.ts", import.meta.url);

export const HOME_ROUTE_MARKERS = Object.freeze([
  "Saved from chat",
  "Recent Library files are unavailable.",
]);

export const BUNDLE_BASELINE = Object.freeze({
  sourceBaseSha: "89517654cd4a7f8aef4c36a8e9cd40b07fa73a0f",
  observedHeadSha: "49a95856f2f78f1400dd6fa8272be5b8ad0dd437",
  establishedAt: "2026-08-15",
  evidence:
    "The observed build was based on current main, and PR #180 changed no application route modules. Its marked home route was approximately 612.74 kB raw and 176.80 kB gzip.",
});

export const BUNDLE_BUDGETS = Object.freeze({
  initial: Object.freeze({ raw: 60_000, gzip: 20_000 }),
  homeRoute: Object.freeze({ raw: 625_000, gzip: 181_000 }),
  omega: Object.freeze({ raw: 35_000, gzip: 12_000 }),
  chartLazy: Object.freeze({ raw: 470_000, gzip: 125_000 }),
});

function stripText(row) {
  if (!row) return null;
  const { text: _text, ...reportRow } = row;
  return reportRow;
}

export function identifyBudgetChunks(rows) {
  const sortedRows = [...rows].sort((a, b) => b.raw - a.raw);
  const indexChunks = sortedRows.filter((row) => row.file.startsWith("index-"));
  const initial = indexChunks
    .filter((row) => row.raw <= BUNDLE_BUDGETS.initial.raw)
    .sort((a, b) => b.raw - a.raw)[0];
  const homeRouteCandidates = sortedRows.filter((row) =>
    HOME_ROUTE_MARKERS.every((marker) => row.text.includes(marker)),
  );
  const homeRoute = homeRouteCandidates.length === 1 ? homeRouteCandidates[0] : undefined;
  const omega = sortedRows.find((row) => row.file.startsWith("omega-"));
  const chartLazy = sortedRows.find((row) => row.file.startsWith("ChatChart-"));
  const errors = [];

  if (homeRouteCandidates.length === 0) {
    errors.push("homeRoute: no JavaScript chunk contained every required route marker");
  } else if (homeRouteCandidates.length > 1) {
    errors.push(
      `homeRoute: ${homeRouteCandidates.length} JavaScript chunks contained every required route marker`,
    );
  }

  return {
    chunks: { initial, homeRoute, omega, chartLazy },
    errors,
    sortedRows,
  };
}

export function evaluateBundleChecks(chunks) {
  const checks = {};
  const failures = [];

  for (const [name, budget] of Object.entries(BUNDLE_BUDGETS)) {
    const row = chunks[name];
    checks[name] = {
      file: row?.file ?? null,
      actual: {
        raw: row?.raw ?? null,
        gzip: row?.gzip ?? null,
      },
      budget,
    };

    if (!row) {
      failures.push(`${name}: required chunk is missing`);
      continue;
    }
    if (row.raw > budget.raw) {
      failures.push(`${name}: raw bytes ${row.raw} exceed ${budget.raw}`);
    }
    if (row.gzip > budget.gzip) {
      failures.push(`${name}: gzip bytes ${row.gzip} exceed ${budget.gzip}`);
    }
  }

  return { checks, failures };
}

async function collectBundleRows() {
  const files = (await readdir(assetDirectory)).filter((file) => file.endsWith(".js"));
  return Promise.all(
    files.map(async (file) => {
      const data = await readFile(new URL(file, assetDirectory));
      return {
        file,
        raw: data.length,
        gzip: gzipSync(data).length,
        text: data.toString("utf8"),
      };
    }),
  );
}

export async function runBundleBudget() {
  const rows = await collectBundleRows();
  const selection = identifyBudgetChunks(rows);
  const evaluation = evaluateBundleChecks(selection.chunks);
  const failures = [...selection.errors, ...evaluation.failures];
  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    baseline: BUNDLE_BASELINE,
    homeRouteMarkers: HOME_ROUTE_MARKERS,
    checks: evaluation.checks,
    failures,
    largest: selection.sortedRows.slice(0, 10).map(stripText),
  };

  await mkdir(new URL("../../artifacts/release/", import.meta.url), { recursive: true });
  await writeFile(reportUrl, `${JSON.stringify(report, null, 2)}\n`);

  for (const [name, check] of Object.entries(evaluation.checks)) {
    console.log(
      `${name}: ${check.file ?? "missing"}; raw ${check.actual.raw ?? "missing"} / ${check.budget.raw}; gzip ${check.actual.gzip ?? "missing"} / ${check.budget.gzip}`,
    );
  }
  for (const failure of failures) console.error(`Bundle budget failure: ${failure}`);

  if (statSync(viteConfigUrl).size === 0 || failures.length > 0) process.exitCode = 1;
  return report;
}

const directInvocation =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (directInvocation) await runBundleBudget();
