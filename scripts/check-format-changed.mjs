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
if (process.env.CI && result.status === 1) {
  const different = run("npx", ["prettier", "--list-different", ...files]);
  const mismatches = different.stdout?.split(/\r?\n/).filter((file) => files.includes(file)) ?? [];
  for (const file of mismatches.slice(0, 20)) {
    const formatted = run("npx", ["prettier", file]);
    if (formatted.status !== 0 || !formatted.stdout || formatted.stdout.length > 262144) continue;
    console.log(`KOVA_FORMATTED_FILE_BEGIN ${JSON.stringify(file)}`);
    const encoded = Buffer.from(formatted.stdout, "utf8").toString("base64");
    for (let index = 0; index < encoded.length; index += 120)
      console.log(encoded.slice(index, index + 120));
    console.log("KOVA_FORMATTED_FILE_END");
  }
}
process.exit(result.status ?? 1);
