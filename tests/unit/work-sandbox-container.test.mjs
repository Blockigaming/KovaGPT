import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createWorkSandboxExecutor, SANDBOX_LIMITS } from "../../work-runner/sandbox-container.mjs";
const image = "registry.example/kova-python@sha256:" + "a".repeat(64);
const job = {
  jobId: "job_123",
  code: "print('hello')",
  inputFiles: [{ name: "source.csv", bytes: Buffer.from("n\n1\n2\n") }],
  timeoutMs: 5000,
  maxOutputBytes: 10000,
};
const result = {
  version: 1,
  jobId: job.jobId,
  stdout: "hello\n",
  stderr: "",
  exitCode: 0,
  outputs: [{ name: "result.csv", base64: Buffer.from("sum\n3\n").toString("base64") }],
};
function fakeEngine(respond = () => undefined) {
  const calls = [];
  const spawn = (file, args, options) => {
    const child = new EventEmitter();
    let input = "",
      closed = false;
    const call = { file, args, options, child, input: () => input };
    calls.push(call);
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({
      write(chunk, _encoding, done) {
        input += chunk.toString();
        done();
      },
    });
    const finish = (code = 0, stdout = "", stderr = "") => {
      if (closed) return;
      closed = true;
      child.stdout.end(stdout);
      child.stderr.end(stderr);
      child.emit("close", code);
    };
    child.kill = () => {
      queueMicrotask(() => finish(null));
      return true;
    };
    queueMicrotask(() => {
      const custom = respond(call, finish);
      if (custom === false || closed) return;
      const cmd = args[2];
      if (cmd === "info") finish(0, JSON.stringify({ runsc: { path: "/usr/local/bin/runsc" } }));
      else if (cmd === "image")
        finish(
          0,
          JSON.stringify({
            Id: args.at(-1).startsWith("sha256:") ? args.at(-1) : "sha256:" + "d".repeat(64),
            RepoDigests: [image],
          }),
        );
      else if (cmd === "create") finish(0, "b".repeat(64) + "\n");
      else if (cmd === "start") finish(0, JSON.stringify(result));
      else finish();
    });
    return child;
  };
  return { spawn, calls };
}
test("sandbox runs only fixed Docker/runsc argv with all hard boundaries and no host data mounts", async () => {
  const engine = fakeEngine(),
    executor = createWorkSandboxExecutor({ image }, engine.spawn);
  const output = await executor.run({
    ...job,
    code: "# $(touch /host/pwned) `id`\nprint('hello')",
  });
  assert.equal(output.exitCode, 0);
  assert.equal(
    createHash("sha256").update(output.outputs[0].bytes).digest("hex"),
    createHash("sha256").update("sum\n3\n").digest("hex"),
  );
  const create = engine.calls.find((call) => call.args[2] === "create");
  for (const flag of [
    "--runtime=runsc",
    "--pull=never",
    "--read-only",
    "--network=none",
    "--user=65532:65532",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges=true",
    "--memory=268435456",
    "--memory-swap=268435456",
    "--pids-limit=32",
    "--cpus=1",
    "--log-driver=none",
  ])
    assert.ok(create.args.includes(flag), flag);
  assert.ok(create.args.includes("--tmpfs=/job:rw,noexec,nosuid,nodev,size=67108864,mode=1777"));
  assert.ok(
    !create.args.some((flag) =>
      /--(?:mount|volume|privileged|device)|source\.csv|touch|print|hello|Bearer/u.test(flag),
    ),
  );
  assert.deepEqual(create.args.slice(-5), [
    "--entrypoint=/usr/local/bin/python3",
    image,
    "-I",
    "-B",
    "/opt/kova/execute.py",
  ]);
  for (const call of engine.calls) {
    assert.equal(call.file, "/usr/bin/docker");
    assert.equal(call.options.shell, false);
    assert.deepEqual(Object.keys(call.options.env).sort(), ["LANG", "LC_ALL", "PATH"]);
    assert.deepEqual(call.args.slice(0, 2), ["--host", "unix:///var/run/docker.sock"]);
  }
  const start = engine.calls.find((call) => call.args[2] === "start");
  assert.match(JSON.parse(start.input()).code, /touch \/host\/pwned/u);
  assert.equal(
    JSON.parse(start.input()).inputFiles[0].base64,
    Buffer.from(job.inputFiles[0].bytes).toString("base64"),
  );
  const cleanup = engine.calls.at(-1);
  assert.deepEqual(cleanup.args.slice(2, 5), ["rm", "--force", "--volumes"]);
  assert.equal(cleanup.args.at(-1), create.args[create.args.indexOf("--name") + 1]);
});
test("configuration, source size and input path rejection happen before any engine process", async () => {
  const engine = fakeEngine();
  for (const config of [
    { image: "python:latest" },
    { image, enginePath: "/bin/sh" },
    { image, maxConcurrent: 10 },
  ])
    assert.throws(() => createWorkSandboxExecutor(config, engine.spawn));
  const executor = createWorkSandboxExecutor({ image }, engine.spawn);
  for (const invalid of [
    { ...job, inputFiles: [{ name: "../secret", bytes: new Uint8Array() }] },
    {
      ...job,
      inputFiles: [
        { name: "a.csv", bytes: new Uint8Array() },
        { name: "A.csv", bytes: new Uint8Array() },
      ],
    },
    { ...job, code: "a".repeat(SANDBOX_LIMITS.codeBytes + 1) },
    {
      ...job,
      inputFiles: [{ name: "big.csv", bytes: new Uint8Array(SANDBOX_LIMITS.inputBytes + 1) }],
    },
    { ...job, timeoutMs: 60000 },
    { ...job, maxOutputBytes: -1 },
  ])
    await assert.rejects(executor.run(invalid));
  assert.equal(engine.calls.length, 0);
});
test("readiness verifies local runsc and the exact pinned image without running code", async () => {
  const engine = fakeEngine(),
    executor = createWorkSandboxExecutor({ image }, engine.spawn);
  assert.equal((await executor.probe()).ready, true);
  assert.deepEqual(
    engine.calls.map((call) => call.args[2]),
    ["info", "image"],
  );
  for (const reply of [JSON.stringify({}), JSON.stringify({ runsc: { path: "/usr/bin/runc" } })]) {
    const bad = fakeEngine((call, finish) => {
      if (call.args[2] === "info") {
        finish(0, reply);
        return false;
      }
    });
    assert.equal((await createWorkSandboxExecutor({ image }, bad.spawn).probe()).ready, false);
    assert.equal(bad.calls.length, 1);
  }
  const bad = fakeEngine((call, finish) => {
    if (call.args[2] === "image") {
      finish(0, JSON.stringify(["other@sha256:" + "c".repeat(64)]));
      return false;
    }
  });
  assert.equal((await createWorkSandboxExecutor({ image }, bad.spawn).probe()).ready, false);
  const local = fakeEngine();
  assert.equal(
    (await createWorkSandboxExecutor({ image: "sha256:" + "e".repeat(64) }, local.spawn).probe())
      .ready,
    true,
  );
});
test("malformed, cross-job, traversing, duplicate and oversized output protocols are rejected then cleaned", async () => {
  for (const data of [
    "not JSON",
    { ...result, jobId: "other" },
    { ...result, outputs: [{ name: "../evil", base64: "" }] },
    {
      ...result,
      outputs: [
        { name: "a", base64: "AA==" },
        { name: "A", base64: "" },
      ],
    },
    { ...result, outputs: [{ name: "a", base64: "bad!" }] },
    {
      ...result,
      outputs: [{ name: "a", base64: Buffer.alloc(job.maxOutputBytes + 1).toString("base64") }],
    },
    { ...result, stdout: "a".repeat(SANDBOX_LIMITS.logBytes + 1) },
  ]) {
    const engine = fakeEngine((call, finish) => {
      if (call.args[2] === "start") {
        finish(0, typeof data === "string" ? data : JSON.stringify(data));
        return false;
      }
    });
    await assert.rejects(createWorkSandboxExecutor({ image }, engine.spawn).run(job));
    assert.equal(engine.calls.at(-1).args[2], "rm");
  }
});
test("abort kills the attached process and independently removes its exact container", async () => {
  const controller = new AbortController();
  const engine = fakeEngine((call) => {
    if (call.args[2] === "start") {
      controller.abort();
      return false;
    }
  });
  await assert.rejects(
    createWorkSandboxExecutor({ image }, engine.spawn).run(job, { signal: controller.signal }),
    /sandbox_aborted/u,
  );
  assert.equal(engine.calls.at(-1).args[2], "rm");
});

