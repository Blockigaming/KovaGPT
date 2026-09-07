import { statSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const assetDirectory = new URL("../../dist/client/assets/", import.meta.url);
const manifestUrl = new URL("../../dist/client/.vite/manifest.json", import.meta.url);
const reportUrl = new URL("../../artifacts/release/bundle-report.json", import.meta.url);
const viteConfigUrl = new URL("../../vite.config.ts", import.meta.url);

export const HOME_ROUTE_MARKERS = Object.freeze([
  "Saved from chat",
  "Recent Library files are unavailable.",
]);

export const BUNDLE_BASELINE = Object.freeze({
  sourceBaseSha: "89517654cd4a7f8aef4c36a8e9cd40b07fa73a0f",
  observedHeadSha: "78c561acb83304c0ee8d5213e97a4950c30256ad",
  establishedAt: "2026-08-15",
  evidence:
    "The current-main-based build emitted a marked home-route chunk near 47.9 kB and a Vite-manifest entry chunk near 613.8 kB raw / 176.8 kB gzip. PR #180 changed no application route modules.",
});

export const BUNDLE_BUDGETS = Object.freeze({
  initial: Object.freeze({ raw: 62_500, gzip: 20_000 }),
  main: Object.freeze({ raw: 625_000, gzip: 181_000 }),
  omega: Object.freeze({ raw: 35_000, gzip: 12_000 }),
  chartLazy: Object.freeze({ raw: 470_000, gzip: 125_000 }),
});

function stripText(row) {
  if (!row) return null;
  const { text: _text, ...reportRow } = row;
  return reportRow;
}

function identifyManifestEntry(rows, manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return {
      row: undefined,
      manifestKey: null,
      error: "main: Vite client manifest is missing or invalid",
    };
  }

  const entries = Object.entries(manifest).filter(
    ([, record]) =>
      record &&
      typeof record === "object" &&
      record.isEntry === true &&
      typeof record.file === "string" &&
      record.file.endsWith(".js"),
  );

  if (entries.length !== 1) {
    return {
      row: undefined,
      manifestKey: null,
      error: `main: expected exactly one JavaScript entry in the Vite manifest, found ${entries.length}`,
    };
  }

  const [manifestKey, record] = entries[0];
  const entryFile = basename(record.file);
  const row = rows.find((candidate) => candidate.file === entryFile);

  if (!row) {
    return {
      row: undefined,
      manifestKey,
      error: `main: Vite manifest entry ${entryFile} was not found in client assets`,
    };
  }

  return { row, manifestKey, error: null };
}

export function identifyBudgetChunks(rows, manifest) {
  const sortedRows = [...rows].sort((a, b) => b.raw - a.raw);
  const initialCandidates = sortedRows.filter((row) =>
    HOME_ROUTE_MARKERS.every((marker) => row.text.includes(marker)),
  );
  const initial = initialCandidates.length === 1 ? initialCandidates[0] : undefined;
  const mainSelection = identifyManifestEntry(rows, manifest);
  const omega = sortedRows.find((row) => row.file.startsWith("omega-"));
  const chartLazy = sortedRows.find((row) => row.file.startsWith("ChatChart-"));
  const errors = [];

  if (initialCandidates.length === 0) {
    errors.push("initial: no JavaScript chunk contained every required home-route marker");
  } else if (initialCandidates.length > 1) {
    errors.push(
      `initial: ${initialCandidates.length} JavaScript chunks contained every required home-route marker`,
    );
  }

  if (mainSelection.error) errors.push(mainSelection.error);

  return {
    chunks: {
      initial,
      main: mainSelection.row,
      omega,
      chartLazy,
    },
    entryManifestKey: mainSelection.manifestKey,
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

async function readViteManifest() {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  } catch {
    throw new Error("Vite client manifest is required for browser bundle accounting");
  }

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Vite client manifest must contain an object");
  }
  return manifest;
}

export async function runBundleBudget() {
  const [rows, manifest] = await Promise.all([collectBundleRows(), readViteManifest()]);
  const selection = identifyBudgetChunks(rows, manifest);
  const evaluation = evaluateBundleChecks(selection.chunks);
  const failures = [...selection.errors, ...evaluation.failures];
  const report = {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    baseline: BUNDLE_BASELINE,
    homeRouteMarkers: HOME_ROUTE_MARKERS,
    entryManifestKey: selection.entryManifestKey,
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
