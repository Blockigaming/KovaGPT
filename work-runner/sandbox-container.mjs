import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export const SANDBOX_LIMITS = Object.freeze({
  codeBytes: 64 * 1024,
  inputBytes: 8 * 1024 * 1024,
  outputBytes: 8 * 1024 * 1024,
  files: 16,
  logBytes: 64 * 1024,
  timeoutMs: 30000,
  concurrent: 2,
});
const LABEL = "com.kova.sandbox=python-v1";
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const IMAGE = /^(?:[a-z0-9][a-z0-9._/:-]{0,199}@)?sha256:[a-f0-9]{64}$/u;
const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const PROTOCOL_BYTES =
  Math.ceil(SANDBOX_LIMITS.outputBytes / 3) * 4 + 12 * SANDBOX_LIMITS.logBytes + 65536;
export class WorkSandboxError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const fail = (code) => {
  throw new WorkSandboxError(code);
};
function integer(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}
function fileName(value) {
  if (typeof value !== "string" || !NAME.test(value) || value === "." || value === "..")
    fail("sandbox_file_invalid");
  return value;
}
function prepare(job) {
  if (
    !job ||
    typeof job.jobId !== "string" ||
    !/^[A-Za-z0-9_-]{1,100}$/u.test(job.jobId) ||
    typeof job.code !== "string" ||
    Buffer.byteLength(job.code) > SANDBOX_LIMITS.codeBytes ||
    !job.code.trim()
  )
    fail("sandbox_request_invalid");
  const timeoutMs = job.timeoutMs ?? SANDBOX_LIMITS.timeoutMs;
  const maxOutputBytes = job.maxOutputBytes ?? SANDBOX_LIMITS.outputBytes;
  if (
    !integer(timeoutMs, 1000, SANDBOX_LIMITS.timeoutMs) ||
    !integer(maxOutputBytes, 1, SANDBOX_LIMITS.outputBytes) ||
    !Array.isArray(job.inputFiles) ||
    job.inputFiles.length > SANDBOX_LIMITS.files
  )
    fail("sandbox_request_invalid");
  const names = new Set();
  let size = 0;
  const inputFiles = job.inputFiles.map((file) => {
    const name = fileName(file?.name);
    if (names.has(name.toLowerCase()) || !(file.bytes instanceof Uint8Array))
      fail("sandbox_file_invalid");
    names.add(name.toLowerCase());
    size += file.bytes.byteLength;
    if (size > SANDBOX_LIMITS.inputBytes) fail("sandbox_input_limit");
    return { name, base64: Buffer.from(file.bytes).toString("base64") };
  });
  return { version: 1, jobId: job.jobId, code: job.code, inputFiles, timeoutMs, maxOutputBytes };
}
function decode(stdout, job) {
  let data;
  try {
    data = JSON.parse(stdout.toString("utf8"));
  } catch {
    fail("sandbox_protocol_invalid");
  }
  if (
    !data ||
    data.version !== 1 ||
    data.jobId !== job.jobId ||
    !integer(data.exitCode, -255, 255) ||
    typeof data.stdout !== "string" ||
    typeof data.stderr !== "string" ||
    Buffer.byteLength(data.stdout) > SANDBOX_LIMITS.logBytes ||
    Buffer.byteLength(data.stderr) > SANDBOX_LIMITS.logBytes ||
    !Array.isArray(data.outputs) ||
    data.outputs.length > SANDBOX_LIMITS.files
  )
    fail("sandbox_protocol_invalid");
  const names = new Set();
  let size = 0;
  const outputs = data.outputs.map((entry) => {
    const name = fileName(entry?.name);
    if (
      names.has(name.toLowerCase()) ||
      typeof entry.base64 !== "string" ||
      entry.base64.length > Math.ceil(job.maxOutputBytes / 3) * 4 ||
      !B64.test(entry.base64)
    )
      fail("sandbox_output_invalid");
    names.add(name.toLowerCase());
    const bytes = Buffer.from(entry.base64, "base64");
    if (bytes.toString("base64") !== entry.base64) fail("sandbox_output_invalid");
    size += bytes.byteLength;
    if (size > job.maxOutputBytes) fail("sandbox_output_limit");
    return { name, bytes: new Uint8Array(bytes) };
  });
  return { stdout: data.stdout, stderr: data.stderr, exitCode: data.exitCode, outputs };
}

/** This module executes only a fixed container CLI. Untrusted code is bytes on
 * stdin, never a host command, shell argument, environment value, or file path. */
