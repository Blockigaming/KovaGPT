import { spawnSync } from "node:child_process";

const files = [
  "src/lib/shortcuts.ts",
  "src/components/SettingsDialog.tsx",
  "tests/integration/shortcut-truthfulness-source.test.mjs",
];

const formatted = spawnSync("npx", ["prettier", "--write", ...files], {
  encoding: "utf8",
});
process.stdout.write(formatted.stdout);
process.stderr.write(formatted.stderr);
const diff = spawnSync("git", ["diff", "--", ...files], { encoding: "utf8" });
console.log("=== SHORTCUT_FORMAT_DIFF_START ===");
process.stdout.write(diff.stdout);
console.log("=== SHORTCUT_FORMAT_DIFF_END ===");
process.exit(1);
