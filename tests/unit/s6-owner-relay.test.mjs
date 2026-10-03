import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { createS6OwnerRelay, S6_ORIGIN, S6_CHECKS } from "../../src/lib/s6-owner-relay.mjs";
import { OwnerRelayClient } from "../../scripts/release/s6-owner-relay-client.mjs";

function fixture(patch = {}) {
  const now = Date.now(),
    key = randomBytes(32).toString("base64url");
  const env = {
    KOVA_S6_OWNER_RELAY_KEY: key,
    KOVA_S6_SOURCE_SHA: "a".repeat(40),
    KOVA_S6_OWNER_RELAY_DEADLINE: new Date(now + 1100000).toISOString(),
    KOVA_AUTH_PUBLIC_ORIGIN: S6_ORIGIN,
    KOVA_AUTH_REVERSE_PROXY_ORIGIN: S6_ORIGIN,
    SUPABASE_URL: "https://oztdrjtdglkizlewnulh.supabase.co",
    KOVA_AUTH_MODE: "dual",
    ...patch,
  };
  let time = now;
  const handle = createS6OwnerRelay({ env, clock: () => time });
  const request = (url, init) => handle(new Request(url, init));
  const coordinator = new OwnerRelayClient(key, request);
  const baseline = {
    origin: S6_ORIGIN,
    runId: "abcdef012345",
    sourceSha: "a".repeat(40),
    expectedEmail: "s6fixture@example.invalid",
    expectedAccountId: "10000000-0000-4000-8000-000000000001",
    capturedAt: new Date(now).toISOString(),
    deadline: now + 800000,
    existingAccounts: 0,
    existingHostedUsers: 0,
    authorizedDisposableGoogleIdentity: true,
  };
  return {
    now,
    key,
    env,
    handle,
    request,
    coordinator,
    baseline,
    advance: (ms) => {
      time += ms;
    },
  };
}

test("owner invitation is one-use, isolated, expiring, and transfers only sanitized receipts", async () => {
  const f = fixture();
  let owner;
  try {
    assert.equal(f.handle.googleIdentityAllowed(f.baseline.expectedEmail), false);
    const invite = await f.coordinator.open("abcdef012345", f.baseline);
    assert.equal(
      (await f.handle(new Request("https://foreign.invalid/api/internal/s6-owner-relay"))).status,
      404,
    );
    assert.equal(
      (await f.coordinator.call()).status,
      "waiting",
      "a foreign request must not discard the armed owner session",
    );
    owner = new OwnerRelayClient(invite.ticket, f.request);
    assert.deepEqual(await owner.claim(invite), f.baseline);
    assert.equal(f.handle.googleIdentityAllowed(f.baseline.expectedEmail), true);
    assert.equal(f.handle.googleIdentityAllowed("realuser@example.invalid"), false);
    const replay = new OwnerRelayClient(invite.ticket, f.request);
    try {
      await assert.rejects(replay.claim(invite));
    } finally {
      await replay.close();
    }
    const rows = S6_CHECKS.map((check) => ({
      check,
      status: "PASS",
      kind: "DEPLOYED",
      at: new Date(f.now).toISOString(),
      sourceSha: f.baseline.sourceSha,
      unexpectedSecret: "DO_NOT_TRANSFER",
    }));
    await assert.rejects(
      owner.call({
        action: "complete",
        runId: invite.runId,
        receipts: rows.map((r) => ({ ...r, kind: "SOURCE" })),
      }),
    );
    await assert.rejects(
      owner.call({
        action: "complete",
        runId: invite.runId,
        receipts: [rows[0], rows[0], rows[2]],
      }),
    );
    await owner.call({ action: "complete", runId: invite.runId, receipts: rows });
    await assert.rejects(owner.call({ action: "complete", runId: invite.runId, receipts: rows }));
    const result = await f.coordinator.call();
    assert.equal(result.status, "complete");
    assert.equal(result.receipts.length, 3);
    assert.ok(!JSON.stringify(result).includes("DO_NOT_TRANSFER"));
    assert.equal(f.handle.googleIdentityAllowed(f.baseline.expectedEmail), false);
    await f.coordinator.call({ action: "close", runId: invite.runId });
    assert.deepEqual(await f.coordinator.call(), { status: "empty" });
  } finally {
    await owner?.close();
    await f.coordinator.close();
  }
});
test("relay denies production, foreign origins, expired bounds, mismatched source, and oversized bodies", async () => {
  for (const patch of [
    { SUPABASE_URL: "https://mfbycmbjygcfkrsuepxf.supabase.co" },
    { KOVA_AUTH_PUBLIC_ORIGIN: "https://production.invalid" },
    { KOVA_AUTH_MODE: "supabase" },
    { KOVA_S6_OWNER_RELAY_DEADLINE: new Date(Date.now() - 1).toISOString() },
  ]) {
    const f = fixture(patch);
    try {
      await assert.rejects(f.coordinator.open("abcdef012345", f.baseline));
    } finally {
      await f.coordinator.close();
    }
  }
  const f = fixture();
  try {
    await assert.rejects(
      f.coordinator.open("abcdef012345", { ...f.baseline, sourceSha: "b".repeat(40) }),
    );
    await assert.rejects(
      f.coordinator.open("abcdef012345", { ...f.baseline, capturedAt: "invalid" }),
    );
    const denied = await f.handle(
      new Request(S6_ORIGIN + "/api/internal/s6-owner-relay", {
        headers: { Authorization: "Bearer " + f.key, Origin: "https://attacker.invalid" },
      }),
    );
    assert.equal(denied.status, 403);
    const large = await f.handle(
      new Request(S6_ORIGIN + "/api/internal/s6-owner-relay", {
        method: "POST",
        headers: { Authorization: "Bearer " + f.key },
        body: "x".repeat(20000),
      }),
    );
    assert.equal(large.status, 413);
    await f.coordinator.open("abcdef012345", f.baseline);
    f.advance(1200000);
    await assert.rejects(f.coordinator.call());
    assert.equal(f.handle.googleIdentityAllowed(f.baseline.expectedEmail), false);
  } finally {
    await f.coordinator.close();
  }
  assert.equal(
    createS6OwnerRelay({ env: {} }).googleIdentityAllowed("existing@example.invalid"),
    true,
  );
});
