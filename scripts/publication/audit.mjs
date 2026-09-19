import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { readPublicCatalog } from "./catalog.mjs";
import { buildCapabilityTruth } from "./capabilities.mjs";
import { auditCatalog } from "./contract.mjs";

export function buildPublicationReport(root = process.cwd(), evidence = {}, now = Date.now()) {
  const catalog = readPublicCatalog(root);
  const capabilities = buildCapabilityTruth(root);
  const dependencies = { ...catalog.sources, ...capabilities.evidence };
  // A stylesheet, layout or route change invalidates earlier publication QA.
  for (const directory of ["src/components", "src/routes", "src/styles", "scripts/publication"]) {
    const walk = (path) => {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const child = resolve(path, entry.name);
        if (entry.isDirectory()) walk(child);
        else if (/\.(?:tsx?|mjs|css)$/u.test(entry.name))
          dependencies[relative(root, child)] = createHash("sha256")
            .update(readFileSync(child))
            .digest("hex");
      }
    };
    walk(resolve(root, directory));
  }
  for (const path of [
    "src/components/PublicFooter.tsx",
    "src/components/SeoLanding.tsx",
    "src/components/LegalArticle.tsx",
    "src/styles.css",
    "src/routeTree.gen.ts",
    "package-lock.json",
  ]) {
    dependencies[path] = createHash("sha256")
      .update(readFileSync(resolve(root, path)))
      .digest("hex");
  }
  const dependencyFingerprint = createHash("sha256")
    .update(JSON.stringify(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))))
    .digest("hex");
  const generatedRoutes = readFileSync(resolve(root, "src/routeTree.gen.ts"), "utf8");
  const pathInterface = generatedRoutes
    .split("export interface FileRoutesByFullPath {")[1]
    ?.split("\n}")[0];
  if (!pathInterface) throw new Error("Generated full-path route interface missing");
  const knownPaths = [...pathInterface.matchAll(/^\s*['"]([^'"]+)['"]:/gmu)].map(
    (match) => match[1].replace(/\/$/u, "") || "/",
  );
  // Concrete URLs must match a declared router pattern; a review inventory is
  // not itself proof that a route is implemented. Render evidence additionally
  // checks the loader's actual HTTP response and selected content.
  const implemented = (path) =>
    knownPaths.some((pattern) => {
      const parts = pattern.split("/");
      const candidate = path.split("/");
      return (
        parts.length === candidate.length &&
        parts.every((part, index) =>
          part.startsWith("$") ? candidate[index].length > 0 : part === candidate[index],
        )
      );
    });
  const routes = new Set([
    ...knownPaths.filter((path) => !path.includes("$")),
    ...catalog.records.map((record) => record.path).filter(implemented),
    ...catalog.reviewPaths.filter(implemented),
  ]);
  const report = auditCatalog({
    ...catalog,
    routes,
    capabilityById: new Map(capabilities.capabilities.map((item) => [item.id, item])),
    dependencyFingerprint,
    evidence,
    now,
  });
  return { report, capabilities };
}

export function main(args = process.argv.slice(2)) {
  const allowed = new Set(["--audit-only", "--out", "--evidence", "--root"]);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!allowed.has(key)) throw new Error(`Unknown option: ${key}`);
    if (key === "--audit-only") options.auditOnly = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
      options[key.slice(2)] = value;
    }
  }
  const root = resolve(options.root ?? process.cwd());
  const evidence = options.evidence
    ? JSON.parse(readFileSync(resolve(options.evidence), "utf8"))
    : {};
  const { report, capabilities } = buildPublicationReport(root, evidence);
  const out = resolve(options.out ?? "artifacts/publication");
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, "readiness.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(resolve(out, "capabilities.json"), `${JSON.stringify(capabilities, null, 2)}\n`);
  const lines = [
    "# KovaGPT publication readiness",
    "",
    report.scope,
    "",
    `Source fingerprint: \`${report.dependencyFingerprint}\``,
    "",
    ...Object.entries(report.counts).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Capability truth",
    "",
    "These are source statuses, not production availability. No live service has been certified.",
    "",
    "| Capability | Source status | Publication status | Production verified |",
    "| --- | --- | --- | --- |",
    ...capabilities.capabilities.map(
      (entry) => `| ${entry.label} | ${entry.sourceAvailability} | ${entry.publicStatus} | No |`,
    ),
    "",
    "## Blocked routes",
    "",
    ...report.results
      .filter((item) => !item.publishReady)
      .map((item) => `- ${item.path}: ${[...item.errors, ...item.evidenceErrors].join(", ")}`),
  ];
  writeFileSync(resolve(out, "readiness.md"), `${lines.join("\n")}\n`);
  console.log(
    JSON.stringify(
      {
        ...report.counts,
        sourceFingerprint: report.dependencyFingerprint,
        report: relative(process.cwd(), out),
        strictGatePassed: report.counts.blocked === 0,
      },
      null,
      2,
    ),
  );
  return options.auditOnly || report.counts.blocked === 0 ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
