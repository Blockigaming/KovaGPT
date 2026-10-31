import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  createPlaidWebhookVerifier,
  opaqueFinanceId,
} from "../../src/finances/plaid-webhook.server.mjs";
import { readFinanceSnapshot } from "../../src/finances/finance-read.server.mjs";

const now = Date.parse("2026-10-31T12:00:00Z");
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "fixture-key",
  alg: "ES256",
  use: "sig",
  created_at: now / 1000 - 1000,
  expired_at: null,
};
const raw =
  '{"webhook_type":"TRANSACTIONS","webhook_code":"SYNC_UPDATES_AVAILABLE","item_id":"fixture-item"}';
function jwt(body = raw, payload = {}, header = {}) {
  const parts = [
    { alg: "ES256", kid: jwk.kid, typ: "JWT", ...header },
    {
      iat: now / 1000,
      request_body_sha256: createHash("sha256").update(body).digest("hex"),
      ...payload,
    },
  ].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"));
  return [
    ...parts,
    sign("sha256", Buffer.from(parts.join(".")), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64url"),
  ].join(".");
}
test("Plaid verifies a real ES256 signature, exact body hash, and cached fixed-endpoint key", async () => {
  const calls = [];
  const verifier = createPlaidWebhookVerifier(
    async (path, body) => {
      calls.push([path, body]);
      return { key: jwk };
    },
    () => now,
  );
  const result = await verifier(raw, jwt());
  assert.equal(result.itemId, "fixture-item");
  assert.equal(result.type, "TRANSACTIONS");
  await verifier(raw, jwt());
  assert.deepEqual(calls, [["/webhook_verification_key/get", { key_id: jwk.kid }]]);
  assert.equal(
    opaqueFinanceId("plaid-item", result.itemId),
    opaqueFinanceId("plaid-item", "fixture-item"),
  );
  assert.notEqual(
    opaqueFinanceId("plaid-item", result.itemId),
    opaqueFinanceId("plaid-event", result.itemId),
  );
});
test("forged proxy tokens, wrong algorithms, expired/future JWTs, and body mutation are rejected", async () => {
  let calls = 0;
  const verifier = createPlaidWebhookVerifier(
    async () => {
      calls++;
      return { key: jwk };
    },
    () => now,
  );
  for (const token of [
    null,
    "proxy-shared-secret",
    jwt(raw, {}, { alg: "none" }),
    jwt(raw, { iat: now / 1000 - 301 }),
    jwt(raw, { iat: now / 1000 + 31 }),
    jwt(raw, {}, { kid: "https://attacker.example/key" }),
    jwt(raw, {}, { crit: ["b64"] }),
  ])
    await assert.rejects(() => verifier(raw, token), /invalid_webhook_signature/);
  assert.equal(calls, 0);
  await assert.rejects(() => verifier(raw + " ", jwt()), /invalid_webhook_signature/);
  const parts = jwt().split(".");
  parts[2] = Buffer.alloc(64).toString("base64url");
  await assert.rejects(() => verifier(raw, parts.join(".")), /invalid_webhook_signature/);
});
test("revoked and mismatched Plaid keys are never trusted", async () => {
  for (const key of [
    { ...jwk, expired_at: now / 1000 - 10 },
    { ...jwk, kid: "different" },
    { ...jwk, crv: "P-384" },
  ]) {
    const verifier = createPlaidWebhookVerifier(
      async () => ({ key }),
      () => now,
    );
    await assert.rejects(() => verifier(raw, jwt()), /invalid_webhook_signature/);
  }
});
test("account and transaction reads recheck access and expose only selected fields", async () => {
  let checks = 0;
  const calls = [];
  const snapshot = await readFinanceSnapshot(
    "test-token",
    async (path, body) => {
      calls.push([path, body]);
      return path === "/accounts/get"
        ? {
            accounts: [
              {
                account_id: "a",
                name: "Checking",
                mask: "1234",
                balances: { current: 12, available: 10, iso_currency_code: "USD" },
                routing_number: "must-not-return",
              },
            ],
          }
        : {
            total_transactions: 101,
            transactions: [
              {
                transaction_id: "t",
                account_id: "a",
                name: "Coffee",
                date: "2026-10-30",
                amount: 5,
                access_token: "must-not-return",
              },
            ],
          };
    },
    async () => {
      checks++;
    },
    now,
  );
  assert.equal(checks, 3);
  assert.equal(snapshot.limited, true);
  assert.equal(snapshot.accounts[0].current, 12);
  assert.equal(snapshot.transactions[0].amount, 5);
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /routing_number|access_token|must-not-return|test-token/,
  );
  assert.deepEqual(calls[1][1], {
    access_token: "test-token",
    start_date: "2026-10-01",
    end_date: "2026-10-31",
    options: { count: 100, offset: 0 },
  });
});
test("revocation between reads stops the next provider call and discards results", async () => {
  let checks = 0,
    calls = 0;
  await assert.rejects(
    () =>
      readFinanceSnapshot(
        "test-token",
        async () => {
          calls++;
          return { accounts: [] };
        },
        async () => {
          if (++checks === 2) throw new Error("revoked");
        },
        now,
      ),
    /revoked/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    () =>
      readFinanceSnapshot(
        "test-token",
        async (path) =>
          path === "/accounts/get"
            ? { accounts: [] }
            : { transactions: [{ account_id: "foreign" }] },
        async () => {},
        now,
      ),
    /plaid_response_rejected/,
  );
});
