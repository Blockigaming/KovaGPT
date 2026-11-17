import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { verifyPicomatch } from "../../scripts/security/verify-picomatch.mjs";
import { classifyAudit } from "../../scripts/security/dependency-audit.mjs";

const require = createRequire(import.meta.url);
const pm = require("picomatch");

test("every locked Picomatch resolves to the reviewed local source", () => {
  verifyPicomatch();
});

test("single-branch, nested and ambiguous repeated extglobs stay bounded", () => {
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `
    const assert = require('node:assert/strict');
    const pm = require('picomatch');
    const parse = require('picomatch/lib/parse');
    for (const pattern of ['+(*)b', '+(*a)', '*(*a)b', '+(?*a)', '+(*(ab))', '+(ab|abab)', '+([a-z]*)b']) {
      for (const options of [{}, {capture:true}, {fastpaths:false}, {maxExtglobRecursion:false}, {bash:true}]) {
        for (const input of ['a'.repeat(100000)+'!', 'ab'.repeat(50000)+'!', 'a'.repeat(100000)]) {
          assert.equal(pm.isMatch(input, pattern, options), false);
          assert.equal(require('picomatch/posix').isMatch(input, pattern, options), false);
          assert.equal(pm.compileRe(parse(pattern, options), options).test(input), false);
        }
      }
    }
  `,
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 3000 },
  );
  assert.equal(result.error, undefined, "Repeated-extglob matching exceeded its time bound");
  assert.equal(result.status, 0, result.stderr);
});

test("the regression detects the original unpatched parser", () => {
  const fixture = mkdtempSync(join(tmpdir(), "kova-picomatch-original-"));
  try {
    cpSync(resolve("vendor/picomatch"), fixture, { recursive: true });
    const path = join(fixture, "lib/parse.js");
    const patched = readFileSync(path, "utf8");
    const start = patched.indexOf("  // Kova hardening for GHSA-fc5q-39xc-vjpf:");
    const end = patched.indexOf("  if (options.maxExtglobRecursion === false)", start);
    assert.ok(start >= 0 && end > start);
    writeFileSync(path, patched.slice(0, start) + patched.slice(end));
    const original = spawnSync(
      process.execPath,
      ["-e", "require(process.argv[1]).isMatch('a'.repeat(64)+'!', '+(*a)')", fixture],
      { encoding: "utf8", timeout: 1000 },
    );
    assert.equal(
      original.error?.code,
      "ETIMEDOUT",
      "The regression must distinguish upstream from the backport",
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("ordinary build patterns and safe literal repetitions retain their semantics", () => {
  const cases = [
    ["src/routes/chat.tsx", "**/*.{ts,tsx}", true],
    ["src/routes/chat.css", "**/*.{ts,tsx}", false],
    ["src/routes/chat.tsx", "src/**/!(test).tsx", true],
    ["src/routes/test.tsx", "src/**/!(test).tsx", false],
    ["index.mjs", "*.@(js|mjs)", true],
    ["file42.ts", "file[0-9][0-9].ts", true],
    ["foobarfoo", "+(foo|bar)", true],
    ["foobarx", "+(foo|bar)", false],
    ["aaa", "*(a)", true],
    ["+(*a)", "+(*a)", true],
  ];
  for (const [input, pattern, expected] of cases)
    assert.equal(pm.isMatch(input, pattern), expected, pattern);
});

test("source tampering and a nested unpatched installation fail verification", () => {
  const fixture = mkdtempSync(join(tmpdir(), "kova-picomatch-verify-"));
  try {
    mkdirSync(join(fixture, "vendor"));
    cpSync(resolve("vendor/picomatch"), join(fixture, "vendor/picomatch"), { recursive: true });
    mkdirSync(join(fixture, "scripts/security"), { recursive: true });
    cpSync(
      resolve("scripts/security/picomatch-backport.json"),
      join(fixture, "scripts/security/picomatch-backport.json"),
    );
    for (const path of ["package.json", "package-lock.json"])
      cpSync(resolve(path), join(fixture, path));
    mkdirSync(join(fixture, "node_modules"));
    symlinkSync("../vendor/picomatch", join(fixture, "node_modules/picomatch"), "dir");
    verifyPicomatch(fixture);
    const lockPath = join(fixture, "package-lock.json");
    const lock = JSON.parse(readFileSync(lockPath));
    lock.packages["node_modules/example/node_modules/picomatch"] = { version: "4.0.7" };
    writeFileSync(lockPath, JSON.stringify(lock));
    assert.throws(() => verifyPicomatch(fixture), /Unexpected Picomatch copy/);
    cpSync(resolve("package-lock.json"), lockPath);
    writeFileSync(join(fixture, "vendor/picomatch/lib/parse.js"), "module.exports = () => null;");
    assert.throws(() => verifyPicomatch(fixture), /Unreviewed Picomatch content/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("audit accepts only the exact patched advisory and rejects new or incomplete findings", () => {
  const known = verifyPicomatch().reviewedAdvisory;
  const report = {
    auditReportVersion: 2,
    metadata: { vulnerabilities: { high: 2 } },
    vulnerabilities: {
      picomatch: {
        severity: "high",
        nodes: ["node_modules/picomatch", "vendor/picomatch"],
        via: [known],
      },
      vite: { severity: "high", via: ["picomatch"] },
    },
  };
  assert.deepEqual(classifyAudit(report, known), { patched: [known.url], unresolved: [] });
  const added = structuredClone(report);
  added.vulnerabilities.picomatch.via.push({
    ...known,
    source: 1,
    url: "https://example.invalid/new-advisory",
  });
  assert.equal(classifyAudit(added, known).unresolved.length, 1);
  const changed = structuredClone(report);
  changed.vulnerabilities.picomatch.via[0].range = "*";
  assert.equal(classifyAudit(changed, known).unresolved.length, 1);
  const nested = structuredClone(report);
  nested.vulnerabilities.picomatch.nodes.push("node_modules/other/node_modules/picomatch");
  assert.throws(() => classifyAudit(nested, known), /Unpatched Picomatch/);
  const unexplained = structuredClone(report);
  unexplained.vulnerabilities.vite.via = [];
  assert.equal(classifyAudit(unexplained, known).unresolved.length, 1);
  assert.throws(
    () => classifyAudit({ ...report, error: { code: "network" } }, known),
    /Incomplete/,
  );
  assert.throws(() => classifyAudit({ ...report, auditReportVersion: 3 }, known), /Unknown/);
});
