import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { test } from "node:test";

const { load } = createRequire(import.meta.url)("js-yaml");
const workflow = load(
  readFileSync(
    new URL("../../.github/workflows/capture-managed-auth-production.yml", import.meta.url),
    "utf8",
  ),
);
const script = workflow.jobs["capture-only"].steps.find((step) =>
  step.name?.startsWith("Select PostgreSQL 17"),
).run;

function fixture(
  t,
  { installed = "17.6", install = "17.7", candidate = "17.7-1.pgdg24.04+1" } = {},
) {
  const root = mkdtempSync(path.join(tmpdir(), "kova-client-tools-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  const pg17 = path.join(root, "pg17");
  mkdirSync(bin);
  mkdirSync(pg17);
  const executable = (name, body, dir = bin) =>
    writeFileSync(path.join(dir, name), `#!/bin/bash\n${body}\n`, { mode: 0o700 });
  for (const program of ["psql", "pg_dump", "pg_restore"]) {
    executable(program, `printf '%s\\n' '${program} (PostgreSQL) 16.15'`);
    if (installed)
      executable(program, `printf '%s\\n' '${program} (PostgreSQL) ${installed}'`, pg17);
  }
  for (const name of ["gpg", "timeout"]) executable(name, "exit 0");
  executable("apt-cache", `printf '%s\\n' '  Candidate: ${candidate}'`);
  const installHelper = path.join(root, "install.py");
  writeFileSync(
    installHelper,
    [
      "import os,pathlib,sys",
      "root=pathlib.Path(os.environ['KOVA_TEST_ROOT'])",
      "with (root/'calls').open('a') as f:f.write(' '.join(sys.argv[1:])+'\\n')",
      "if sys.argv[1:3]==['apt-get','install']:",
      " for name in ['psql','pg_dump','pg_restore']:",
      "  p=root/'pg17'/name;p.write_text('#!/usr/bin/python3\\nprint('+repr(name+' (PostgreSQL) '+os.environ['KOVA_TEST_INSTALL_VERSION'])+')\\n');p.chmod(0o700)",
    ].join("\n") + "\n",
  );
  executable("sudo", `/usr/bin/python3 '${installHelper}' "$@"`);
  const run = (overrideScript = script) =>
    spawnSync("/bin/bash", ["-c", overrideScript.replaceAll("/usr/lib/postgresql/17/bin", pg17)], {
      encoding: "utf8",
      env: {
        PATH: bin,
        HOME: root,
        GITHUB_PATH: path.join(root, "github-path"),
        KOVA_TEST_ROOT: root,
        KOVA_TEST_INSTALL_VERSION: install,
      },
    });
  return { root, pg17, run, executable };
}

test("existing exact PG17 tools run with no rg, installation or default PG16 leakage", (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim().split("\n").length, 3);
  assert.doesNotMatch(result.stdout, /16\.15/);
  assert.equal(readFileSync(path.join(f.root, "github-path"), "utf8").trim(), f.pg17);
  assert.throws(() => readFileSync(path.join(f.root, "calls")));
});

test("missing PG17 uses an exact signed-repository candidate and persists the native binary path", (t) => {
  const f = fixture(t, { installed: null });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const calls = readFileSync(path.join(f.root, "calls"), "utf8");
  assert.match(calls, /apt-get update/);
  assert.match(
    calls,
    /apt-get install --yes --no-install-recommends postgresql-client-17=17\.7-1\.pgdg24\.04\+1/,
  );
  assert.match(result.stdout, /psql \(PostgreSQL\) 17\.7/);
  assert.equal(readFileSync(path.join(f.root, "github-path"), "utf8").trim(), f.pg17);
});

test("wrong-major or incomplete installed binaries remain rejected after setup", (t) => {
  for (const major of ["16.15", "18.1"]) {
    const f = fixture(t, { installed: null, install: major });
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.throws(() => readFileSync(path.join(f.root, "github-path")));
  }
});

test("a non17 package candidate is never installed", (t) => {
  const f = fixture(t, { installed: null, candidate: "18.1-1" });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(readFileSync(path.join(f.root, "calls"), "utf8"), /apt-get install/);
});

test("a different repository key fingerprint stops before adding trust or installing packages", (t) => {
  const f = fixture(t, { installed: null, candidate: "(none)" });
  const osRelease = path.join(f.root, "os-release");
  writeFileSync(osRelease, "ID=ubuntu\nVERSION_ID=24.04\nVERSION_CODENAME=noble\n");
  f.executable("dpkg", "printf '%s\\n' amd64");
  f.executable("mktemp", `/usr/bin/mktemp --tmpdir='${f.root}' "$@"`);
  f.executable("python3", '/usr/bin/python3 "$@"');
  f.executable(
    "curl",
    "while (($#)); do if [[ $1 == -o ]]; then shift; printf '%s\\n' SYNTHETIC_PUBLIC_KEY > \"$1\"; exit 0; fi; shift; done; exit 1",
  );
  f.executable("gpg", "printf '%s\\n' fpr:::::::::0000000000000000000000000000000000000000:");
  const result = f.run(script.replace(". /etc/os-release", `. '${osRelease}'`));
  assert.notEqual(result.status, 0);
  const calls = readFileSync(path.join(f.root, "calls"), "utf8");
  assert.doesNotMatch(calls, /install|kova-pgdg/);
});

test("official fallback pins Ubuntu24 amd64, full PGDG fingerprint and scoped HTTPS signatures", () => {
  for (const literal of [
    "https://www.postgresql.org/media/keys/ACCC4CF8.asc",
    "B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8",
    "URIs: https://apt.postgresql.org/pub/repos/apt",
    "Suites: noble-pgdg",
    "Architectures: amd64",
    "Signed-By: /usr/share/postgresql-common/pgdg/kova-pgdg.asc",
    "--proto '=https'",
    "--tlsv1.2",
  ])
    assert.ok(script.includes(literal), literal);
  assert.doesNotMatch(script, /allow-unauthenticated|trusted=yes|curl[^\n]*\|[^\n]*sh|\brg\b/);
  const capture = workflow.jobs["capture-only"].steps.find((step) =>
    step.name?.startsWith("Capture one consistent"),
  );
  assert.ok(capture.env.KOVA_PRODUCTION_DATABASE_URL);
  assert.doesNotMatch(script, /DATABASE_URL|BACKUP_PASSPHRASE/);
  const uploads = workflow.jobs["capture-only"].steps.filter((step) =>
    step.uses?.startsWith("actions/upload-artifact@"),
  );
  assert.equal(uploads.length, 1);
  assert.doesNotMatch(uploads[0].with.path, /\.sql|full\.dump|catalog\.json|rows\.json/);
});

test("capture and both source metadata workflows select the qualified public Supabase CA", () => {
  for (const [filename, job] of [
    ["capture-managed-auth-production.yml", "capture-only"],
    ["probe-empty-recovery-target.yml", "probe-empty"],
    ["restore-reviewed-empty-recovery.yml", "restore-private-recipient"],
  ]) {
    const current = load(
      readFileSync(new URL(`../../.github/workflows/${filename}`, import.meta.url), "utf8"),
    );
    const sources = current.jobs[job].steps.filter(
      (step) => step.env?.KOVA_PRODUCTION_DATABASE_URL,
    );
    assert.equal(sources.length, 1, filename);
    assert.equal(
      sources[0].env.KOVA_RECOVERY_CA_BUNDLE,
      "${{ github.workspace }}/scripts/release/supabase-prod-ca-2021.crt",
    );
    assert.equal(current.permissions.contents, "read");
    assert.match(current.jobs[job].if, /refs\/heads\/main/);
    assert.match(current.jobs[job].if, /inputs\.source_sha == github\.sha/);
  }
});

test("plaintext capture starts only after verified no-swap memory and retention follows required cleanup", () => {
  const steps = workflow.jobs["capture-only"].steps;
  const prepare = steps.findIndex((step) =>
    step.run?.includes("private-capture-memory.py prepare"),
  );
  const capture = steps.findIndex((step) => step.env?.KOVA_PRODUCTION_DATABASE_URL);
  const cleanup = steps.findIndex((step) =>
    step.run?.includes("private-capture-memory.py cleanup"),
  );
  const upload = steps.findIndex((step) => step.uses?.startsWith("actions/upload-artifact@"));
  assert.ok(prepare >= 0 && prepare < capture && capture < cleanup && cleanup < upload);
  assert.doesNotMatch(JSON.stringify(steps[prepare]), /DATABASE_URL|BACKUP_PASSPHRASE/);
  assert.ok(
    steps[capture].run.indexOf("private-capture-memory.py verify") <
      steps[capture].run.indexOf("managed-auth-recovery.py capture"),
  );
  assert.equal(steps[cleanup].if, "always()");
  assert.equal(steps[cleanup]["continue-on-error"], undefined);
  assert.equal(steps[upload].if, undefined);
  assert.equal(steps[upload].with["retention-days"], 7);
});

test("the selected public CA is the already-qualified provider root with a valid self signature and lifetime", () => {
  const pem = readFileSync(
    new URL("../../scripts/release/supabase-prod-ca-2021.crt", import.meta.url),
  );
  assert.equal(
    createHash("sha256").update(pem).digest("hex"),
    "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7",
  );
  const certificate = new X509Certificate(pem);
  assert.equal(certificate.ca, true);
  assert.equal(certificate.verify(certificate.publicKey), true);
  assert.ok(Date.parse(certificate.validFrom) <= Date.now());
  assert.ok(Date.parse(certificate.validTo) > Date.now());
});
