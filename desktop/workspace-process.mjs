import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";

export const MAX_COMMAND_LENGTH = 4096;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_HISTORY = 30;

export function validateCommand(command) {
  if (
    typeof command !== "string" ||
    !command.trim() ||
    command.length > MAX_COMMAND_LENGTH ||
    command.includes("\0")
  )
    throw new Error("Enter a command of 1–4096 characters");
  return command;
}

// Do not pass Electron flags, provider credentials, or injected Git settings to children.
export function localProcessEnvironment(source = process.env) {
  const result = {};
  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "HOME",
    "USERPROFILE",
    "TMP",
    "TEMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
  ])
    if (typeof source[key] === "string") result[key] = source[key];
  return result;
}

function terminateTree(child) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") {
      const systemRoot = process.env.SystemRoot || "C:\\Windows";
      const killer = spawn(
        join(systemRoot, "System32", "taskkill.exe"),
        ["/pid", String(child.pid), "/T", "/F"],
        { windowsHide: true, stdio: "ignore", shell: false },
      );
      killer.on("error", () => child.kill());
    } else process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill();
  }
}

/** An explicit local terminal, never exposed to the remote chat renderer. */
export function createLocalCommandRunner({
  timeoutMs = 120_000,
  maxOutputBytes = MAX_OUTPUT_BYTES,
} = {}) {
  const history = [];
  let active = null;
  let disposed = false;
  return {
    start(root, command) {
      if (disposed) throw new Error("Command runner is closed");
      if (active) throw new Error("Stop the running command before starting another");
      validateCommand(command);
      if (realpathSync(root) !== root || !statSync(root).isDirectory())
        throw new Error("Repository folder is no longer available");
      const record = {
        id: randomUUID(),
        command,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        output: "",
        exitCode: null,
        signal: null,
        state: "running",
        truncated: false,
      };
      let bytes = 0;
      let stopReason = null;
      const child =
        process.platform === "win32"
          ? spawn(
              join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe"),
              ["/d", "/s", "/c", command],
              {
                cwd: root,
                env: localProcessEnvironment(),
                shell: false,
                windowsHide: true,
                stdio: ["ignore", "pipe", "pipe"],
              },
            )
          : spawn("/bin/sh", ["-c", command], {
              cwd: root,
              env: localProcessEnvironment(),
              shell: false,
              detached: true,
              stdio: ["ignore", "pipe", "pipe"],
            });
      const stop = (reason) => {
        if (stopReason) return;
        stopReason = reason;
        record.state = "stopping";
        terminateTree(child);
      };
      const timer = setTimeout(() => stop("timed-out"), timeoutMs);
      timer.unref();
      active = { record, stop };
      history.unshift(record);
      if (history.length > MAX_HISTORY) history.pop();
      for (const stream of [child.stdout, child.stderr]) {
        stream.setEncoding("utf8");
        stream.on("data", (chunk) => {
          const remaining = maxOutputBytes - bytes;
          const data = Buffer.from(chunk);
          if (remaining > 0) {
            const accepted = data.subarray(0, remaining);
            record.output += accepted.toString("utf8");
            bytes += accepted.length;
          }
          if (data.length > remaining) {
            record.truncated = true;
            stop("output-limit");
          }
        });
      }
      child.on("error", (error) => {
        record.output = `Unable to start command: ${error.code || "unknown error"}`;
        stopReason = "failed";
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        record.exitCode = code;
        record.signal = signal;
        record.state = stopReason || (code === 0 ? "completed" : "failed");
        record.finishedAt = new Date().toISOString();
        if (active?.record === record) active = null;
      });
      return { id: record.id };
    },
    snapshot() {
      return history.map((record) => ({ ...record }));
    },
    isBusy() {
      return Boolean(active);
    },
    cancel() {
      if (!active) return { cancelled: false };
      active.stop("cancelled");
      return { cancelled: true };
    },
    clear() {
      if (active) throw new Error("Stop the running command before clearing history");
      history.length = 0;
    },
    dispose() {
      disposed = true;
      if (active) active.stop("cancelled");
      history.length = 0;
    },
  };
}

/** Read-only Git inspection, with external diff drivers, textconv and fsmonitor disabled. */
export function readGit(root, operation) {
  const commands = {
    status: ["status", "--short", "--branch", "--untracked-files=normal"],
    diff: ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--stat", "--patch", "--", "."],
    staged: [
      "diff",
      "--cached",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--stat",
      "--patch",
      "--",
      ".",
    ],
    log: ["log", "-20", "--format=%h %s", "--no-show-signature"],
  };
  if (typeof operation !== "string" || !Object.hasOwn(commands, operation))
    throw new Error("Unsupported Git view");
  if (!existsSync(join(root, ".git")))
    throw new Error("Choose the root folder of a Git repository");
  return new Promise((resolve, reject) => {
    let output = "";
    let size = 0;
    let failure = null;
    const child = spawn(
      "git",
      [
        "--no-pager",
        "--no-optional-locks",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "diff.external=",
        "-c",
        "color.ui=false",
        ...commands[operation],
      ],
      {
        cwd: root,
        env: { ...localProcessEnvironment(), GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1" },
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const timer = setTimeout(() => {
      failure = new Error("Git inspection timed out");
      terminateTree(child);
    }, 10_000);
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        size += Buffer.byteLength(chunk);
        if (size > MAX_OUTPUT_BYTES) {
          failure = new Error("Git output exceeds 256 KiB; inspect a smaller change locally");
          terminateTree(child);
        } else output += chunk;
      });
    }
    child.on("error", (error) => {
      failure = new Error(
        error.code === "ENOENT"
          ? "Install Git to inspect this repository"
          : "Git could not be started",
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(output.trim() || "Git inspection failed"));
      else resolve({ operation, output: output || "No changes." });
    });
  });
}
