import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const dockerfile = readFileSync(new URL("Dockerfile", root), "utf8");
const workflow = readFileSync(
  new URL(".github/workflows/build-auth-rehearsal-image.yml", root),
  "utf8",
);

function runAuthModeGuard(serverMode, browserMode) {
  const instruction = dockerfile.match(
    /^RUN case "\$KOVA_RUNTIME_AUTH_MODE" in[\s\S]*?(?=\n\nRUN )/mu,
  );
  assert.ok(instruction, "Dockerfile must include a runtime auth-mode build guard");
  const command = instruction[0].slice(4).replace(/\\\r?\n\s*/gu, " ");
  return spawnSync("sh", ["-c", command], {
    encoding: "utf8",
    env: {
      ...process.env,
      KOVA_RUNTIME_AUTH_MODE: serverMode,
      VITE_KOVA_AUTH_MODE: browserMode,
    },
  });
}

test("rehearsal image binds browser and server to the same explicit dual/kova mode", () => {
  assert.match(dockerfile, /^ARG KOVA_RUNTIME_AUTH_MODE=supabase$/mu);
  assert.match(dockerfile, /^\s+KOVA_AUTH_MODE=\$\{KOVA_RUNTIME_AUTH_MODE\} \\/mu);
  assert.match(dockerfile, /^\s+KOVA_COMPILED_AUTH_MODE=\$\{VITE_KOVA_AUTH_MODE\}$/mu);
  assert.match(workflow, /options: \[dual, kova\]/u);
  assert.match(workflow, /--build-arg VITE_KOVA_AUTH_MODE="\$AUTH_MODE" \\/u);
  assert.match(workflow, /--build-arg KOVA_RUNTIME_AUTH_MODE="\$AUTH_MODE" \\/u);
});

test("image build guard accepts matching auth modes and rejects mismatches", () => {
  for (const mode of ["supabase", "dual", "kova"]) {
    const result = runAuthModeGuard(mode, mode);
    assert.equal(result.status, 0, `${mode}: ${result.stderr}`);
  }

  for (const [serverMode, browserMode] of [
    ["supabase", "dual"],
    ["dual", "supabase"],
    ["kova", "dual"],
  ]) {
    const result = runAuthModeGuard(serverMode, browserMode);
    assert.equal(result.status, 1, `${serverMode}/${browserMode}`);
    assert.match(result.stderr, /Browser and server authentication modes must match/u);
  }

  const invalid = runAuthModeGuard("other", "other");
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /must be a supported auth mode/u);
});

test("container startup refuses a runtime override that disagrees with the browser", () => {
  const instruction = dockerfile.match(/^CMD (\[.*\])$/mu);
  assert.ok(instruction, "Dockerfile must guard runtime auth mode before starting the server");
  const [executable, ...args] = JSON.parse(instruction[1]);
  const binDir = mkdtempSync(join(tmpdir(), "kova-auth-mode-"));
  try {
    const fakeNode = join(binDir, "node");
    writeFileSync(fakeNode, "#!/bin/sh\nprintf 'server started\\n'\n");
    chmodSync(fakeNode, 0o755);
    const run = (serverMode, browserMode) =>
      spawnSync(executable, args, {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: binDir + ":" + (process.env.PATH ?? ""),
          KOVA_AUTH_MODE: serverMode,
          KOVA_COMPILED_AUTH_MODE: browserMode,
        },
      });

    const matching = run("dual", "dual");
    assert.equal(matching.status, 0, matching.stderr);
    assert.match(matching.stdout, /server started/u);
    const mismatch = run("supabase", "dual");
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stderr, /Browser and server authentication modes must match/u);
    assert.doesNotMatch(mismatch.stdout, /server started/u);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});
