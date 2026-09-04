import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const sourceRoot = process.cwd();
const host = process.env.KOVA_AUTH_VISUAL_HOST || "127.0.0.1";
const port = process.env.KOVA_AUTH_VISUAL_PORT || "8081";
const fixtureRoot = await mkdtemp(join(tmpdir(), "kova-auth-visual-"));
const archivePath = join(fixtureRoot, "source.tar");
const candidateDist = join(sourceRoot, "dist");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

let activeChild;
let shuttingDown = false;

function terminateChild() {
  if (activeChild && activeChild.exitCode === null && activeChild.signalCode === null) {
    activeChild.kill("SIGTERM");
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shuttingDown = true;
    terminateChild();
  });
}

async function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd || sourceRoot,
    env: process.env,
    stdio: "inherit",
  });
  activeChild = child;

  const { code, signal } = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, exitSignal) => resolve({ code: exitCode, signal: exitSignal }));
  });
  activeChild = undefined;

  if (!shuttingDown && code !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${code ?? signal}`);
  }

  return { code, signal };
}

async function listFiles(directory, prefix = "") {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = join(directory, entry.name);
    const relativePath = join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(absolutePath, relativePath)));
    } else if (entry.isFile()) {
      files.push({ absolutePath, relativePath });
    } else {
      throw new Error(`Unexpected entry in candidate dist: ${relative(directory, absolutePath)}`);
    }
  }
  return files;
}

async function fingerprint(directory) {
  const hash = createHash("sha256");
  const files = await listFiles(directory);
  hash.update(`files:${files.length}\0`);
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(await readFile(file.absolutePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

try {
  const candidateFingerprint = await fingerprint(candidateDist);

  // Archive only tracked files: untracked .env files, credentials, build output,
  // and deployed-audit evidence cannot enter this isolated fixture workspace.
  await run("git", ["archive", "--format=tar", "--output", archivePath, "HEAD"]);
  await run("tar", ["-xf", archivePath, "-C", fixtureRoot]);
  await rm(archivePath, { force: true });

  await run(npmCommand, ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], {
    cwd: fixtureRoot,
  });
  await run(npmCommand, ["run", "build"], { cwd: fixtureRoot });

  const fingerprintAfterBuild = await fingerprint(candidateDist);
  if (candidateFingerprint !== fingerprintAfterBuild) {
    throw new Error("The isolated auth fixture modified the candidate dist directory.");
  }

  if (!shuttingDown) {
    await run(
      npmCommand,
      ["run", "preview", "--", "--host", host, "--port", port, "--strictPort"],
      { cwd: fixtureRoot },
    );
  }
} finally {
  terminateChild();
  await rm(fixtureRoot, { recursive: true, force: true });
}
