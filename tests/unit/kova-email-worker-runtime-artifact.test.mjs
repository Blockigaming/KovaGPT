import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("declared production image files contain the runnable default-off email operator closure", () => {
  const source = fileURLToPath(new URL("../../", import.meta.url));
  const docker = readFileSync(join(source, "Dockerfile"), "utf8");
  const runtimeStage = docker.slice(docker.indexOf("FROM node:24-bookworm-slim AS runtime"));
  assert.ok(runtimeStage.startsWith("FROM node:24-bookworm-slim AS runtime"));
  const runtime = mkdtempSync(join(tmpdir(), "kova-email-runtime-artifact-"));
  try {
    // Materialize the declared regular-file COPY closure, not an invented copy
    // of the operator. The compiled app directory is irrelevant to this entry.
    for (const match of runtimeStage.matchAll(
      /^COPY --from=build(?: --chown=[^ ]+)? \/app\/([^ ]+) ([^\r\n]+)$/gmu,
    )) {
      const input = resolve(source, match[1]);
      if (!existsSync(input) || !statSync(input).isFile()) continue;
      const output = resolve(runtime, match[2]);
      assert.ok(output.startsWith(`${runtime}/`));
      mkdirSync(dirname(output), { recursive: true });
      cpSync(input, output);
    }
    const result = spawnSync(
      process.execPath,
      [join(runtime, "scripts/auth-email/production-worker.mjs"), "--execute"],
      {
        cwd: runtime,
        env: { KOVA_EMAIL_WORKER_OPERATOR_ENABLED: "false" },
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 8192,
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, "Declared image files must run the email operator");
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      execution_enabled: false,
      reason: "operator_disabled",
    });
  } finally {
    rmSync(runtime, { recursive: true, force: true });
  }
});
