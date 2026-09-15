import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const result = spawnSync(
  "python3",
  [
    "-c",
    `
import importlib.util, json, tempfile, zipfile
from pathlib import Path
spec=importlib.util.spec_from_file_location("reports", "scripts/release/validate-playwright-reports.py")
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
results={}
for case in ["valid", "missing", "truncated", "unfinished", "unsafe", "duplicate", "symlink"]:
    with tempfile.TemporaryDirectory() as tmp:
        root=Path(tmp)/"input"; root.mkdir(); out=Path(tmp)/"output"
        for name in module.EXPECTED:
            directory=root/name; directory.mkdir()
            with zipfile.ZipFile(directory/"report.zip", "w") as z:
                journal="".join(json.dumps({"method":method})+"\\n" for method in ["onConfigure","onBegin","onEnd"])
                z.writestr("report.jsonl", journal)
        directory=root/"e2e-blob-1"; target=directory/"report.zip"
        if case=="missing": target.unlink(); directory.rmdir()
        if case=="truncated": target.write_bytes(target.read_bytes()[:-25])
        if case=="unfinished":
            with zipfile.ZipFile(target,"w") as z: z.writestr("report.jsonl", '{"method":"onBegin"}\\n')
        if case=="unsafe":
            with zipfile.ZipFile(target,"a") as z: z.writestr("../unsafe", "x")
        if case=="duplicate": (directory/"second.zip").write_bytes(target.read_bytes())
        if case=="symlink": target.rename(directory/"actual"); target.symlink_to(directory/"actual")
        try:
            results[case]={"passed":module.validate(root,out)==12,"output":out.exists()}
        except (ValueError,OSError,zipfile.BadZipFile):
            results[case]={"passed":False,"output":out.exists()}
print(json.dumps(results))
`,
  ],
  { encoding: "utf8", timeout: 10_000 },
);

test("report integrity requires all shards and rejects partial or unsafe downloads", () => {
  assert.equal(result.status, 0, result.stderr);
  const cases = JSON.parse(result.stdout);
  assert.deepEqual(cases.valid, { passed: true, output: true });
  for (const name of ["missing", "truncated", "unfinished", "unsafe", "duplicate", "symlink"]) {
    assert.deepEqual(cases[name], { passed: false, output: false }, name);
  }
});

test("CI retries transport in fresh directories, then validates before merging", () => {
  const source = readFileSync(".github/workflows/ci.yml", "utf8");
  const section = source.slice(
    source.indexOf("\n  e2e-report:"),
    source.indexOf("\n  isolated-database:"),
  );
  for (const attempt of [1, 2, 3]) assert.ok(section.includes(`path: blob-download-${attempt}`));
  assert.equal((section.match(/merge-multiple: false/g) ?? []).length, 3);
  assert.ok(
    section.indexOf("validate-playwright-reports.py") <
      section.indexOf("npx playwright merge-reports"),
  );
  assert.doesNotMatch(
    section.slice(section.indexOf("id: download_3"), section.indexOf("- name: Validate")),
    /continue-on-error/,
  );
  assert.doesNotMatch(section, /skipping report merge|available ==/);
  assert.match(section, /if-no-files-found: error/);
});

test("settings touch-target coverage measures the visible mobile list", () => {
  const source = readFileSync("tests/e2e/settings-theme-transition.spec.ts", "utf8");
  const back = source.indexOf('name: "Back to settings"');
  assert.ok(back > 0 && back < source.indexOf("await expect(options).toHaveCount(20)"));
  assert.match(source, /await expect\(options\.nth\(index\)\)\.toBeVisible\(\)/);
  assert.match(source, /toBeGreaterThanOrEqual\(\s*44/);
});