test("container failures expose only finite wrapper diagnostics without guessing from arbitrary stderr", async () => {
  for (const [stderr, expected] of [
    ["sandbox_execution_failed\n", "sandbox_execution_failed"],
    [
      "sandbox_execution_failed_workspace_permission\n",
      "sandbox_execution_failed_workspace_permission",
    ],
    ["sandbox_execution_failed_child_limit", "sandbox_execution_failed_child_limit"],
    ["sandbox_execution_failed_outputs_invalid", "sandbox_execution_failed_outputs_invalid"],
    ["sandbox_execution_failed_secret_customer_record", "sandbox_start_failed"],
    ["exec failed: /private/customer/file", "sandbox_start_failed"],
    ["sandbox_execution_failed_workspace_permission\nBearer PRIVATE", "sandbox_start_failed"],
  ]) {
    const engine = fakeEngine((call, finish) => {
      if (call.args[2] === "start") {
        finish(1, "", stderr);
        return false;
      }
    });
    await assert.rejects(
      createWorkSandboxExecutor({ image }, engine.spawn).run(job),
      (error) => error.code === expected && error.message === expected,
    );
    assert.equal(engine.calls.at(-1).args[2], "rm");
  }
});
test("uncertain creation never sends code and cleanup failure cannot claim execution success", async () => {
  const failed = fakeEngine((call, finish) => {
    if (call.args[2] === "create") {
      finish(1, "", "failed");
      return false;
    }
  });
  await assert.rejects(
    createWorkSandboxExecutor({ image }, failed.spawn).run(job),
    /sandbox_create_failed/u,
  );
  assert.ok(!failed.calls.some((call) => call.args[2] === "start"));
  const cleanup = fakeEngine((call, finish) => {
    if (call.args[2] === "rm") {
      finish(1, "", "daemon unavailable");
      return false;
    }
  });
  await assert.rejects(
    createWorkSandboxExecutor({ image }, cleanup.spawn).run(job),
    /sandbox_cleanup_unconfirmed/u,
  );
});

