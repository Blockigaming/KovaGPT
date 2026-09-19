import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, posix, relative, resolve, sep } from "node:path";

const SHA = /^[a-f0-9]{40}$/u;
const fail = (code) => {
  throw new Error(`upgrade_source_${code}`);
};
const blobHash = (bytes) =>
  createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

// Inspect source without modifying the index, checkout, refs, or working files.
// Git status alone can miss assume-unchanged/skip-worktree and ignored inputs.
export function captureCleanUpgradeSource(directory) {
  let root;
  try {
    root = realpathSync(resolve(directory));
  } catch {
    fail("root_invalid");
  }
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  Object.assign(env, {
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  });
  const git = (...args) => {
    const result = spawnSync(
      "git",
      [
        "--no-optional-locks",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.untrackedCache=false",
        "-C",
        root,
        ...args,
      ],
      { env, encoding: "utf8", timeout: 15_000, maxBuffer: 16 * 1024 * 1024 },
    );
    if (result.error || result.status !== 0) fail("git_failed");
    return result.stdout;
  };
  const status = () =>
    git("status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none");
  if (git("rev-parse", "--show-toplevel").trim() !== root) fail("root_mismatch");
  if (status().length) fail("worktree_dirty");
  const commit = git("rev-parse", "--verify", "HEAD").trim();
  const tree = git("rev-parse", "--verify", `${commit}^{tree}`).trim();
  if (!SHA.test(commit) || !SHA.test(tree)) fail("identity_invalid");
  const files = new Map();
  for (const entry of git("ls-tree", "-rz", "--full-tree", tree).split("\0").filter(Boolean)) {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t([\s\S]+)$/u.exec(entry);
    if (!match) fail("unsupported_entry");
    const [, mode, oid, path] = match;
    if (
      path.startsWith("/") ||
      path.includes("\\") ||
      posix.normalize(path) !== path ||
      path.split("/").includes("..") ||
      files.has(path)
    )
      fail("path_invalid");
    files.set(path, { mode, oid });
  }
  if (!files.size) fail("empty_tree");
  const readFile = (filename) => {
    const absolute = resolve(filename);
    const path = relative(root, absolute).split(sep).join("/");
    const entry = files.get(path);
    if (!entry) fail("input_untracked");
    let bytes, mode;
    try {
      const info = lstatSync(absolute);
      if (!info.isFile() || realpathSync(absolute) !== absolute) fail("entry_not_regular");
      mode = info.mode;
      bytes = readFileSync(absolute);
    } catch {
      fail("entry_unreadable");
    }
    if (blobHash(bytes) !== entry.oid || Boolean(mode & 0o111) !== (entry.mode === "100755"))
      fail("tracked_bytes_changed");
    return bytes;
  };
  for (const path of files.keys()) readFile(join(root, path));
  if (
    git("rev-parse", "--verify", "HEAD").trim() !== commit ||
    git("rev-parse", "--verify", "HEAD^{tree}").trim() !== tree ||
    status().length
  )
    fail("changed_during_capture");
  // Bind membership as well as contents. A file missing during directory
  // discovery must not vanish from the plan merely because it is restored later.
  const readDirectory = (directory) => {
    const absolute = resolve(directory);
    const path = relative(root, absolute).split(sep).join("/");
    const prefix = `${path}/`;
    const expected = [
      ...new Set(
        [...files.keys()]
          .filter((file) => file.startsWith(prefix))
          .map((file) => file.slice(prefix.length).split("/")[0]),
      ),
    ].sort();
    if (!expected.length) fail("input_untracked");
    let observed;
    try {
      if (!lstatSync(absolute).isDirectory() || realpathSync(absolute) !== absolute)
        fail("entry_not_regular");
      observed = readdirSync(absolute).sort();
    } catch {
      fail("directory_unreadable");
    }
    if (observed.some((name) => !expected.includes(name))) fail("input_untracked");
    if (JSON.stringify(observed) !== JSON.stringify(expected)) fail("directory_inventory_changed");
    // Return captured names, not the live listing, and do not expose mutable state.
    return expected;
  };
  // Each consumed buffer and its filename inventory belong to this one tree.
  return Object.freeze({ commit, tree, trackedFileCount: files.size, readFile, readDirectory });
}

export function assertUpgradeSourceUnchanged(before, after) {
  for (const source of [before, after]) {
    if (
      !source ||
      typeof source.commit !== "string" ||
      !SHA.test(source.commit) ||
      typeof source.tree !== "string" ||
      !SHA.test(source.tree) ||
      !Number.isSafeInteger(source.trackedFileCount) ||
      source.trackedFileCount < 1 ||
      typeof source.readFile !== "function" ||
      typeof source.readDirectory !== "function"
    )
      fail("receipt_invalid");
  }
  if (
    before.commit !== after.commit ||
    before.tree !== after.tree ||
    before.trackedFileCount !== after.trackedFileCount
  )
    fail("changed_during_rehearsal");
}
