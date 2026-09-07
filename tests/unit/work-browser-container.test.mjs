import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { createBrowserContainerFactory } from "../../work-runner/browser-container.mjs";
const image = "sha256:" + "a".repeat(64);
function fixture() {
  const calls = [];
  const spawn = (file, args, options) => {
    calls.push({ file, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => queueMicrotask(() => child.emit("close", 137));
    child.stdin = new Writable({
      write(chunk, _, done) {
        const message = JSON.parse(String(chunk));
        if (message.kind === "command")
          queueMicrotask(() =>
            child.stdout.write(
              JSON.stringify({
                kind: "result",
                id: message.id,
                result: { sequence: message.command.sequence, mode: "takeover" },
              }) + "\n",
            ),
          );
        done();
      },
    });
    queueMicrotask(() => {
      if (args.includes("start")) {
        child.stdout.write('{"kind":"ready","protocol":"kova-browser-v1"}\n');
        return;
      }
      const data = args.includes("info")
        ? { OSType: "linux", Runtimes: { runsc: {} } }
        : args.includes("image")
          ? [
              {
                Os: "linux",
                Config: {
                  User: "65532:65532",
                  Labels: { "com.kova.browser.protocol": "kova-browser-v1" },
                },
              },
            ]
          : null;
      if (data) child.stdout.write(JSON.stringify(data));
      child.emit("close", 0);
    });
    return child;
  };
  return { calls, factory: createBrowserContainerFactory({ image }, spawn) };
}
test("interactive browser uses fixed runsc networkless readonly no-secret container arguments", async () => {
  assert.throws(() => createBrowserContainerFactory({ image: "mutable:latest" }));
  const f = fixture();
  assert.equal(await f.factory.probe(), true);
  const ownerId = crypto.randomUUID(),
    sessionId = crypto.randomUUID();
  const browser = await f.factory.create({
    ownerId,
    sessionId,
    expiresAt: Date.now() + 60000,
    onNetwork: async () => {
      throw new Error("denied");
    },
  });
  try {
    const create = f.calls.find((v) => v.args.includes("create"));
    assert.equal(create.file, "/usr/bin/docker");
    assert.equal(create.options.shell, false);
    assert.deepEqual(Object.keys(create.options.env).sort(), ["LANG", "PATH"]);
    for (const [flag, value] of [
      ["--network", "none"],
      ["--runtime", "runsc"],
      ["--user", "65532:65532"],
      ["--log-driver", "none"],
      ["--security-opt", "no-new-privileges"],
    ])
      assert.equal(create.args[create.args.indexOf(flag) + 1], value);
    assert.ok(create.args.includes("--read-only"));
    assert.ok(!create.args.includes("--mount"));
    assert.ok(!create.args.includes("--volume"));
    assert.ok(create.args.some((v) => v.startsWith("KOVA_BROWSER_EXPIRES_AT=")));
    assert.equal(
      (await browser.command({ sequence: 1, actor: "owner", operation: "snapshot" })).sequence,
      1,
    );
  } finally {
    await browser.close();
  }
  assert.ok(
    f.calls.some((v) => v.args.includes("rm") && v.args.includes(`kova-browser-${sessionId}`)),
  );
});
