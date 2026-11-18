import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyPicomatch } from "./verify-picomatch.mjs";

const severe = new Set(["high", "critical"]);
export function classifyAudit(report, reviewedAdvisory) {
  assert.equal(report.auditReportVersion, 2, "Unknown npm audit format");
  assert.ok(
    !report.error && report.vulnerabilities && report.metadata?.vulnerabilities,
    "Incomplete audit",
  );
  const patched = new Set();
  const unresolved = new Set();
  const severeCount = Object.values(report.vulnerabilities).filter((finding) =>
    severe.has(finding.severity),
  ).length;
  assert.equal(
    severeCount,
    (report.metadata.vulnerabilities.high ?? 0) + (report.metadata.vulnerabilities.critical ?? 0),
    "Incomplete high/critical advisory inventory",
  );
  const walk = (name, visiting = new Set()) => {
    assert.ok(!visiting.has(name), "Cyclic advisory dependency");
    const finding = report.vulnerabilities[name];
    assert.ok(finding && Array.isArray(finding.via), `Unknown advisory cause: ${name}`);
    const next = new Set(visiting).add(name);
    let highCause = false;
    for (const via of finding.via) {
      if (typeof via === "string") {
        highCause = walk(via, next) || highCause;
        continue;
      }
      assert.ok(
        via && typeof via.url === "string" && typeof via.severity === "string",
        "Malformed advisory",
      );
      if (!severe.has(via.severity)) continue;
      highCause = true;
      const exactBackport =
        name === "picomatch" &&
        Object.entries(reviewedAdvisory).every(([key, value]) => via[key] === value);
      if (exactBackport) {
        assert.ok(finding.nodes?.length > 0, "Missing Picomatch installation paths");
        assert.ok(
          finding.nodes.every((path) =>
            ["node_modules/picomatch", "vendor/picomatch"].includes(path),
          ),
          "Unpatched Picomatch installation",
        );
        patched.add(via.url);
      } else unresolved.add(via.url);
    }
    if (severe.has(finding.severity) && !highCause) unresolved.add(`unexplained:${name}`);
    return highCause;
  };
  for (const [name, finding] of Object.entries(report.vulnerabilities)) {
    if (severe.has(finding.severity)) walk(name);
  }
  return { patched: [...patched], unresolved: [...unresolved] };
}

export function auditDependencies() {
  const manifest = verifyPicomatch();
  const regression = spawnSync(
    process.execPath,
    ["--test", "tests/unit/picomatch-backport.test.mjs"],
    { encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(
    regression.status,
    0,
    `Picomatch backport regression failed: ${regression.stderr}\n${regression.stdout}`,
  );
  const result = spawnSync("npm", ["audit", "--json", "--omit=dev", "--audit-level=high"], {
    encoding: "utf8",
    timeout: 150_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.ok(!result.error && [0, 1].includes(result.status), "npm audit did not complete");
  const report = JSON.parse(result.stdout);
  const status = classifyAudit(report, manifest.reviewedAdvisory);
  console.log(
    JSON.stringify(
      {
        registryFindings: report.metadata.vulnerabilities,
        locallyPatched: status.patched,
        unresolvedHighOrCritical: status.unresolved,
      },
      null,
      2,
    ),
  );
  assert.equal(status.unresolved.length, 0, "Unresolved high/critical dependency vulnerabilities");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  auditDependencies();