test("a stalled execution hits its hard deadline and excess concurrent work is never spawned", async () => {
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const engine = fakeEngine((call) => {
    if (call.args[2] === "start") {
      started();
      return false;
    }
  });
  const executor = createWorkSandboxExecutor({ image }, engine.spawn);
  const first = executor.run({ ...job, timeoutMs: 1000 });
  await ready;
  const count = engine.calls.length;
  await assert.rejects(executor.run(job), /sandbox_capacity/u);
  assert.equal(engine.calls.length, count);
  await assert.rejects(first, /sandbox_timeout/u);
  assert.equal(engine.calls.at(-1).args[2], "rm");
});

test("stdout floods are killed without retaining unbounded bytes", async () => {
  const engine = fakeEngine((call) => {
    if (call.args[2] === "start") {
      call.child.stdout.write(Buffer.alloc(13 * 1024 * 1024));
      return false;
    }
  });
  await assert.rejects(
    createWorkSandboxExecutor({ image }, engine.spawn).run(job),
    /sandbox_stream_limit/u,
  );
  assert.equal(engine.calls.at(-1).args[2], "rm");
});
test("bounded restart cleanup selects only expired labeled containers", async () => {
  const engine = fakeEngine((call, finish) => {
    if (call.args[2] === "ps") {
      finish(
        0,
        "a".repeat(12) +
          " 1000000000000\n" +
          "b".repeat(12) +
          " 9999999999999\nnot-an-id 1000000000000\n",
      );
      return false;
    }
  });
  assert.deepEqual(await createWorkSandboxExecutor({ image }, engine.spawn).reapExpired(), {
    removed: 1,
  });
  assert.ok(engine.calls[0].args.includes("label=com.kova.sandbox=python-v1"));
  assert.equal(engine.calls.at(-1).args.at(-1), "a".repeat(12));
});

