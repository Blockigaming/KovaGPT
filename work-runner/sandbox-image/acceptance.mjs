import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWorkSandboxExecutor } from "../sandbox-container.mjs";
import { compileTerminalPlan } from "../terminal.mjs";

// This gate executes only inside the required container. It never evaluates
// supplied Python on the host and never silently chooses a different runtime.
if (process.argv.length !== 3 || process.argv[2] !== "--execute") {
  process.stdout.write(
    "Run on the approved isolated runner host with --execute and KOVA_WORK_SANDBOX_IMAGE pinned by digest.\n",
  );
  process.exitCode = 2;
} else {
  // These are fixed repository fixtures in an ephemeral CI container. Keep
  // bounded engine diagnostics here; production continues returning safe codes.
  const fixtureSpawn = (...args) => {
    const child = spawn(...args);
    let diagnostic = Buffer.alloc(0);
    child.stderr?.on("data", (part) => {
      if (diagnostic.length < 8192)
        diagnostic = Buffer.concat([
          diagnostic,
          Buffer.from(part).subarray(0, 8192 - diagnostic.length),
        ]);
    });
    child.once("close", (code) => {
      if (code !== 0 && diagnostic.length)
        process.stderr.write(`FIXTURE_CONTAINER_DIAGNOSTIC ${diagnostic.toString("utf8")}\n`);
    });
    return child;
  };
  const executor = createWorkSandboxExecutor(
    { image: process.env.KOVA_WORK_SANDBOX_IMAGE },
    fixtureSpawn,
  );
  const readiness = await executor.probe();
  assert.equal(
    readiness.ready,
    true,
    "Approved runsc runtime and pinned image must be locally installed",
  );
  await executor.reapExpired();
  const run = (jobId, code, extra = {}) =>
    executor.run({
      jobId,
      code,
      inputFiles: [],
      timeoutMs: 10000,
      maxOutputBytes: 10000,
      ...extra,
    });
  const result = await run(
    "isolation_csv",
    `import csv, io, json, os, socket
assert os.getuid() == 65532
assert not os.path.exists('/var/run/docker.sock')
assert not any('TOKEN' in key or 'SECRET' in key or 'PASSWORD' in key for key in os.environ)
try:
    open('/etc/kova-write-test', 'w').write('forbidden')
    raise AssertionError('root filesystem is writable')
except OSError:
    pass
try:
    socket.create_connection(('1.1.1.1', 53), timeout=0.5)
    raise AssertionError('external network reachable')
except OSError:
    pass
with open(os.path.join(os.environ['KOVA_INPUT_DIR'], 'values.csv')) as source:
    total = sum(int(row['value']) for row in csv.DictReader(source))
with open(os.path.join(os.environ['KOVA_OUTPUT_DIR'], 'total.csv'), 'w') as output:
    output.write('total\\n' + str(total) + '\\n')
print('isolation checks passed')
`,
    { inputFiles: [{ name: "values.csv", bytes: Buffer.from("value\n1\n2\n") }] },
  );
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /isolation checks passed/u);
  assert.equal(result.outputs.length, 1);
  assert.equal(result.outputs[0].name, "total.csv");
  const terminal = await run(
    "fixed_terminal",
    compileTerminalPlan(
      [
        {
          command: "sort",
          options: { numeric: true, unique: true },
          inputFile: "values.txt",
          outputFile: "sorted.txt",
        },
        {
          command: "wc",
          options: { metric: "lines" },
          inputFile: "sorted.txt",
          outputFile: "count.txt",
        },
      ],
      ["values.txt"],
    ),
    { inputFiles: [{ name: "values.txt", bytes: Buffer.from("3\n1\n3\n2\n") }] },
  );
  assert.equal(terminal.exitCode, 0);
  assert.equal(
    Buffer.from(terminal.outputs.find((file) => file.name === "sorted.txt").bytes).toString(),
    "1\n2\n3\n",
  );
  assert.equal(
    Buffer.from(terminal.outputs.find((file) => file.name === "count.txt").bytes)
      .toString()
      .trim(),
    "3",
  );
  assert.equal(
    createHash("sha256").update(result.outputs[0].bytes).digest("hex"),
    createHash("sha256").update("total\n3\n").digest("hex"),
  );
  for (const [name, statement] of [
    ["symlink", "os.symlink('/etc/passwd', target)"],
    ["fifo", "os.mkfifo(target)"],
    ["directory", "os.mkdir(target)"],
  ]) {
    await assert.rejects(
      run(
        "reject_" + name,
        `import os\ntarget=os.path.join(os.environ['KOVA_OUTPUT_DIR'],'bad.txt')\n${statement}\n`,
      ),
    );
  }
  let deadlineRejected = false;
  try {
    const timed = await run("deadline", "while True: pass", { timeoutMs: 2000 });
    deadlineRejected = timed.exitCode !== 0;
  } catch {
    deadlineRejected = true;
  }
  assert.equal(deadlineRejected, true);
  await executor.reapExpired();
  process.stdout.write(
    "WORK_SANDBOX_ISOLATION_ACCEPTANCE=PASS (CSV bytes, fixed terminal, non-root, rootfs, network, output types, deadline, cleanup)\n",
  );
}
