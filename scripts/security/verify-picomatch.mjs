import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export function verifyPicomatch(root = process.cwd()) {
  const vendor = resolve(root, "vendor/picomatch");
  const manifest = JSON.parse(readFileSync(join(root, "scripts/security/picomatch-backport.json")));
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json")));
  const pkg = JSON.parse(readFileSync(join(root, "package.json")));
  assert.equal(pkg.dependencies.picomatch, "file:vendor/picomatch");
  assert.equal(pkg.overrides.picomatch, "$picomatch");
  const copies = Object.keys(lock.packages).filter((path) =>
    /(?:^|\/)node_modules\/picomatch$/.test(path),
  );
  assert.deepEqual(copies, ["node_modules/picomatch"], "Unexpected Picomatch copy in lockfile");
  assert.deepEqual(lock.packages[copies[0]], { resolved: "vendor/picomatch", link: true });
  assert.equal(lock.packages["vendor/picomatch"].version, manifest.upstreamVersion);
  assert.equal(realpathSync(join(root, "node_modules/picomatch")), realpathSync(vendor));
  for (const [path, dependency] of Object.entries(lock.packages)) {
    if (path && !path.startsWith("node_modules/")) continue;
    if (!dependency.dependencies?.picomatch && !dependency.peerDependencies?.picomatch) continue;
    const require = createRequire(join(root, path, "package.json"));
    assert.equal(
      realpathSync(require.resolve("picomatch/package.json")),
      join(realpathSync(vendor), "package.json"),
      `Unpatched consumer resolution: ${path || "root"}`,
    );
  }
  const files = readdirSync(vendor, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(vendor.length + 1)
        .replaceAll("\\", "/"),
    )
    .filter((path) => path !== "KOVA-PATCH.md")
    .sort();
  assert.deepEqual(files, Object.keys(manifest.sha256).sort(), "Unexpected vendored files");
  for (const [path, expected] of Object.entries(manifest.sha256)) {
    const digest = createHash("sha256")
      .update(readFileSync(join(vendor, path)))
      .digest("hex");
    assert.equal(digest, expected, `Unreviewed Picomatch content: ${path}`);
  }
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  verifyPicomatch();
  console.log("Verified the installed Picomatch security backport and all source fingerprints.");
}
