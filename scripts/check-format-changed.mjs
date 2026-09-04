import { spawnSync } from "node:child_process";

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
const targets = [
  "src/components/TimersWidget.tsx",
  "tests/integration/timers-truthfulness-source.test.mjs"
];
const result = spawnSync("npx", ["prettier", "--write", ...targets], { stdio: "inherit" });
console.log("---BEGIN FORMAT DIFF---");
spawnSync("git", ["diff", "--", ...targets], { stdio: "inherit" });
console.log("---END FORMAT DIFF---");
process.exit(result.status === 0 ? 1 : (result.status ?? 1));
