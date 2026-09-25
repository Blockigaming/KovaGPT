import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fingerprintDist } from "../e2e/candidate-dist-fingerprint.mjs";

test("candidate fingerprint tracks a package symlink without following it", async () => {
  const root = await mkdtemp(join(tmpdir(), "kova-dist-fingerprint-"));
  try {
    const dist = join(root, "dist");
    await mkdir(join(dist, "server"), { recursive: true });
    await writeFile(join(dist, "server", "entry.mjs"), "export default 1");
    await symlink("../../node_modules/tslib", join(dist, "server", "tslib"));
    const original = await fingerprintDist(dist);
    assert.equal(await fingerprintDist(dist), original);
    await rm(join(dist, "server", "tslib"));
    await symlink("../../node_modules/other", join(dist, "server", "tslib"));
    assert.notEqual(await fingerprintDist(dist), original);
    await writeFile(join(dist, "server", "entry.mjs"), "export default 2");
    assert.notEqual(await fingerprintDist(dist), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
