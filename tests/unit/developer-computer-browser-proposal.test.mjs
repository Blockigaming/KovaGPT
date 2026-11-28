import test from "node:test";
import assert from "node:assert/strict";
import {
  createComputerProposalGate,
  mapComputerProposal,
} from "../../src/lib/pricing/developer-computer-browser-proposal.mjs";
const snapshot_id = "snapshot";
const command = {
  snapshot_id,
  model: "computer",
  input: "Inspect the page",
  max_output_tokens: 100,
};
const proposal = {
  object: "computer.proposal",
  status: "proposed",
  requires_human_review: true,
  screenshot: { width: 420, height: 270 },
  actions: [{ type: "click", x: 12, y: 20, button: "left" }],
};
const click = { type: "click", x: 25, y: 41, button: "left" };
const q = { quoteToken: "signed", maximumCharge: 0.1, expiresAt: 1100, currency: "USD" };
const confirm = { snapshot_id, approved: true, quote_token: q.quoteToken, request_key: "stable" };
function fixture() {
  const view = { screenshot: "server-owned" };
  const signal = new AbortController();
  const gate = createComputerProposalGate(snapshot_id, view, signal.signal, () => 1000);
  const calls = [];
  const prepare = async (v, i, s) => {
    assert.equal(v, view);
    assert.equal(s.aborted, false);
    calls.push("quote");
    return { input: { ...i, screenshot: v.screenshot }, quote: q };
  };
  const execute = async (i, k, t, s) => {
    assert.equal(i.screenshot, view.screenshot);
    assert.equal(k, "stable");
    assert.equal(t, "signed");
    assert.equal(s.aborted, false);
    calls.push("execute");
    return proposal;
  };
  return { gate, prepare, execute, calls, signal };
}
test("computer proposals are mapped from the actual 420x270 snapshot and reject unsafe actions", () => {
  assert.deepEqual(mapComputerProposal(proposal), click);
  for (const v of [
    { ...proposal, status: "blocked" },
    { ...proposal, screenshot: { width: 840, height: 540 } },
    { ...proposal, actions: [{ type: "navigate", url: "https://example.com" }] },
    { ...proposal, actions: [{ type: "click", x: 420, y: 0, button: "left" }] },
    { ...proposal, actions: [{ type: "scroll", x: 0, y: 0, scroll_x: 0, scroll_y: 601 }] },
  ])
    assert.throws(() => mapComputerProposal(v), /invalid/);
});
test("requires current quote, exact approval, exact action and one dispatch", async () => {
  const f = fixture();
  assert.throws(() => f.gate.accept(click), /proposal_required/);
  await assert.rejects(f.gate.propose(confirm, f.execute), /invalid/);
  await assert.rejects(f.gate.quote({ ...command, screenshot: "client" }, f.prepare), /invalid/);
  assert.deepEqual(await f.gate.quote(command, f.prepare), q);
  await assert.rejects(f.gate.propose({ ...confirm, approved: false }, f.execute), /invalid/);
  await assert.rejects(
    f.gate.propose({ ...confirm, quote_token: "different" }, f.execute),
    /invalid/,
  );
  assert.deepEqual((await f.gate.propose(confirm, f.execute)).action, click);
  assert.throws(() => f.gate.accept({ ...click, x: 26 }), /proposal_required/);
  f.gate.accept(click);
  assert.throws(() => f.gate.accept(click), /proposal_required/);
  await assert.rejects(f.gate.propose(confirm, f.execute), /invalid/);
  assert.deepEqual(f.calls, ["quote", "execute"]);
});
test("snapshot replacement, cancellation and uncertain dispatch fail closed", async () => {
  const f = fixture();
  await assert.rejects(f.gate.quote({ ...command, snapshot_id: "other" }, f.prepare), /conflict/);
  await f.gate.quote(command, f.prepare);
  const pending = f.gate.propose(confirm, async () => {
    f.gate.close();
    return proposal;
  });
  await assert.rejects(pending, /conflict/);
  assert.throws(() => f.gate.accept(click), /conflict/);
  const g = fixture();
  await g.gate.quote(command, g.prepare);
  await assert.rejects(
    g.gate.propose(confirm, async () => {
      throw Error("upstream");
    }),
    /upstream/,
  );
  await assert.rejects(g.gate.propose(confirm, g.execute), /invalid/);
  const h = fixture();
  h.signal.abort();
  await assert.rejects(h.gate.quote(command, h.prepare), /abort/i);
});
