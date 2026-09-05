import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { gzipSync } from "node:zlib";
import {
  createBrowserEgress,
  publicBrowserIPv4,
  browserOrigin,
} from "../../work-runner/browser-egress.mjs";
const origin = "https://browser-fixture.net";
const input = {
  url: origin + "/private",
  method: "GET",
  headers: { cookie: "session=ephemeral", host: "evil.net", "proxy-authorization": "never" },
  bodyBase64: "",
};
function fixture({
  addresses = [{ address: "8.8.8.8", family: 4 }],
  status = 200,
  headers = {},
  body = Buffer.from("hello"),
  authority = async () => {},
} = {}) {
  const calls = [];
  const request = (options, callback) => {
    calls.push(options);
    const req = new EventEmitter();
    req.end = () =>
      queueMicrotask(() => {
        const res = new PassThrough();
        res.statusCode = status;
        res.headers = headers;
        callback(res);
        res.end(body);
      });
    req.destroy = () => {};
    return req;
  };
  return {
    calls,
    execute: createBrowserEgress(
      { origins: [origin], assertAuthority: authority },
      { resolve: async () => addresses, request },
    ),
  };
}
test("browser egress pins a public DNS result to TLS while stripping ambient routing headers", async () => {
  const f = fixture();
  const out = await f.execute(input);
  assert.equal(Buffer.from(out.bodyBase64, "base64").toString(), "hello");
  assert.equal(f.calls[0].servername, "browser-fixture.net");
  assert.equal(f.calls[0].rejectUnauthorized, true);
  assert.equal(f.calls[0].agent, false);
  assert.equal(f.calls[0].headers.cookie, "session=ephemeral");
  assert.equal(f.calls[0].headers.host, undefined);
  assert.equal(f.calls[0].headers["proxy-authorization"], undefined);
  let ip;
  f.calls[0].lookup("ignored", {}, (_, value) => (ip = value));
  assert.equal(ip, "8.8.8.8");
});
test("private, mixed, IPv6 and rebound DNS results never open a socket", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "172.31.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "203.0.113.1",
    "::1",
  ])
    assert.equal(publicBrowserIPv4(address), false);
  for (const addresses of [
    [{ address: "127.0.0.1", family: 4 }],
    [
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ],
    [{ address: "2606:4700::1111", family: 6 }],
  ]) {
    const f = fixture({ addresses });
    await assert.rejects(f.execute(input));
    assert.equal(f.calls.length, 0);
  }
  let n = 0;
  const f = fixture({
    authority: async () => {
      if (++n === 2) throw new Error("revoked");
    },
  });
  await assert.rejects(f.execute(input));
  assert.equal(f.calls.length, 0);
});
test("every origin and redirect stays within reviewed HTTPS scope; model requests cannot write", async () => {
  for (const origin of [
    "http://browser-fixture.net",
    "https://127.0.0.1",
    "https://host.local",
    "https://user:pass@browser-fixture.net",
    "https://browser-fixture.net/path",
  ])
    assert.throws(() => browserOrigin(origin));
  const f = fixture({ status: 302, headers: { location: "https://unapproved.net/secret" } });
  await assert.rejects(f.execute(input));
  assert.equal(f.calls.length, 1);
  await assert.rejects(f.execute({ ...input, url: "https://unapproved.net/" }));
  await assert.rejects(f.execute({ ...input, method: "POST", bodyBase64: "eA==" }));
  const owner = fixture();
  await owner.execute({ ...input, method: "POST", bodyBase64: "eA==" }, { allowWrites: true });
  assert.equal(owner.calls[0].method, "POST");
});
test("decompression and final authority are bounded before response reaches browser", async () => {
  const bomb = fixture({
    headers: { "content-encoding": "gzip" },
    body: gzipSync(Buffer.alloc(2 * 1024 * 1024 + 1)),
  });
  await assert.rejects(bomb.execute(input));
  let n = 0;
  const revoked = fixture({
    authority: async () => {
      if (++n === 3) throw new Error("revoked");
    },
  });
  await assert.rejects(revoked.execute(input));
  assert.equal(n, 3);
});
