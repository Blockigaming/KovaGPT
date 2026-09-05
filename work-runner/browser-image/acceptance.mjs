import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createBrowserContainerFactory } from "../browser-container.mjs";
if (process.argv.length !== 3 || process.argv[2] !== "--execute")
  throw new Error("Explicit ephemeral-container acceptance invocation required");
const factory = createBrowserContainerFactory({ image: process.env.KOVA_WORK_BROWSER_IMAGE });
await factory.probe();
await factory.reapExpired();
const ownerId = crypto.randomUUID(),
  sessionId = crypto.randomUUID(),
  requests = [];
const browser = await factory.create({
  ownerId,
  sessionId,
  expiresAt: Date.now() + 60000,
  onNetwork: async (request, authority) => {
    requests.push({ url: request.url, actor: authority.actor });
    if (
      !["https://browser-fixture.net/", "https://browser-fixture.net/large"].includes(request.url)
    )
      throw new Error("unapproved destination");
    const body = request.url.endsWith("/large")
      ? "<html><body><p>" +
        "界".repeat(6000) +
        "</p>" +
        Array.from({ length: 60 }, () => "<button>" + "界".repeat(200) + "</button>").join("") +
        "</body></html>"
      : '<html><body><p>Isolated browser ready</p><label>Password<input type="password"></label><button type="button" onclick="this.textContent=\'Clicked\'">Continue</button><script>fetch("http://169.254.169.254/latest/meta-data").catch(()=>{})</script></body></html>';
    return {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      bodyBase64: Buffer.from(body).toString("base64"),
    };
  },
});
try {
  const { stdout } = await promisify(execFile)(
    "/usr/bin/docker",
    ["--host", "unix:///var/run/docker.sock", "inspect", `kova-browser-${sessionId}`],
    { timeout: 10000, maxBuffer: 65536 },
  );
  const [container] = JSON.parse(stdout);
  assert.equal(container.HostConfig.NetworkMode, "none");
  assert.equal(container.HostConfig.Runtime, "runsc");
  assert.equal(container.HostConfig.ReadonlyRootfs, true);
  assert.equal(container.Config.User, "65532:65532");
  assert.equal(container.HostConfig.LogConfig.Type, "none");
  assert.equal(container.HostConfig.Binds, null);
  const first = await browser.command({
    actor: "owner",
    sequence: 1,
    operation: "navigate",
    url: "https://browser-fixture.net/",
  });
  assert.match(first.text, /Isolated browser ready/);
  assert.ok(requests.some((v) => v.url.includes("169.254.169.254")));
  const target = first.nodes.find((v) => v.inputType === "password");
  assert.ok(target);
  const entered = await browser.command({
    actor: "owner",
    sequence: 2,
    operation: "fill",
    view: first.view,
    target: target.id,
    text: "never-export-this-value",
  });
  assert.ok(!JSON.stringify(entered).includes("never-export"));
  await assert.rejects(browser.command({ actor: "agent", sequence: 3, operation: "snapshot" }));
  await browser.command({ actor: "owner", sequence: 4, operation: "release" });
  const model = await browser.command({ actor: "agent", sequence: 5, operation: "snapshot" });
  assert.ok(!JSON.stringify(model).includes("never-export"));
  await assert.rejects(browser.command({ actor: "agent", sequence: 5, operation: "snapshot" }));
  await browser.command({ actor: "owner", sequence: 6, operation: "takeover" });
  const large = await browser.command({
    actor: "owner",
    sequence: 7,
    operation: "navigate",
    url: "https://browser-fixture.net/large",
  });
  assert.ok(Buffer.byteLength(JSON.stringify(large)) <= 50000);
  await browser.command({ actor: "owner", sequence: 8, operation: "release" });
  const bounded = await browser.command({ actor: "agent", sequence: 9, operation: "snapshot" });
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= 10000);
  process.stdout.write(
    "Interactive Chromium: runsc, no network, readonly filesystem, owner takeover and replay guards passed.\n",
  );
} finally {
  await browser.close();
  await factory.closeOwner(ownerId);
}
