import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Offline runtime portability check, not a production-image build or attestation.
// Require an already-cached image ID; never pull, tag, push or touch another app.
const image = process.env.KOVA_LOCAL_NODE_IMAGE;
assert.match(image ?? "", /^sha256:[a-f0-9]{64}$/u, "A cached local image ID is required");
const dist = realpathSync(fileURLToPath(new URL("../../dist", import.meta.url)));
assert.ok(existsSync(`${dist}/server/index.mjs`), "Run build:azure first");
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
  timeout: 5000,
}).trim();
assert.match(sourceSha, /^[a-f0-9]{40}$/u);
const name = `kova-azure-node-check-${randomUUID().slice(0, 8)}`;
let id;

function docker(args, input, timeout = 15000) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    input,
    timeout,
    maxBuffer: 1024 * 1024,
  });
  // Never emit image configuration, environment values or unfiltered child logs.
  if (result.status !== 0) {
    let probe;
    try {
      probe = JSON.parse(result.stdout);
    } catch {}
    console.error(
      JSON.stringify({
        operation: args[0],
        status: result.status,
        timedOut: result.error?.code === "ETIMEDOUT",
        probeStage: typeof probe?.stage === "string" ? probe.stage : null,
        probeCode: typeof probe?.code === "string" ? probe.code : null,
      }),
    );
    throw new Error(`local_docker_${args[0]}_failed`);
  }
  return result.stdout.trim();
}

const context = docker(["context", "show"]);
assert.equal(context, "colima", "This local-only check requires the existing Colima context");
const endpoint = docker(["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"]);
assert.ok(endpoint.startsWith("unix:///"), "Remote Docker endpoints are prohibited");
const [cached] = JSON.parse(docker(["image", "inspect", image]));
assert.equal(cached.Id, image);
assert.equal(cached.Os, "linux");

