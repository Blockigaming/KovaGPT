import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const guard = fileURLToPath(new URL("../fixtures/azure-local-network-guard.mjs", import.meta.url));

test("local browser preview blocks external fetch/TCP and other local ports before connecting", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      guard,
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import net from 'node:net';
    for (const url of ['https://example.invalid/', 'http://127.0.0.1:4190/', 'http://127.0.0.2:4189/'])
      assert.throws(() => fetch(url), /azure_local_test_outbound_denied/);
    assert.throws(() => fetch(new Request('https://example.invalid/')), /azure_local_test_outbound_denied/);
    for (const args of [[443, 'example.invalid'], [4190, '127.0.0.1'], [{path: '/tmp/not-a-test-socket'}]])
      assert.throws(() => net.connect(...args), /azure_local_test_outbound_denied/);
  `,
    ],
    { env: { PORT: "4189" }, encoding: "utf8", timeout: 5000 },
  );
  assert.equal(result.status, 0, "The preview network guard did not fail closed");
});

test("local preview rejects absent and invalid listen-port configuration", () => {
  for (const port of [undefined, "0", "65536", "invalid"]) {
    const result = spawnSync(process.execPath, ["--import", guard, "-e", ""], {
      env: port === undefined ? {} : { PORT: port },
      encoding: "utf8",
      timeout: 5000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /azure_local_test_port_required/u);
  }
});

test("offline container verification rejects tags before calling Docker", () => {
  const result = spawnSync(process.execPath, ["scripts/azure/local-container-smoke.mjs"], {
    env: { KOVA_LOCAL_NODE_IMAGE: "node:24-bookworm-slim", PATH: "/not-an-executable-path" },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /A cached local image ID is required/u);
});
