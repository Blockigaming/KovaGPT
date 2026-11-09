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

if (files.length === 0) {
  console.log("No changed format-supported files to check.");
  process.exit(0);
}

const result = spawnSync("npx", ["prettier", "--check", ...files], { stdio: "inherit" });
if (result.status !== 0 && process.env.CI) {
  // Print a bounded, actionable formatting diff without changing committed source.
  const different = run("npx", ["prettier", "--list-different", ...files]);
  const targets = different.status === 1 ? different.stdout.trim().split(/\r?\n/).filter(Boolean) : [];
  if (targets.length > 0) {
    const formatted = run("npx", ["prettier", "--write", ...targets]);
    if (formatted.status === 0) {
      const diff = run("git", ["diff", "--", ...targets]);
      if (diff.status === 0 && diff.stdout) {
        console.error("Formatting changes needed (first 16 KiB):");
        console.error(diff.stdout.slice(0, 16 * 1024));
      }
    }
  }
}
process.exit(result.status ?? 1);
