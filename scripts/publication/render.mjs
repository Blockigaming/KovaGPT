import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildPublicationReport } from "./audit.mjs";
import { readPublicCatalog } from "./catalog.mjs";
import { normalizedPath, validateRenderedFacts } from "./contract.mjs";

export function localPreviewOrigin(value) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Use a credential-free local preview origin, not a production service");
  return url.origin;
}

export async function collectRenderFacts(page, record, knownPaths) {
  const runtimeErrors = [];
  const onError = (error) => runtimeErrors.push(error.message);
  page.on("pageerror", onError);
  try {
    const response = await page.goto(record.path, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    await page.locator('html[data-kova-hydration="ready"]').waitFor({ timeout: 15_000 });
    const facts = await page.evaluate(
      ({ knownPaths }) => {
        const meta = (name) =>
          document.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ?? "";
        const canonicals = document.querySelectorAll('link[rel="canonical"]');
        const brokenLinks = [];
        for (const anchor of document.querySelectorAll("a[href]")) {
          const raw = anchor.getAttribute("href");
          const url = new URL(raw, location.href);
          if (!["http:", "https:", "mailto:"].includes(url.protocol)) brokenLinks.push(raw);
          if (url.origin === location.origin) {
            const path = url.pathname.replace(/\/$/, "") || "/";
            if (!knownPaths.includes(path)) brokenLinks.push(raw);
            if (
              path === location.pathname &&
              url.hash &&
              !document.getElementById(decodeURIComponent(url.hash.slice(1)))
            )
              brokenLinks.push(raw);
          }
        }
        const structuredDataErrors = [];
        for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
          try {
            JSON.parse(node.textContent ?? "");
          } catch {
            structuredDataErrors.push("Invalid JSON-LD syntax");
          }
        }
        return {
          mainCount: document.querySelectorAll("main").length,
          h1Count: document.querySelectorAll("h1").length,
          h1: document.querySelector("h1")?.textContent?.trim() ?? "",
          title: document.title,
          description: meta("description"),
          canonicalCount: canonicals.length,
          canonical: canonicals[0]?.getAttribute("href") ?? "",
          navigation: Boolean(document.querySelector('nav[aria-label="Public navigation"]')),
          footer: Boolean(document.querySelector("footer")),
          brokenLinks,
          brokenImages: Array.from(document.images)
            .filter((image) => !image.complete || image.naturalWidth === 0)
            .map((image) => image.getAttribute("src")),
          overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          structuredDataChecked: true,
          structuredDataErrors,
        };
      },
      { knownPaths },
    );
    return { ...facts, status: response?.status() ?? null, runtimeErrors };
  } finally {
    page.off("pageerror", onError);
  }
}

export async function main(args = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (
      !["--base-url", "--paths", "--out"].includes(key) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw new Error(`Invalid option: ${key}`);
    options[key.slice(2)] = args[++i];
  }
  const baseURL = localPreviewOrigin(options["base-url"] ?? "http://127.0.0.1:8080");
  const { report } = buildPublicationReport();
  const catalog = readPublicCatalog();
  const chosen = options.paths
    ? options.paths.split(",")
    : report.results.filter((row) => row.sourceContractPassed).map((row) => row.path);
  if (
    !chosen.length ||
    chosen.some(
      (path) => !normalizedPath(path) || !catalog.records.some((row) => row.path === path),
    )
  )
    throw new Error("Choose explicit, adapted public content paths");
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const evidence = {};
  let failed = 0;
  try {
    for (const path of chosen) {
      const record = catalog.records.find((row) => row.path === path);
      const fingerprint = report.results.find((row) => row.path === path)?.fingerprint;
      if (!fingerprint) throw new Error(`Path outside review inventory: ${path}`);
      let facts, errors;
      try {
        facts = await collectRenderFacts(
          page,
          record,
          Array.from(new Set([...catalog.reviewPaths, ...catalog.records.map((row) => row.path)])),
        );
        errors = validateRenderedFacts(facts, record);
      } catch (error) {
        errors = [error instanceof Error ? error.message : String(error)];
      }
      if (errors.length) failed++;
      evidence[path] = {
        render: {
          status: errors.length ? "fail" : "pass",
          fingerprint,
          checkedAt: new Date().toISOString(),
          reference: "local-preview-render-observations",
          facts,
          errors,
        },
      };
    }
  } finally {
    await context.close();
    await browser.close();
  }
  const output = resolve(options.out ?? "artifacts/publication/render-observations.json");
  const { dirname } = await import("node:path");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
  console.log(
    JSON.stringify({
      checked: chosen.length,
      failed,
      scope:
        "Local desktop render only; no responsive, editorial, full schema validation, or production certification",
      output,
    }),
  );
  return failed ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
