import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  createBrowserChannel,
  parseBrowserAction,
  executeInteractiveBrowser,
} from "../../src/lib/pricing/developer-browser-interactive.mjs";
import {
  createRealtimeConnection,
  realtimeGrant,
} from "../../src/lib/pricing/developer-realtime-session.mjs";
const url = "https://example.com/";
const click = { type: "click", x: 10, y: 20, button: "left" };
const finish = { type: "finish" };
const token = "signed." + "a".repeat(64);
const frame = (type, fields) => JSON.stringify({ type, ...fields });
test("browser actions are strictly limited to confirmed read-only operations", () => {
  assert.deepEqual(parseBrowserAction(click), click);
  for (const action of [
    { type: "type", text: "hello" },
    { type: "submit" },
    { type: "click", x: 840, y: 20, button: "left" },
    { ...click, button: "right" },
    { ...click, script: "alert(1)" },
    { type: "navigate", url: "https://example.com/?q=x" },
    { type: "scroll", x: 0, y: 0, scroll_x: 1201, scroll_y: 0 },
  ])
    assert.throws(() => parseBrowserAction(action), /invalid/);
});
test("snapshot fences require current explicit approval and computer scope; cancellation discards pending actions", async () => {
  const views = [],
    controller = new AbortController();
  const channel = createBrowserChannel((e) => views.push(e), controller.signal);
  const command = { snapshot_id: "wrong", approved: true, source: "browser", action: click };
  assert.throws(() => channel.accept(command, false), /conflict/);
  const pending = channel.next({ url }, 10000);
  command.snapshot_id = views[0].snapshot_id;
  assert.throws(() => channel.accept({ ...command, approved: false }, true), /invalid/);
  assert.throws(() => channel.accept({ ...command, source: "computer" }, false), /scope_required/);
  assert.throws(
    () =>
      channel.accept({ ...command, source: "computer", action: { type: "navigate", url } }, true),
    /invalid/,
  );
  channel.accept({ ...command, source: "computer" }, true);
  assert.deepEqual(await pending, click);
  assert.throws(() => channel.accept(command, true), /conflict/);
  const next = channel.next({ url }, 10000);
  assert.throws(() => channel.accept(command, true), /conflict/);
  controller.abort();
  await assert.rejects(next, /cancelled/);
  channel.close();
});
function runner(actions, opts = {}) {
  const calls = [];
  const run = executeInteractiveBrowser({
    initial: url,
    channel: { next: async () => actions.shift() ?? finish },
    check: async (u) => {
      calls.push(["check", u.href]);
    },
    capture: async (u) => ({ url: u.href, text: "page" }),
    navigate: async (u) => calls.push(["navigate", u.href]),
    linkAt: async () => url + "next",
    scroll: async (a) => calls.push(["scroll", a.scroll_y]),
    wait: async () => calls.push(["wait"]),
    deadline: Date.now() + 10000,
    ...opts,
  });
  return { calls, run };
}
test("interactive execution checks every destination and supports safe viewport changes", async () => {
  const f = runner([
    click,
    { type: "scroll", x: 0, y: 0, scroll_x: 0, scroll_y: 200 },
    { type: "screenshot" },
    finish,
  ]);
  assert.equal((await f.run).url, url + "next");
  assert.deepEqual(
    f.calls.filter(([name]) => name !== "check"),
    [
      ["navigate", url + "next"],
      ["scroll", 200],
    ],
  );
  const bad = runner([click], { linkAt: async () => "https://other.com/" });
  await assert.rejects(bad.run, /scope_required/);
  assert.ok(!bad.calls.some(([name]) => name === "navigate"));
  let now = 0;
  const expired = runner([click], {
    now: () => now,
    deadline: 5,
    check: async (u) => {
      if (u.href !== url) now = 5;
    },
  });
  await assert.rejects(expired.run, /expired/);
  assert.ok(!expired.calls.some(([name]) => name === "navigate"));
  const revoked = runner([click], {
    check: async (u) => {
      if (u.href !== url) throw Error("revoked");
    },
  });
  await assert.rejects(revoked.run, /revoked/);
  assert.ok(!revoked.calls.some(([name]) => name === "navigate"));
});
test("browser transport authorizes quote and turn, denies stale and unscoped actions, and finishes once", async () => {
  const grant = realtimeGrant(),
    id = randomUUID(),
    events = [],
    calls = [];
  let caps = ["cloud_browser"];
  const connection = createRealtimeConnection({
    kind: "browser",
    send: (e) => events.push(e),
    close: () => {},
    claim: async () => ({ id: grant.id, expiresAt: Date.now() + 100000 }),
    check: async () => ({ capabilities: caps }),
    quote: async () => {
      calls.push("quote");
      return { quoteToken: token };
    },
    begin: async () => {
      calls.push("begin");
      return {};
    },
    execute: async (_identity, _body, _key, _token, _signal, _delta, channel) => {
      const action = await channel.next({ url }, 10000);
      assert.deepEqual(action, finish);
      return { url };
    },
    finish: async () => calls.push("finish"),
    disconnect: async () => {},
  });
  try {
    await connection.receive(frame("session.authenticate", { token: grant.token }));
    assert.equal(events[0].maximum_turns, 1);
    const input = { model: "browser", url, interactive: true };
    await connection.receive(frame("turn.quote", { id, input }));
    assert.deepEqual(calls, ["quote"]);
    const run = connection.receive(
      frame("turn.create", { id, input, quote_token: token, request_key: id }),
    );
    await new Promise(setImmediate);
    const view = events.find((e) => e.kind === "browser.snapshot");
    assert.ok(view);
    const command = {
      snapshot_id: view.snapshot_id,
      approved: true,
      source: "computer",
      action: finish,
    };
    await connection.receive(frame("turn.action", { id, command }));
    assert.equal(events.at(-1).code, "developer_scope_required");
    caps = ["cloud_browser", "computer_use"];
    await connection.receive(
      frame("turn.action", { id, command: { ...command, snapshot_id: randomUUID() } }),
    );
    assert.equal(events.at(-1).code, "developer_browser_conflict");
    await connection.receive(frame("turn.action", { id, command }));
    await run;
    assert.equal(events.at(-1).type, "turn.completed");
    assert.deepEqual(calls, ["quote", "begin", "finish"]);
  } finally {
    await connection.stop();
  }
});
