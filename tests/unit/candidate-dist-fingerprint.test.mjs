import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fingerprint } from "../e2e/candidate-dist-fingerprint.mjs";

test("fingerprint accepts Node output symlinks and detects changed link targets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kova-dist-fingerprint-"));
  try {
    await writeFile(join(directory, "server.mjs"), "server");
    await symlink("../node_modules/tslib", join(directory, "tslib"));
    const before = await fingerprint(directory);
    assert.equal(before, await fingerprint(directory));
    await rm(join(directory, "tslib"));
    await symlink("../node_modules/other", join(directory, "tslib"));
    assert.notEqual(before, await fingerprint(directory));
    await writeFile(join(directory, "server.mjs"), "changed");
    assert.notEqual(before, await fingerprint(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
