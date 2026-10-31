import assert from "node:assert/strict";
import test from "node:test";
import {
  savePlaidLinkSession,
  readPlaidLinkSession,
  clearPlaidLinkSession,
} from "../../src/finances/plaid-link-session.mjs";
const owner = "00000000-0000-4000-8000-000000000001";
const stranger = "00000000-0000-4000-8000-000000000002";
const now = Date.parse("2026-10-31T12:00:00Z");
const storage = () => {
  const map = new Map();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
};
test("bank OAuth returns resume only the same principal's unexpired short-lived Link token", () => {
  const s = storage();
  savePlaidLinkSession(
    s,
    owner,
    "link-production-fixture",
    new Date(now + 3600_000).toISOString(),
    now,
  );
  assert.equal(readPlaidLinkSession(s, owner, now), "link-production-fixture");
  assert.equal(readPlaidLinkSession(s, stranger, now), null);
  assert.equal(readPlaidLinkSession(s, owner, now + 900_001), null);
  clearPlaidLinkSession(s, stranger);
  assert.equal(readPlaidLinkSession(s, owner, now), "link-production-fixture");
  clearPlaidLinkSession(s, owner);
  assert.equal(readPlaidLinkSession(s, owner, now), null);
});
test("access/public tokens, malformed owners, invalid expiry and storage errors never resume", () => {
  const s = storage();
  for (const token of [
    "access-production-fixture",
    "public-production-fixture",
    "link-https://attacker.example",
    "",
  ])
    assert.throws(
      () => savePlaidLinkSession(s, owner, token, new Date(now + 1000).toISOString(), now),
      /invalid_link_session/,
    );
  assert.throws(
    () => savePlaidLinkSession(s, "another-user", "link-production-fixture", "invalid", now),
    /invalid_link_session/,
  );
  assert.throws(
    () =>
      savePlaidLinkSession(
        s,
        owner,
        "link-production-fixture",
        new Date(now - 1).toISOString(),
        now,
      ),
    /expired_link_session/,
  );
  assert.equal(readPlaidLinkSession({ getItem: () => "not-json" }, owner), null);
  assert.equal(
    readPlaidLinkSession(
      {
        getItem: () => {
          throw new Error("blocked");
        },
      },
      owner,
    ),
    null,
  );
});
