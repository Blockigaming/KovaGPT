import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

const sourceRoot = process.cwd();
const host = process.env.KOVA_AUTH_VISUAL_HOST || "127.0.0.1";
const port = process.env.KOVA_AUTH_VISUAL_PORT || "8081";
const fixtureRoot = await mkdtemp(join(tmpdir(), "kova-auth-visual-"));
const candidateDist = join(sourceRoot, "dist");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const excludedTreePrefixes = [
  "artifacts/",
  "coverage/",
  "dist/",
  "node_modules/",
  "playwright-report/",
  "test-results/",
];

const inheritedChildEnvironmentNames = new Set([
  "CI",
  "COMSPEC",
  "FORCE_COLOR",
  "GITHUB_ACTIONS",
  "HOME",
  "LANG",
  "LC_ALL",
  "NODE_EXTRA_CA_CERTS",
  "NODE_OPTIONS",
  "NPM_CONFIG_CACHE",
  "PATH",
  "PATHEXT",
  "RUNNER_ARCH",
  "RUNNER_OS",
  "SHELL",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SystemRoot",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "TZ",
  "USER",
  "npm_config_cache",
]);
const childEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) => inheritedChildEnvironmentNames.has(name) || name.startsWith("LC_"),
  ),
);
childEnvironment.KOVA_BROWSER_PREVIEW = "node";
childEnvironment.VITE_SUPABASE_URL = `http://${host}:${port}`;
childEnvironment.VITE_SUPABASE_PUBLISHABLE_KEY = "auth-visual-public-key";

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
  const output = [];
  const child = spawn(command, args, {
    cwd: options.cwd || sourceRoot,
    env: childEnvironment,
    stdio: options.captureStdout ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  activeChild = child;
  child.stdout?.on("data", (chunk) => output.push(chunk));

  const { code, signal } = await new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, exitSignal) =>
      resolvePromise({ code: exitCode, signal: exitSignal }),
    );
  });
  activeChild = undefined;

  if (!shuttingDown && code !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${code ?? signal}`);
  }

  return { code, signal, stdout: Buffer.concat(output) };
}

function isExcludedTrackedPath(path) {
  const portablePath = path.replaceAll("\\", "/");
  if (excludedTreePrefixes.some((prefix) => portablePath.startsWith(prefix))) return true;

  const baseName = portablePath.split("/").at(-1) || "";
  return baseName.startsWith(".env") && baseName !== ".env.example";
}

async function copyTrackedWorkingTree() {
  const { stdout } = await run("git", ["ls-files", "-z", "--cached"], {
    captureStdout: true,
  });
  const paths = stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  for (const path of paths) {
    if (isAbsolute(path) || normalize(path) === ".." || normalize(path).startsWith(`..${sep}`)) {
      throw new Error(`Unsafe tracked fixture path: ${path}`);
    }
    if (isExcludedTrackedPath(path)) continue;

    const source = resolve(sourceRoot, path);
    const destination = resolve(fixtureRoot, path);
    if (
      !source.startsWith(`${sourceRoot}${sep}`) ||
      !destination.startsWith(`${fixtureRoot}${sep}`)
    ) {
      throw new Error(`Tracked fixture path escaped its workspace: ${path}`);
    }

    let stats;
    try {
      stats = await lstat(source);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (!stats.isFile()) {
      throw new Error(`Tracked fixture entry is not a regular file: ${path}`);
    }

    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    await chmod(destination, stats.mode & 0o777);
  }
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

  // Copy exactly the tracked working-tree state. This includes staged and
  // unstaged source edits while excluding untracked files, local environment
  // files, credentials, dependencies, build output, and prior test evidence.
  await copyTrackedWorkingTree();

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
