import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

test("each browser group runs on a fresh runner without reducing coverage", () => {
  const browser = workflow.slice(
    workflow.indexOf("\n  browser:"),
    workflow.indexOf("\n  tablet-coverage:"),
  );
  assert.match(browser, /browser:\n(?:    if: [^\n]+\n)?    name: \$\{\{ matrix\.check_name \}\}/);
  assert.match(browser, /needs: \[verify, public-surface\]/);
  assert.match(browser, /fail-fast: false/);
  assert.ok(
    browser.includes("timeout-minutes: ${{ startsWith(matrix.id, 'tablet') && 60 || 45 }}"),
  );

  const phones = [
    "phone-320x700",
    "phone-375x812",
    "phone-390x844",
    "phone-412x915",
    "phone-430x932",
  ];
  const include = browser.slice(
    browser.indexOf("        include:\n"),
    browser.indexOf("    steps:\n"),
  );
  const rows = include
    .split("          - id: ")
    .slice(1)
    .map((block) => {
      const match = block
        .trimEnd()
        .match(
          /^([a-z0-9-]+)\n            check_name: ([^\n]+)\n            projects: (?:>-\n\s*)?([\s\S]+?)\n            shard: (\d+\/\d+)$/,
        );
      assert.ok(match, "every browser row must declare its identity, full project set and shard");
      const [, id, checkName, flags, shard] = match;
      const projects = flags
        .trim()
        .split(/\s+/)
        .map((flag) => {
          assert.match(flag, /^--project=[a-z0-9-]+$/);
          return flag.slice("--project=".length);
        });
      return { id, checkName, projects, shard };
    });
  assert.deepEqual(rows, [
    { id: "phone-a", checkName: "Phone shard (phone-a)", projects: phones, shard: "1/4" },
    { id: "phone-b", checkName: "Phone shard (phone-b)", projects: phones, shard: "2/4" },
    { id: "phone-c", checkName: "Phone shard (phone-c)", projects: phones, shard: "3/4" },
    { id: "phone-d", checkName: "Phone shard (phone-d)", projects: phones, shard: "4/4" },
    {
      id: "tablet-portrait",
      checkName: "Browser (tablet-portrait)",
      projects: ["tablet-768x1024"],
      shard: "1/1",
    },
    {
      id: "tablet-landscape",
      checkName: "Browser (tablet-landscape)",
      projects: ["tablet-1024x768"],
      shard: "1/1",
    },
    {
      id: "tablet-phone-landscape",
      checkName: "Browser (phone-landscape)",
      projects: ["phone-landscape-844x390"],
      shard: "1/1",
    },
    {
      id: "desktop-1280",
      checkName: "Browser (desktop-1280)",
      projects: ["desktop-1280x800"],
      shard: "1/1",
    },
    {
      id: "desktop-1440-a",
      checkName: "Browser (desktop-1440-a)",
      projects: ["desktop-1440x900"],
      shard: "1/2",
    },
    {
      id: "desktop-1440-b",
      checkName: "Browser (desktop-1440-b)",
      projects: ["desktop-1440x900"],
      shard: "2/2",
    },
    {
      id: "desktop-1728",
      checkName: "Browser (desktop-1728)",
      projects: ["desktop-1728x1117"],
      shard: "1/1",
    },
  ]);
  assert.equal(new Set(rows.map((row) => row.id)).size, 11);
  assert.equal(new Set(rows.map((row) => row.checkName)).size, 11);
  assert.match(
    browser,
    /run: npm run test:e2e -- \$\{\{ matrix\.projects \}\} --shard=\$\{\{ matrix\.shard \}\} --workers=2$/m,
  );
  assert.match(browser, /name: playwright-artifacts-\$\{\{ matrix\.id \}\}/);
});

test("the original phone check requires every browser matrix row to succeed", () => {
  const aggregate = workflow.slice(
    workflow.indexOf("\n  phone-coverage:"),
    workflow.indexOf("\n  release-e2e:"),
  );
  assert.match(aggregate, /name: Browser \(phone\)$/m);
  assert.match(aggregate, /needs: \[verify, browser\]/);
  assert.match(aggregate, /timeout-minutes: 5/);
  assert.match(
    aggregate,
    /if: always\(\) && needs\.verify\.result == 'success' && needs\.verify\.outputs\.run_ci == 'true' && \(github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.draft == false\)/,
  );
  assert.match(aggregate, /BROWSER_RESULT: \$\{\{ needs\.browser\.result \}\}/);
  assert.doesNotMatch(aggregate, /continue-on-error|uses:|npm |playwright /);
  const gate = aggregate.match(/run: (test "\$BROWSER_RESULT" = success)$/m)?.[1];
  assert.ok(gate);
  for (const result of ["success", "failure", "cancelled", "skipped", ""]) {
    const run = spawnSync("bash", ["-euo", "pipefail", "-c", gate], {
      env: { ...process.env, BROWSER_RESULT: result },
    });
    assert.equal(run.status === 0, result === "success", result);
  }
});

test("the original tablet check requires every browser matrix row to succeed", () => {
  const aggregate = workflow.slice(
    workflow.indexOf("\n  tablet-coverage:"),
    workflow.indexOf("\n  phone-coverage:"),
  );
  assert.match(aggregate, /name: Browser \(tablet\)$/m);
  assert.match(aggregate, /needs: \[verify, browser\]/);
  assert.match(aggregate, /BROWSER_RESULT: \$\{\{ needs\.browser\.result \}\}/);
  assert.doesNotMatch(aggregate, /continue-on-error/);
  const gate = aggregate.match(/run: (test "\$BROWSER_RESULT" = success)$/m)?.[1];
  assert.ok(gate);
  for (const result of ["success", "failure", "cancelled", "skipped", ""]) {
    const run = spawnSync("bash", ["-euo", "pipefail", "-c", gate], {
      env: { ...process.env, BROWSER_RESULT: result },
    });
    assert.equal(run.status === 0, result === "success", result);
  }
});

test("third-party CI actions are pinned to immutable revisions", () => {
  for (const line of workflow.split("\n").filter((line) => line.includes("uses: actions/"))) {
    assert.match(line, /actions\/[a-z-]+@[a-f0-9]{40}(?:\s+# v\d+)?$/);
  }
});
