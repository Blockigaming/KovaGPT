import { spawnSync } from "node:child_process";

const targets = [
  "src/components/SettingsDialog.tsx",
  "src/lib/shortcuts.ts",
  "tests/integration/shortcut-truthfulness-source.test.mjs",
];
const result = spawnSync("npx", ["prettier", "--write", ...targets], { stdio: "inherit" });
const diff = spawnSync("git", ["diff", "--", ...targets], { encoding: "utf8" });

console.log("KOVA_FORMAT_DIFF_BEGIN");
process.stdout.write(diff.stdout || "");
console.log("KOVA_FORMAT_DIFF_END");

if (result.error) console.error(result.error);
process.exit(1);
