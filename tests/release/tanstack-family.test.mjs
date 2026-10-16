import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  approvedTanstackFamily,
  verifyTanstackFamily,
} from "../../scripts/release/tanstack-family.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "kova-tanstack-family-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = pathToFileURL(`${directory}/`);
  const dependencies = Object.fromEntries(
    Object.entries(approvedTanstackFamily).filter(
      ([name]) => name !== "@tanstack/start-server-core",
    ),
  );
  const packages = { "": { dependencies } };
  for (const [name, version] of Object.entries(approvedTanstackFamily)) {
    const path = `node_modules/${name}`;
    packages[path] = { version };
    await mkdir(new URL(`${path}/`, root), { recursive: true });
    await writeFile(new URL(`${path}/package.json`, root), JSON.stringify({ name, version }));
  }
  await writeFile(new URL("package.json", root), JSON.stringify({ dependencies }));
  await writeFile(
    new URL("package-lock.json", root),
    JSON.stringify({ lockfileVersion: 3, packages }),
  );
  return root;
}

test("the complete patched TanStack family passes manifest, lock and installed checks", async (t) => {
  await verifyTanstackFamily(await fixture(t));
});

test("a patched root cannot hide a nested vulnerable server transport", async (t) => {
  const root = await fixture(t);
  const lockPath = new URL("package-lock.json", root);
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  lock.packages["node_modules/legacy/node_modules/@tanstack/start-server-core"] = {
    version: "1.169.38",
  };
  await writeFile(lockPath, JSON.stringify(lock));
  await assert.rejects(
    verifyTanstackFamily(root),
    /Unapproved TanStack lock resolution.*1\.169\.38/,
  );
});

test("an installed vulnerable transport fails even when the lock claims the patched version", async (t) => {
  const root = await fixture(t);
  await writeFile(
    new URL("node_modules/@tanstack/start-server-core/package.json", root),
    JSON.stringify({ version: "1.169.38" }),
  );
  await assert.rejects(verifyTanstackFamily(root), /Unapproved TanStack installed resolution/);
});

test("manifest drift fails before release even when installed packages remain approved", async (t) => {
  const root = await fixture(t);
  const manifestPath = new URL("package.json", root);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.dependencies["@tanstack/react-start"] = "^1.168.60";
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(verifyTanstackFamily(root), /Unapproved TanStack manifest pin/);
});
