import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalWorkspace } from "../workspace-files.mjs";

function fixture(run) {
  const outer = mkdtempSync(join(tmpdir(), "kova-workspace-"));
  const root = join(outer, "project");
  mkdirSync(root);
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, "node_modules"));
  writeFileSync(join(root, "src", "example.ts"), "const value = 1;\n");
  writeFileSync(join(root, "src", "other.md"), "# A document\n");
  writeFileSync(join(root, ".env"), "SECRET=do-not-open\n");
  writeFileSync(join(root, ".git", "config"), "private\n");
  writeFileSync(join(outer, "outside.ts"), "SECRET=outside\n");
  try {
    return run({ outer, root, files: createLocalWorkspace() });
  } finally {
    rmSync(outer, { force: true, recursive: true });
  }
}

test("local coding workspace needs explicit folder authorization", () =>
  fixture(({ files, root }) => {
    assert.deepEqual(files.info(), { name: null, selected: false });
    assert.throws(() => files.list(), /Choose a repository folder/);
    assert.throws(() => files.open("src/example.ts"), /Choose a repository folder/);
    assert.deepEqual(files.chooseFolder(root), { name: "project", selected: true });
    assert.deepEqual(
      files.list().map((entry) => entry.name),
      ["src"],
    );
    assert.deepEqual(
      files
        .list("src")
        .map((entry) => entry.path)
        .sort(),
      ["src/example.ts", "src/other.md"],
    );
    const open = files.open("src/example.ts");
    assert.equal(open.content, "const value = 1;\n");
    assert.match(open.hash, /^[a-f0-9]{64}$/u);
    files.close();
    assert.throws(() => files.open("src/example.ts"), /Choose a repository folder/);
  }));

test("path traversal, hidden files, symlinks and non-text files are rejected", () =>
  fixture(({ outer, root, files }) => {
    files.chooseFolder(root);
    for (const path of [
      "../outside.ts",
      "/etc/passwd",
      "src/../../outside.ts",
      ".env",
      ".git/config",
      "src\\example.ts",
      "C:/secrets.txt",
      "node_modules/index.js",
    ])
      assert.throws(() => files.open(path), undefined, path);
    symlinkSync(join(outer, "outside.ts"), join(root, "src", "escaped.ts"));
    assert.throws(() => files.open("src/escaped.ts"), /escapes|symbolic/u);
    assert.equal(
      files.list("src").some((entry) => entry.name === "escaped.ts"),
      false,
    );
    writeFileSync(join(root, "src", "blob.ts"), Buffer.from([0, 1, 2]));
    assert.throws(() => files.open("src/blob.ts"), /Binary/u);
    writeFileSync(join(root, "src", "huge.ts"), "x".repeat(512 * 1024 + 1));
    assert.throws(() => files.open("src/huge.ts"), /too large/u);
  }));

test("editing previews changes and saves only the latest opened version", () =>
  fixture(({ root, files }) => {
    files.chooseFolder(root);
    const initial = files.open("src/example.ts");
    const updated = "const value = 2;\n";
    const preview = files.preview("src/example.ts", updated, initial.hash);
    assert.equal(preview.changed, true);
    assert.deepEqual(preview.beforeLines, ["const value = 1;"]);
    assert.deepEqual(preview.afterLines, ["const value = 2;"]);
    assert.equal(preview.firstLine, 1);
    const result = files.save("src/example.ts", updated, initial.hash);
    assert.match(result.hash, /^[a-f0-9]{64}$/u);
    assert.equal(readFileSync(join(root, "src/example.ts"), "utf8"), updated);
    assert.throws(
      () => files.save("src/example.ts", "const value = 3;", initial.hash),
      /opened before editing/u,
    );
  }));

test("external disk changes cannot be silently overwritten", () =>
  fixture(({ root, files }) => {
    files.chooseFolder(root);
    const initial = files.open("src/example.ts");
    writeFileSync(join(root, "src/example.ts"), "a teammate updated this\n");
    assert.throws(
      () => files.preview("src/example.ts", "user edit", initial.hash),
      /changed on disk/u,
    );
    assert.throws(
      () => files.save("src/example.ts", "user edit", initial.hash),
      /changed on disk/u,
    );
    assert.equal(readFileSync(join(root, "src/example.ts"), "utf8"), "a teammate updated this\n");
  }));

test(
  "saving local source preserves executable permissions",
  { skip: process.platform === "win32" },
  () =>
    fixture(({ root, files }) => {
      const path = join(root, "src", "script.sh");
      writeFileSync(path, "#!/bin/sh\necho before\n");
      chmodSync(path, 0o755);
      files.chooseFolder(root);
      const original = files.open("src/script.sh");
      files.save("src/script.sh", "#!/bin/sh\necho after\n", original.hash);
      assert.equal(statSync(path).mode & 0o777, 0o755);
      assert.equal(readFileSync(path, "utf8"), "#!/bin/sh\necho after\n");
    }),
);