export function createWorkSandboxExecutor(
  { enginePath = "/usr/bin/docker", image, maxConcurrent = 1 } = {},
  spawnForTests = spawn,
) {
  if (
    enginePath !== "/usr/bin/docker" ||
    typeof image !== "string" ||
    !IMAGE.test(image) ||
    !integer(maxConcurrent, 1, SANDBOX_LIMITS.concurrent)
  )
    fail("sandbox_configuration_invalid");
  let active = 0;
  const cleanupPending = new Set();
  const prefix = ["--host", "unix:///var/run/docker.sock"];
  function command(args, { input, signal, timeoutMs = 10000, maxBytes = 65536 } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new WorkSandboxError("sandbox_aborted"));
        return;
      }
      let child;
      try {
        child = spawnForTests(enginePath, [...prefix, ...args], {
          shell: false,
          windowsHide: true,
          stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
          env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
        });
      } catch {
        reject(new WorkSandboxError("sandbox_engine_unavailable"));
        return;
      }
      let failure,
        done = false,
        bytes = 0;
      const stdout = [],
        stderr = [];
      const stop = (code) => {
        failure ??= new WorkSandboxError(code);
        try {
          child.kill("SIGKILL");
        } catch {
          /* close/error remains authoritative */
        }
      };
      const abort = () =>
        stop(signal?.reason instanceof WorkSandboxError ? signal.reason.code : "sandbox_aborted");
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => stop("sandbox_timeout"), timeoutMs);
      // Never retain an unbounded pipe even if a broken process ignores kill.
      const finalTimer = setTimeout(
        () => finish(new WorkSandboxError("sandbox_engine_unresponsive")),
        timeoutMs + 2000,
      );
      function finish(error, code) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearTimeout(finalTimer);
        signal?.removeEventListener("abort", abort);
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.stdin?.destroy();
        if (error || failure) reject(error || failure);
        else resolve({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
      }
      const collect = (destination) => (chunk) => {
        if (done || failure) return;
        bytes += chunk.length;
        if (bytes > maxBytes) {
          stop("sandbox_stream_limit");
          return;
        }
        destination.push(Buffer.from(chunk));
      };
      child.stdout?.on("data", collect(stdout));
      child.stderr?.on("data", collect(stderr));
      child.once("error", () => finish(new WorkSandboxError("sandbox_engine_unavailable")));
      child.once("close", (code) => finish(null, code));
      child.stdin?.on("error", () => stop("sandbox_input_unavailable"));
      if (input !== undefined) child.stdin.end(input);
      if (signal?.aborted) abort();
    });
  }
  async function remove(name) {
    try {
      const result = await command(["rm", "--force", "--volumes", name], { timeoutMs: 5000 });
      if (result.code !== 0 && !/No such container/iu.test(result.stderr.toString("utf8")))
        fail("sandbox_cleanup_unconfirmed");
      cleanupPending.delete(name);
    } catch {
      cleanupPending.add(name);
      fail("sandbox_cleanup_unconfirmed");
    }
  }
  async function probe({ signal } = {}) {
    if (cleanupPending.size) return { ready: false, code: "sandbox_cleanup_unconfirmed" };
    try {
      const runtime = await command(["info", "--format", "{{json .Runtimes}}"], {
        signal,
        timeoutMs: 5000,
      });
      if (runtime.code !== 0) fail("sandbox_engine_unavailable");
      const runtimes = JSON.parse(runtime.stdout.toString("utf8"));
      if (!runtimes?.runsc || !/(?:^|\/)runsc$/u.test(runtimes.runsc.path ?? ""))
        fail("sandbox_runtime_unavailable");
      const found = await command(["image", "inspect", "--format", "{{json .}}", image], {
        signal,
        timeoutMs: 5000,
      });
      const info = JSON.parse(found.stdout.toString("utf8"));
      const exactImage = image.startsWith("sha256:")
        ? info?.Id === image
        : Array.isArray(info?.RepoDigests) &&
          info.RepoDigests.some(
            (digest) =>
              typeof digest === "string" && digest.endsWith(image.slice(image.indexOf("@sha256:"))),
          );
      if (found.code !== 0 || !exactImage) fail("sandbox_image_unavailable");
      return { ready: true, runtime: "runsc", image };
    } catch (error) {
      return {
        ready: false,
        code: error instanceof WorkSandboxError ? error.code : "sandbox_probe_failed",
      };
    }
  }
  async function run(value, { signal } = {}) {
    const job = prepare(value);
    if (signal?.aborted) fail("sandbox_aborted");
    if (cleanupPending.size) fail("sandbox_cleanup_unconfirmed");
    if (active >= maxConcurrent) fail("sandbox_capacity");
    active++;
    const name = "kova-python-" + randomUUID();
    const controller = new AbortController(),
      abort = () => controller.abort(new WorkSandboxError("sandbox_aborted"));
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new WorkSandboxError("sandbox_timeout")),
      job.timeoutMs,
    );
    let result, error;
    try {
      const readiness = await probe({ signal: controller.signal });
      if (!readiness.ready) fail(readiness.code);
      // The create/start split means an uncertain late create can leave only an
      // inert, expiring labeled container. Code is sent only after create confirms.
      const created = await command(
        [
          "create",
          "--name",
          name,
          "--label",
          LABEL,
          "--label",
          `com.kova.expires=${Date.now() + job.timeoutMs + 10000}`,
          "--pull=never",
          "--runtime=runsc",
          "--init",
          "--interactive",
          "--read-only",
          "--user=65532:65532",
          "--network=none",
          "--cap-drop=ALL",
          "--security-opt=no-new-privileges=true",
          "--log-driver=none",
          "--memory=268435456",
          "--memory-swap=268435456",
          "--cpus=1",
          "--pids-limit=32",
          "--ulimit=cpu=20:20",
          "--ulimit=nofile=64:64",
          "--ulimit=fsize=8388608:8388608",
          "--shm-size=8388608",
          "--stop-timeout=0",
          "--tmpfs=/job:rw,noexec,nosuid,nodev,size=67108864,mode=1777",
          "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=8388608,mode=1777",
          "--workdir=/job",
          "--entrypoint=/usr/local/bin/python3",
          image,
          "-I",
          "-B",
          "/opt/kova/execute.py",
        ],
        { signal: controller.signal, timeoutMs: Math.min(job.timeoutMs, 10000) },
      );
      if (created.code !== 0 || !/^[a-f0-9]{64}\s*$/u.test(created.stdout.toString("utf8")))
        fail("sandbox_create_failed");
      if (controller.signal.aborted) throw controller.signal.reason;
      const executed = await command(["start", "--attach", "--interactive", name], {
        input: JSON.stringify(job),
        signal: controller.signal,
        timeoutMs: job.timeoutMs,
        maxBytes: PROTOCOL_BYTES,
      });
      if (executed.code !== 0) {
        const detail = executed.stderr.toString("utf8").trim();
        if (/^sandbox_execution_failed_[a-z_]+$/u.test(detail)) fail(detail);
        const category = [
          ["mount", /mount|tmpfs/iu],
          ["limit", /ulimit|rlimit/iu],
          ["cgroup", /cgroup/iu],
          ["policy", /seccomp|security|capab|permission|operation not permitted/iu],
          ["entrypoint", /exec|entrypoint|executable/iu],
          ["network", /network/iu],
          ["init", /init/iu],
        ].find(([, pattern]) => pattern.test(detail))?.[0];
        fail(`sandbox_start_${category ?? "unknown"}`);
      }
      result = decode(executed.stdout, job);
    } catch (cause) {
      error = cause;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      // Cleanup uses an independent bounded request even after caller abort.
      try {
        await remove(name);
      } catch (cause) {
        error = cause;
      }
      active--;
    }
    if (error) throw error;
    if (signal?.aborted) fail("sandbox_aborted");
    return result;
  }
  async function reapExpired({ signal } = {}) {
    const now = Date.now();
    let removed = 0;
    for (const name of cleanupPending) {
      signal?.throwIfAborted();
      await remove(name);
      removed++;
      if (removed === 10) return { removed };
    }
    const listed = await command(
      [
        "ps",
        "--all",
        "--filter",
        "label=" + LABEL,
        "--format",
        '{{.ID}} {{.Label "com.kova.expires"}}',
      ],
      { signal },
    );
    if (listed.code !== 0) fail("sandbox_cleanup_unconfirmed");
    for (const line of listed.stdout.toString("utf8").split("\n")) {
      const match = /^([a-f0-9]{12,64}) ([0-9]{13})$/u.exec(line);
      if (!match || Number(match[2]) > now) continue;
      signal?.throwIfAborted();
      await remove(match[1]);
      removed++;
      if (removed === 10) break;
    }
    return { removed };
  }
  return { run, probe, reapExpired };
}
