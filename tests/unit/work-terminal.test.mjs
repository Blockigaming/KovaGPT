import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { compileTerminalPlan } from "../../work-runner/terminal.mjs";
import { configuredProvider } from "../../work-runner/provider.mjs";

const execute = promisify(execFile);
test("fixed terminal pipeline executes actual literal sort/count/hash commands", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kova-terminal-test-"));
  try {
    const incoming = path.join(root, "input"),
      outgoing = path.join(root, "output");
    await mkdir(incoming);
    await mkdir(outgoing);
    await writeFile(path.join(incoming, "values.txt"), "3\n1\n3\n2\n");
    const code = compileTerminalPlan(
      [
        {
          command: "sort",
          options: { numeric: true, unique: true },
          inputFile: "values.txt",
          outputFile: "sorted.txt",
        },
        {
          command: "head",
          options: { lines: 2 },
          inputFile: "sorted.txt",
          outputFile: "first.txt",
        },
        {
          command: "wc",
          options: { metric: "lines" },
          inputFile: "first.txt",
          outputFile: "count.txt",
        },
        { command: "sha256sum", inputFile: "first.txt", outputFile: "digest.txt" },
      ],
      ["values.txt"],
    );
    // This is the trusted fixed-command compiler smoke, not an isolation claim.
    // Arbitrary model Python is never evaluated by this test. Hosted acceptance
    // runs this same compiled program through the actual required runsc image.
    await execute("python3", ["-I", "-c", code], {
      timeout: 5000,
      maxBuffer: 65536,
      env: { PATH: "/usr/bin:/bin", KOVA_INPUT_DIR: incoming, KOVA_OUTPUT_DIR: outgoing },
    });
    assert.equal(await readFile(path.join(outgoing, "sorted.txt"), "utf8"), "1\n2\n3\n");
    assert.equal(await readFile(path.join(outgoing, "first.txt"), "utf8"), "1\n2\n");
    assert.equal((await readFile(path.join(outgoing, "count.txt"), "utf8")).trim(), "2");
    assert.match(await readFile(path.join(outgoing, "digest.txt"), "utf8"), /^[a-f0-9]{64}  -\n$/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("terminal refuses host commands, arbitrary arguments, traversal and overwrites", () => {
  const base = { command: "wc", inputFile: "input.txt", outputFile: "result.txt" };
  for (const bad of [
    { ...base, command: "bash" },
    { ...base, command: "/usr/bin/wc" },
    { ...base, argv: [";", "curl"] },
    { ...base, inputFile: "/etc/passwd" },
    { ...base, outputFile: "../result.txt" },
    { ...base, outputFile: "INPUT.txt" },
    { ...base, options: { metric: "$(touch pwned)" } },
    { ...base, command: "head", options: { lines: -1 } },
    { ...base, command: "cut", options: { delimiter: "\n", fields: [1] } },
    { ...base, command: "sort", options: { numeric: "--output=/tmp/file" } },
  ])
    assert.throws(() => compileTerminalPlan([bad], ["input.txt"]), /plan_invalid/u);
  assert.throws(() => compileTerminalPlan([base, base], ["input.txt"]), /plan_invalid/u);
  assert.throws(() => compileTerminalPlan(Array(9).fill(base), ["input.txt"]), /plan_invalid/u);
});
test("provider terminal output uses the configured sandbox and retains metered evidence", async () => {
  let calls = 0;
  const provider = configuredProvider(
    {
      responsesUrl: "https://provider.example/responses",
      providerKey: "x".repeat(32),
      models: ["model"],
      sandbox: {
        run: async (job) => {
          calls++;
          assert.match(job.code, /shell=False/u);
          assert.equal(job.inputFiles[0].name, "input.txt");
          return {
            exitCode: 0,
            stdout: "wc completed",
            stderr: "",
            outputs: [{ name: "result.txt", bytes: Buffer.from("2\n") }],
          };
        },
      },
    },
    async () =>
      Response.json({
        usage: { input_tokens: 10, output_tokens: 20 },
        output_text: JSON.stringify({
          kind: "terminal",
          inputFiles: [{ name: "input.txt", text: "a\nb\n" }],
          commands: [{ command: "wc", inputFile: "input.txt", outputFile: "result.txt" }],
        }),
      }),
  );
  const result = await provider.reason(
    { model: "model", stepId: "step", maxOutputTokens: 100, reservationId: "reservation" },
    { signal: new AbortController().signal },
  );
  assert.equal(calls, 1);
  assert.equal(result.status, "completed");
  assert.equal(result.receipt.inputTokens, 10);
  assert.equal(result.receipt.outputTokens, 20);
  assert.equal(result.artifacts.length, 2);
  assert.equal(Buffer.from(result.artifacts[1].contentBase64, "base64").toString(), "2\n");
});
