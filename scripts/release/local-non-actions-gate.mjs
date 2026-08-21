import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const artifactDir = join(root, "artifacts", "local-non-actions-gate");
mkdirSync(artifactDir, { recursive: true });

const gates = [
  ["format", "npm", ["run", "format:check"]],
  ["lint", "npm", ["run", "lint"]],
  ["typecheck", "npm", ["run", "typecheck"]],
  ["unit", "npm", ["run", "test:unit"]],
  ["api", "npm", ["run", "test:api"]],
  ["integration", "npm", ["run", "test:integration"]],
  ["release", "npm", ["run", "test:release"]],
  ["accessibility", "npm", ["run", "test:a11y"]],
  ["visual-source", "npm", ["run", "test:visual"]],
  ["auth-provider", "npm", ["run", "release:auth-provider"]],
  ["security", "npm", ["run", "release:security"]],
  ["ui-truthfulness", "npm", ["run", "release:ui-truthfulness"]],
  ["visible-controls", "npm", ["run", "release:visible-controls"]],
  ["zero-lovable", "npm", ["run", "release:zero-lovable"]],
  ["zero-lovable-strict", "npm", ["run", "release:zero-lovable:strict"]],
  ["migrations", "npm", ["run", "release:migrations"]],
  ["migration-preflight", "npm", ["run", "release:migration-preflight"]],
  ["rls-dry", "npm", ["run", "release:rls:two-user:dry"]],
  ["stripe", "npm", ["run", "release:stripe:contract"]],
  ["ai-provider", "npm", ["run", "release:ai-provider-contract"]],
  ["azure", "npm", ["run", "azure:validate"]],
  ["azure-staging", "npm", ["run", "azure:staging:validate"]],
  ["build", "npm", ["run", "build"]],
  ["security-built", "npm", ["run", "release:security"]],
  ["zero-lovable-built", "npm", ["run", "release:zero-lovable:strict"]],
];

const report = {
  schemaVersion: 2,
  startedAt: new Date().toISOString(),
  node: process.version,
  gates: [],
};

for (const [name, command, args] of gates) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
    maxBuffer: 32 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  writeFileSync(join(artifactDir, `${name}.log`), output);
  report.gates.push({
    name,
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status,
    durationMs: Date.now() - startedAt,
    log: `artifacts/local-non-actions-gate/${name}.log`,
  });
  writeFileSync(join(artifactDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (result.status !== 0) {
    console.error(`LOCAL_NON_ACTIONS_GATE=FAIL gate=${name}`);
    console.error(output.split("\n").slice(-80).join("\n"));
    process.exit(result.status ?? 1);
  }
  console.log(`LOCAL_GATE_PASS=${name}`);
}

report.completedAt = new Date().toISOString();
report.status = "passed";
writeFileSync(join(artifactDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`KOVA_LOCAL_NON_ACTIONS_GATE=PASS gates=${report.gates.length}`);
