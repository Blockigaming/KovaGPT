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
  finalEntryObservations: Object.freeze([
    Object.freeze({ node: "24.15.0", raw: 641_029, gzip: 193_026 }),
    Object.freeze({ node: "24.19.0", raw: 617_345, gzip: 185_685 }),
    Object.freeze({
      node: "24.19.0",
      head: "b5a09278a8c984b7a394a419e6522e2333c9dd89",
      raw: 667_469,
      gzip: 198_845,
    }),
    Object.freeze({
      node: "24.19.0",
      head: "auth-review-batch-local",
      raw: 667_800,
      gzip: 198_923,
    }),
    Object.freeze({
      node: "24.22.1",
      head: "386e03d26056eb1c9a460de108706c0e79a85f3c",
      source: "Clean main client build before the device-specific Settings redesign",
      raw: 648_696,
      gzip: 200_896,
    }),
    Object.freeze({
      head: "288e66f14d55771a41714e31f106a63ed35a5412",
      source: "PR #626 CI production build, run 42501052050",
      raw: 648_944,
      gzip: 201_025,
    }),
  ]),
  deviceSettingsAdjustment:
    "On 2026-11-08 the clean main client build measured 200,896 gzip bytes, already above the previous 200,000 ceiling. The device-specific Settings candidate measured 200,991 locally and 201,025 in CI. A 201,500 ceiling leaves 475 bytes (0.24%) above the measured CI candidate; raw, home-route, omega and chart ceilings remain unchanged.",
  authRetirementAdjustment:
    "PR #773 CI run 45834020847 measured 201,520 gzip bytes, 20 above the prior main ceiling. The 201,650 ceiling adds 130 bytes of measured headroom; every other limit is unchanged.",
  adjustment:
    "The 2026-09-14 final build adds generated four-segment routing and expanded catalog registries. A clean rebuild of the authorized auth PR head b5a09278 on Node 24.19.0 already exceeded the older ceiling at 667,469 raw / 198,845 gzip before the current review fixes. The current source-only review batch measured 667,800 raw / 198,923 gzip on the same Node version and lockfile. The refreshed ceiling gives less than 1% headroom over that complete build while keeping the home route, omega, and chart ceilings unchanged.",
  voiceReceiptAdjustment:
    "The 2026-10-27 model-bound ElevenLabs playback adds a server receipt check to the home route. The exact PR head b25e56c5 measured 20,112 gzip bytes in CI and 20,109 locally against the old 20,000 ceiling; the 20,250 ceiling leaves less than 1% headroom while keeping the other chunk ceilings unchanged.",
  initialRouteObservations: Object.freeze([
    Object.freeze({
      head: "3da99f7089e32f0ea62d57f1fd444fb525382958",
      source: "CI",
      raw: 61_469,
      gzip: 20_238,
    }),
    Object.freeze({
      head: "7bf09cbaa2722f2b8de31225391cab4308a9f7cb",
      source: "CI",
      raw: 61_507,
      gzip: 20_253,
    }),
    Object.freeze({
      tree: "2797198fb429ba7a1bb83a2157943169de9ca04d",
      source: "Node 24.22.1 local production build",
      raw: 61_545,
      gzip: 20_259,
    }),
    Object.freeze({
      head: "9ae59f5b370cd43636968e1f002c3385c9bc86c8",
      source: "CI OpenAI model and Free-offer candidate",
      raw: 62_567,
      gzip: 20_567,
    }),
    Object.freeze({
      head: "40a5786294620d3a14d3ace3732afb26808d0b32",
      source: "PR #689 CI run 43661550452",
      raw: 62_698,
      gzip: 20_651,
    }),
    Object.freeze({
      tree: "f425d73082b82a7b89afbf2d9a1b21c999146b5e",
      source: "Node 22 local production build, PR #749 response-UI candidate rebased on #748",
      raw: 61_224,
      gzip: 20_861,
    }),
    Object.freeze({
      tree: "pr-749-localization",
      source: "Node 22 local production build, PR #749 with spec §75 localization",
      raw: 61_408,
      gzip: 20_932,
    }),
    Object.freeze({
      head: "c174b2fae6bf5d21a1acdccd532fa91699c8f298",
      source: "PR #762 CI production build, run 45416613044",
      raw: 62_373,
      gzip: 21_670,
    }),
  ]),
  composerAvailabilityAdjustment:
    "The immediate composer and consolidated UI correction in PR #762 measured 62,373 raw / 21,670 gzip bytes in CI after deferring the streaming transport. The initial gzip ceiling of 21,800 leaves 130 bytes (0.60%) of headroom over that measured build. The 62,750 raw limit, all other chunk ceilings, and chunk identification checks remain unchanged.",
  apiAudioAdjustment:
    "The 2026-10-29 UI/Auth/API integration measured 20,238 home-route gzip bytes in PR #489 CI. Decisions, moderation and audio controls measured 20,253 in PR #492 CI; the combined sidebar preference repair measured 20,259 locally. The 20,400 ceiling retains less than 1% headroom over that complete build. The 62,500 raw ceiling and every shared-entry, omega and chart ceiling are unchanged.",
  usageReleaseAdjustment:
    "PR #691 CI run 43623726051 at 8ee794ef9702f9e170cf69bcd497d45f64739876 measured the home route at 62,667 raw / 20,623 gzip bytes after the existing settings and response-follow-up release. The 62,750 raw / 20,650 gzip ceiling leaves 83 raw / 27 gzip bytes of headroom. All other budgets and bundle identification checks are unchanged.",
  richResponseAdjustment:
    "The rich response catalog measured 62,698 raw and 20,651 gzip bytes in GitHub CI. The home-route gzip ceiling of 20,675 allows 24 bytes of headroom over that build.",
  deviceWidthWebAdjustment:
    "PR #747 CI measured the home route at 61,001 raw / 20,692 gzip bytes after the device-width website, the Settings modal deep-link fix and the native app surface switch; raw size is unchanged from the prior build while gzip varies with chunk hashes. The gzip ceiling moves to 20,725, leaving 33 bytes of headroom. All other budgets are unchanged.",
  filePreviewAdjustment:
    "The 2026-11-23 owner-approved file-preview candidate (PR #749) measured 61,224 raw / 20,861 gzip for the initial route in a local production build after rebasing on PR #748; main measured 20,692 against a 20,725 ceiling after PR #747. Its home route adds automatic file-preview opening, the background-tab response notification and the conversation goal sent with each message. The initial gzip ceiling moves to 20,875, giving 14 bytes of headroom; other ceilings are unchanged.",
  localizationAdjustment:
    "PR #749 adds spec §75 language and region preferences. Translated labels and formatters load on demand; only the language store and label lookup reach the first page. A local production build measured the initial route at 61,408 raw / 20,932 gzip (the language store, label lookup, the on-demand loader for public pages and the global stylesheet for right-to-left code and script fonts). The gzip ceiling moves to 20,950, leaving 18 bytes of headroom; other ceilings are unchanged.",
  openAiModelOfferAdjustment:
    "The 2026-11-08 OpenAI model-catalog and Free-offer candidate measured 62,567 raw / 20,567 gzip for the initial route and 648,770 raw / 200,927 gzip for the Vite entry in CI. The initial ceilings move to 62,600 raw / 20,600 gzip, providing 33 gzip bytes of headroom; the main gzip ceiling remains 201,500 from the device-specific Settings CI evidence. Omega and chart ceilings remain unchanged.",
});

export const BUNDLE_BUDGETS = Object.freeze({
  initial: Object.freeze({ raw: 62_750, gzip: 21_800 }),
  main: Object.freeze({ raw: 670_000, gzip: 201_650 }),
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