try {
  id = docker([
    "create",
    "--name",
    name,
    "--label",
    "com.kovagpt.purpose=local-node-runtime-check",
    "--network",
    "none",
    "--memory",
    "512m",
    "--cpus",
    "0.5",
    "--read-only",
    "--user",
    "10001:10001",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--no-healthcheck",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    "--mount",
    `type=bind,source=${dist},target=/kova-dist,readonly`,
    "--entrypoint",
    "/usr/bin/env",
    image,
    "-i",
    "PATH=/usr/local/bin:/usr/bin:/bin",
    "NODE_ENV=production",
    "AZURE_ENVIRONMENT=ci",
    "HOST=127.0.0.1",
    "PORT=3000",
    "KOVA_PUBLIC_URL=http://127.0.0.1:3000",
    "AI_GENERATION_ENABLED=false",
    "KOVA_GENERATION_DISABLED=true",
    "node",
    "--input-type=module",
    "-e",
    'setTimeout(() => process.exit(124), 120000); await import("/kova-dist/server/index.mjs");',
  ]);
  assert.match(id, /^[a-f0-9]{64}$/u);
  const [container] = JSON.parse(docker(["inspect", id]));
  assert.equal(container.Config.Image, image);
  assert.equal(container.HostConfig.NetworkMode, "none");
  assert.equal(container.HostConfig.ReadonlyRootfs, true);
  assert.equal(container.HostConfig.Memory, 512 * 1024 * 1024);
  assert.equal(container.Config.User, "10001:10001");
  assert.deepEqual(Object.keys(container.HostConfig.PortBindings ?? {}), []);
  assert.equal(container.Mounts.filter((mount) => mount.Type === "bind").length, 1);
  const mount = container.Mounts.find((value) => value.Type === "bind");
  assert.equal(mount.Source, dist);
  assert.equal(mount.Destination, "/kova-dist");
  assert.equal(mount.RW, false);
  docker(["start", id]);
  const result = JSON.parse(
    docker(
      ["exec", "-i", id, "node", "--input-type=module"],
      `
    import assert from 'node:assert/strict';
    import { setTimeout as delay } from 'node:timers/promises';
    let stage = 'node_version';
    try {
    assert.match(process.version, /^v24\\./u);
    const origin = 'http://127.0.0.1:3000';
    const get = async (path) => {
      let url = new URL(path, origin);
      for (let redirects = 0; redirects <= 3; redirects++) {
        assert.equal(url.origin, origin, 'local_linux_external_redirect');
        const response = await fetch(url, {signal: AbortSignal.timeout(3000), redirect: 'manual'});
        if (![301, 302, 303, 307, 308].includes(response.status)) return response;
        assert.ok(response.headers.get('location'), 'local_linux_redirect_missing_location');
        url = new URL(response.headers.get('location'), url);
      }
      throw new Error('local_linux_redirect_limit');
    };
    stage = 'health';
    let healthy = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { healthy = (await get('/api/health')).status === 200; } catch {}
      if (healthy) break;
      await delay(500);
    }
    assert.ok(healthy, 'local_linux_health_failed');
    stage = 'version';
    const version = await get('/api/version');
    const identity = await version.json();
    assert.match(identity.sha, /^[a-f0-9]{40}$/u);
    assert.equal(identity.sha, ${JSON.stringify(sourceSha)}, 'local_linux_stale_build');
    assert.equal(version.headers.get('x-kova-build'), identity.sha);
    stage = 'readiness';
    const readiness = await get('/api/readyz');
    assert.equal(readiness.status, 503);
    assert.deepEqual((await readiness.json()).capabilities, {});
    stage = 'home';
    const home = await get('/');
    assert.equal(home.status, 200);
    const html = await home.text();
    stage = 'assets';
    const assets = [...new Set([...html.matchAll(/(?:src|href)="(\\/assets\\/[^"?#]+\\.(?:js|css))"/gu)].map(match => match[1]))];
    assert.ok(assets.length > 0, 'local_linux_assets_missing');
    for (const asset of assets) assert.equal((await get(asset)).status, 200);
    stage = 'guest_routes';
    for (const route of ['/projects', '/library', '/auth?email=azure-test%40example.invalid&mode=sign-in'])
      assert.equal((await get(route)).status, 200);
    // Allow router path canonicalization before the Auth-owned sign-in redirect.
    // get() validates every hop rather than assuming one specific first-hop status.
    stage = 'auth_entry_redirect';
    const authEntry = await get('/auth');
    assert.equal(authEntry.status, 200);
    const destination = new URL(authEntry.url);
    assert.equal(destination.origin, origin);
    stage = 'auth_entry_path';
    assert.equal(destination.pathname, '/');
    stage = 'auth_entry_search';
    assert.equal(destination.searchParams.get('sign-in'), '1');
    console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
      buildSha: identity.sha, health: 'PASS', readinessFailsClosed: 'PASS', routes: 'PASS', assets: assets.length }));
    } catch (error) { console.log(JSON.stringify({stage, code: error.code ?? error.name})); process.exitCode = 1; }
  `,
      45000,
    ),
  );
  console.log(
    JSON.stringify({
      kind: "LOCAL_LINUX_NODE_RUNTIME_ONLY",
      containerId: id,
      image,
      context,
      network: "none",
      publishedPorts: 0,
      applicationEnvironmentInheritsCredentials: false,
      productionImageBuilt: false,
      ...result,
    }),
  );
} catch (error) {
  if (id && /^[a-f0-9]{64}$/u.test(id)) {
    const [observed] = JSON.parse(docker(["inspect", id]));
    console.error(
      JSON.stringify({
        containerId: id,
        state: observed.State.Status,
        exitCode: observed.State.ExitCode,
        oomKilled: observed.State.OOMKilled,
      }),
    );
  }
  throw error;
} finally {
  if (id && /^[a-f0-9]{64}$/u.test(id)) {
    docker(["rm", "--force", id]);
    const remaining = docker(["ps", "--all", "--quiet", "--no-trunc", "--filter", `id=${id}`]);
    assert.equal(remaining, "", "Temporary verification container was not removed");
    console.log(JSON.stringify({ containerId: id, cleanup: "PASS" }));
  }
}
