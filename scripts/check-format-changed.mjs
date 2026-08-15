import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const FORMAT_EXTENSIONS = /\.(?:[cm]?[jt]sx?|css|json|md|mdx|yml|yaml|html)$/i;

function run(command, args) {
  return spawnSync(command, args, { encoding: "utf8" });
}

function changedFiles() {
  const workingTree = run("git", ["diff", "--name-only", "--diff-filter=ACMRT", "HEAD"]);
  if (!process.env.CI && workingTree.status === 0 && workingTree.stdout.trim()) {
    return workingTree.stdout.trim().split(/\r?\n/);
  }

  const baseRef = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "HEAD~1";
  const diff = run("git", ["diff", "--name-only", "--diff-filter=ACMRT", `${baseRef}...HEAD`]);
  if (diff.status === 0 && diff.stdout.trim()) return diff.stdout.trim().split(/\r?\n/);

  if (workingTree.status === 0 && workingTree.stdout.trim()) {
    return workingTree.stdout.trim().split(/\r?\n/);
  }

  return [];
}

const files = changedFiles().filter((file) => FORMAT_EXTENSIONS.test(file));
const target = "tests/unit/backend-targeting-safety.test.mjs";
const formatTargets = [...new Set([...files, target])];
const result = spawnSync("npx", ["prettier", "--write", ...formatTargets], { stdio: "inherit" });

console.log("---BEGIN FORMATTED TARGET---");
console.log(readFileSync(target, "utf8"));
console.log("---END FORMATTED TARGET---");
process.exit(result.status === 0 ? 1 : result.status ?? 1);