test("unconfirmed cleanup quarantines admission until exact-container recovery succeeds", async () => {
  let broken = true;
  const engine = fakeEngine((call, finish) => {
    if (call.args[2] === "rm" && broken) {
      finish(1, "", "engine unavailable");
      return false;
    }
  });
  const executor = createWorkSandboxExecutor({ image }, engine.spawn);
  await assert.rejects(executor.run(job), /sandbox_cleanup_unconfirmed/u);
  const count = engine.calls.length;
  assert.equal((await executor.probe()).ready, false);
  await assert.rejects(executor.run(job), /sandbox_cleanup_unconfirmed/u);
  assert.equal(engine.calls.length, count);
  broken = false;
  assert.equal((await executor.reapExpired()).removed, 1);
  assert.equal((await executor.probe()).ready, true);
  assert.equal((await executor.run(job)).exitCode, 0);
});
test("the image entrypoint executes Python only in its container and bounds regular-file collection", async () => {
  const [python, dockerfile] = await Promise.all([
    readFile("work-runner/sandbox-image/execute.py", "utf8"),
    readFile("work-runner/sandbox-image/Dockerfile", "utf8"),
  ]);
  assert.match(python, /os\.getuid\(\) == 65532/u);
  assert.match(python, /O_NOFOLLOW \| os\.O_NONBLOCK/u);
  assert.match(python, /stat\.S_ISREG\(info\.st_mode\) and info\.st_nlink == 1/u);
  assert.match(python, /os\.killpg\(child\.pid, signal\.SIGKILL\)/u);
  assert.match(python, /KOVA_INPUT_DIR/u);
  assert.match(python, /KOVA_OUTPUT_DIR/u);
  assert.match(python, /sys\.stderr\.write\(failure_code\(STAGE, error\) \+ "\\n"\)/u);
  assert.doesNotMatch(python, /str\(error\)|repr\(error\)|traceback\.print/u);
  assert.match(dockerfile, /USER 65532:65532/u);
  assert.doesNotMatch(dockerfile, /RUN .*pip|curl|wget/u);
});

test("the pure Python failure formatter reports bounded stages and errno classes without running the entrypoint", async () => {
  // Parse the source and extract only its pure formatter. The container main,
  // resource setup, submitted code and file execution are never run on this host.
  const script = `
import ast, errno, subprocess, sys
tree = ast.parse(sys.stdin.read())
formatter = next(item for item in tree.body if isinstance(item, ast.FunctionDef) and item.name == "failure_code")
scope = {"errno": errno, "subprocess": subprocess}
exec(compile(ast.Module(body=[formatter], type_ignores=[]), "pure-failure-formatter", "exec"), scope)
code = scope["failure_code"]
for stage in ("preflight", "workspace", "child", "outputs", "response"):
    for error, category in ((ValueError("PRIVATE"), "invalid"), (PermissionError(errno.EACCES, "PRIVATE"), "permission"), (OSError(errno.ENOSPC, "PRIVATE"), "storage"), (OSError(errno.EMFILE, "PRIVATE"), "limit"), (subprocess.TimeoutExpired("PRIVATE", 1), "timeout"), (RuntimeError("PRIVATE"), "internal")):
        assert code(stage, error) == "sandbox_execution_failed_" + stage + "_" + category
assert code("PRIVATE", ValueError("PRIVATE")) == "sandbox_execution_failed_preflight_invalid"
`;
  execFileSync("python3", ["-I", "-B", "-c", script], {
    input: await readFile("work-runner/sandbox-image/execute.py", "utf8"),
    timeout: 5000,
    maxBuffer: 8192,
  });
});
