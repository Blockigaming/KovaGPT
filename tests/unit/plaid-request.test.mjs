import assert from "node:assert/strict";
import test from "node:test";
import {
  financeCountry,
  financeLinkRequest,
  plaidConfiguration,
  requestPlaid,
} from "../../src/finances/plaid-request.server.mjs";

const env = {
  PLAID_ENV: "production",
  PLAID_CLIENT_ID: "fixture-client",
  PLAID_SECRET: "fixture-private-secret",
  AZURE_ENVIRONMENT: "production",
};
const reply = (value) => Response.json(value);

test("personal finance Link admits banks with Transactions without requiring investment or liability support", () => {
  const body = financeLinkRequest("11111111-1111-4111-8111-111111111111", "us", {
    ...env,
    PLAID_WEBHOOK_URL: "https://kovagpt.com/api/finances/webhook",
  });
  assert.deepEqual(body.products, ["transactions"]);
  assert.deepEqual(body.additional_consented_products, ["liabilities", "investments"]);
  assert.deepEqual(body.country_codes, ["US"]);
  assert.equal(body.redirect_uri, undefined);
  assert.deepEqual(body.user, { client_user_id: "11111111-1111-4111-8111-111111111111" });
});

for (const country of [null, {}, 1, "USA", " US", "GB", "US,CA", "", "__proto__"]) {
  test(`unapproved or malformed country ${JSON.stringify(country)} is rejected`, () => {
    assert.throws(() => financeCountry(country, env), { message: "finance_region_ineligible" });
  });
}

test("configured regions are normalized and a malformed region configuration fails closed", () => {
  assert.equal(financeCountry("ca", { ...env, KOVA_FINANCE_REGIONS: "us, CA" }), "CA");
  assert.throws(() => financeCountry("US", { ...env, KOVA_FINANCE_REGIONS: "US," }), {
    message: "finance_region_ineligible",
  });
});

test("Link requires a secure configured callback without embedded credentials", () => {
  for (const url of [
    undefined,
    "http://kovagpt.com",
    "https://user:secret@kovagpt.com",
    "https://kovagpt.com/#token",
  ])
    assert.throws(
      () =>
        financeLinkRequest("11111111-1111-4111-8111-111111111111", "US", {
          ...env,
          PLAID_WEBHOOK_URL: url,
        }),
      { message: "plaid_not_configured" },
    );
});

test("Plaid requests use the exact production host, fixed version, no redirects and private headers", async () => {
  let calls = 0;
  const value = await requestPlaid(
    "/accounts/get",
    { access_token: "fixture-access" },
    {
      env,
      fetchImpl: async (url, init) => {
        calls++;
        assert.equal(url, "https://production.plaid.com/accounts/get");
        assert.equal(init.method, "POST");
        assert.equal(init.redirect, "error");
        assert.equal(init.cache, "no-store");
        assert.equal(init.headers["Plaid-Version"], "2020-09-14");
        assert.equal(init.headers["PLAID-SECRET"], env.PLAID_SECRET);
        assert.deepEqual(JSON.parse(init.body), { access_token: "fixture-access" });
        assert.ok(init.signal instanceof AbortSignal);
        return reply({ accounts: [] });
      },
    },
  );
  assert.deepEqual(value, { accounts: [] });
  assert.equal(calls, 1);
});

for (const [name, patch] of [
  ["missing environment", { PLAID_ENV: undefined }],
  ["unrecognized environment", { PLAID_ENV: "https://attacker.invalid" }],
  ["inherited property environment", { PLAID_ENV: "toString" }],
  ["retired development environment", { PLAID_ENV: "development" }],
  ["Sandbox in production", { PLAID_ENV: "sandbox" }],
  ["missing credentials", { PLAID_SECRET: "" }],
  ["newline credentials", { PLAID_SECRET: "secret\nother" }],
]) {
  test(`${name} fails before the provider is called`, async () => {
    let calls = 0;
    await assert.rejects(
      requestPlaid(
        "/accounts/get",
        {},
        {
          env: { ...env, ...patch },
          fetchImpl: async () => {
            calls++;
            return reply({});
          },
        },
      ),
      { message: "plaid_not_configured" },
    );
    assert.equal(calls, 0);
  });
}

test("Sandbox must be explicitly selected outside production", () => {
  assert.equal(
    plaidConfiguration({ ...env, AZURE_ENVIRONMENT: "test", PLAID_ENV: "sandbox" }).base,
    "https://sandbox.plaid.com",
  );
});

for (const path of [
  "https://attacker.invalid",
  "/item/get?secret=bad",
  "/transfer/create",
  "/payment_initiation/payment/create",
  "/accounts/get/../item/get",
]) {
  test(`rejects non-read operation or changed destination ${path}`, async () => {
    let calls = 0;
    await assert.rejects(
      requestPlaid(
        path,
        {},
        {
          env,
          fetchImpl: async () => {
            calls++;
            return reply({});
          },
        },
      ),
      { message: "plaid_request_rejected" },
    );
    assert.equal(calls, 0);
  });
}

test("request fields cannot replace platform credentials", async () => {
  for (const body of [
    { client_id: "replacement" },
    { secret: "replacement" },
    [],
    null,
    { value: "x".repeat(65536) },
  ]) {
    await assert.rejects(requestPlaid("/accounts/get", body, { env }), {
      message: "plaid_request_rejected",
    });
  }
});

test("provider diagnostics and credentials are never reflected in errors", async () => {
  await assert.rejects(
    requestPlaid(
      "/item/public_token/exchange",
      {},
      {
        env,
        fetchImpl: async () => new Response("private provider diagnostics", { status: 401 }),
      },
    ),
    { message: "plaid_401" },
  );
  await assert.rejects(
    requestPlaid(
      "/item/remove",
      {},
      {
        env,
        fetchImpl: async () => {
          throw new Error("private provider diagnostics");
        },
      },
    ),
    { message: "plaid_transport_failed" },
  );
});

test("malformed, invalid UTF8, non-object and oversized responses are rejected", async () => {
  for (const response of [
    new Response("not json"),
    reply([]),
    reply(null),
    new Response(new Uint8Array([0xff])),
    reply({ value: "x".repeat(256 * 1024) }),
    new Response("{}", { headers: { "content-length": String(256 * 1024 + 1) } }),
  ]) {
    await assert.rejects(
      requestPlaid("/accounts/get", {}, { env, fetchImpl: async () => response }),
      { message: "plaid_response_rejected" },
    );
  }
});

test("cancellation before a request sends nothing", async () => {
  let calls = 0;
  await assert.rejects(
    requestPlaid(
      "/accounts/get",
      {},
      {
        env,
        signal: AbortSignal.abort(),
        fetchImpl: async () => {
          calls++;
          return reply({});
        },
      },
    ),
    { message: "plaid_request_cancelled" },
  );
  assert.equal(calls, 0);
});

test("a stalled fetch and stalled response body stop at the deadline without retry", async () => {
  let calls = 0;
  await assert.rejects(
    requestPlaid(
      "/accounts/get",
      {},
      {
        env,
        timeoutMs: 30,
        fetchImpl: (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            calls++;
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
      },
    ),
    { message: "plaid_request_cancelled" },
  );
  assert.equal(calls, 1);
  let cancelled = false;
  await assert.rejects(
    requestPlaid(
      "/accounts/get",
      {},
      {
        env,
        timeoutMs: 30,
        fetchImpl: async () =>
          new Response(
            new ReadableStream({
              cancel() {
                cancelled = true;
              },
            }),
          ),
      },
    ),
    { message: "plaid_request_cancelled" },
  );
  assert.equal(cancelled, true);
});
