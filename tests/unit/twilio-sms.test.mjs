import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import {
  createTwilioSmsSender,
  loadTwilioSmsConfiguration,
  summarizeTwilioSmsConfiguration,
} from "../../src/lib/twilio-sms.server.mjs";

const env = {
  KOVA_SMS_PROVIDER: "twilio",
  KOVA_SMS_SEND_ENABLED: "true",
  TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`,
  TWILIO_API_KEY_SID: `SK${"b".repeat(32)}`,
  TWILIO_API_KEY_SECRET: "synthetic-private-api-key-secret",
  TWILIO_MESSAGING_SERVICE_SID: `MG${"c".repeat(32)}`,
};
const input = {
  to: "+442079460123",
  body: "Kova code is 123456. Keep it private & safe + verify?",
};
const messageId = `SM${"d".repeat(32)}`;
const configuration = () => loadTwilioSmsConfiguration(env);
function acceptedResponse(patch = {}, responseOptions = {}) {
  return new Response(
    JSON.stringify({
      sid: messageId,
      account_sid: env.TWILIO_ACCOUNT_SID,
      messaging_service_sid: env.TWILIO_MESSAGING_SERVICE_SID,
      to: input.to,
      status: "queued",
      error_code: null,
      num_segments: "0",
      body: "private provider message text",
      ...patch,
    }),
    { status: 201, headers: { "Content-Type": "application/json" }, ...responseOptions },
  );
}
function fixture(fetcher = () => acceptedResponse(), options = {}) {
  const calls = [];
  const send = createTwilioSmsSender(configuration(), {
    fetcher: async (...args) => {
      calls.push(args);
      return fetcher(...args);
    },
    ...options,
  });
  return { send, calls };
}
const outcome = (value, reason) => ({ outcome: value, reason, deliveryVerified: false });

test("disabled configuration reads no provider or credentials and construction never sends", async () => {
  for (const flag of [undefined, "false", "TRUE", "1", ""]) {
    const reads = [];
    const config = loadTwilioSmsConfiguration(
      new Proxy(
        {},
        {
          get(_target, key) {
            reads.push(key);
            if (key === "KOVA_SMS_SEND_ENABLED") return flag;
            throw new Error("private credentials must not be read");
          },
        },
      ),
    );
    assert.equal(config, null);
    assert.deepEqual(reads, ["KOVA_SMS_SEND_ENABLED"]);
    const send = createTwilioSmsSender(config, {
      fetcher() {
        assert.fail("disabled sender must never fetch");
      },
    });
    assert.deepEqual(await send(input), outcome("disabled", "sending_disabled"));
  }
  const f = fixture();
  assert.equal(f.calls.length, 0);
  assert.deepEqual(summarizeTwilioSmsConfiguration(null), {
    provider: "twilio",
    sendEnabled: false,
    configurationValid: false,
    authentication: "api_key",
    transport: "programmable_messaging",
    singleSegmentBody: true,
  });
});

test("enabled configuration is validated and its summary contains no credentials or SIDs", () => {
  const config = configuration();
  assert.equal(Object.isFrozen(config), true);
  assert.equal(summarizeTwilioSmsConfiguration(config).configurationValid, true);
  const summary = JSON.stringify(summarizeTwilioSmsConfiguration(config));
  for (const value of Object.values(config)) assert.equal(summary.includes(value), false);
  for (const patch of [
    { TWILIO_ACCOUNT_SID: `AC${"a".repeat(31)}` },
    { TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}/Messages.json` },
    { TWILIO_API_KEY_SID: `AC${"b".repeat(32)}` },
    { TWILIO_API_KEY_SECRET: "short" },
    { TWILIO_API_KEY_SECRET: "private-key\r\nAuthorization: injected" },
    { TWILIO_API_KEY_SECRET: "a".repeat(4097) },
    { TWILIO_MESSAGING_SERVICE_SID: `MG${"z".repeat(32)}` },
  ])
    assert.throws(
      () => loadTwilioSmsConfiguration({ ...env, ...patch }),
      /^Error: twilio_sms_invalid_configuration$/u,
    );
  assert.throws(
    () => loadTwilioSmsConfiguration({ ...env, KOVA_SMS_PROVIDER: "other" }),
    /^Error: twilio_sms_invalid_provider$/u,
  );
  for (const timeoutMs of [0, -1, 8001, 1.5, Infinity, NaN])
    assert.throws(
      () => createTwilioSmsSender(config, { timeoutMs }),
      /^Error: twilio_sms_invalid_transport_options$/u,
    );
  assert.throws(
    () => createTwilioSmsSender(config, { fetcher: null }),
    /^Error: twilio_sms_invalid_transport_options$/u,
  );
  assert.throws(
    () =>
      createTwilioSmsSender({
        get accountSid() {
          throw new Error("private detail");
        },
      }),
    /^Error: twilio_sms_invalid_configuration$/u,
  );
});

test("one explicit send uses the fixed endpoint, API-key auth, encoded form and one-minute queue window", async () => {
  const mutableConfig = { ...configuration() };
  const calls = [];
  const send = createTwilioSmsSender(mutableConfig, {
    fetcher: async (...args) => {
      calls.push(args);
      return acceptedResponse();
    },
  });
  mutableConfig.accountSid = "unsafe changed endpoint";
  mutableConfig.apiKeySecret = "unsafe changed credential";
  assert.equal(calls.length, 0);
  assert.deepEqual(await send(input), {
    outcome: "accepted",
    messageId,
    status: "queued",
    deliveryVerified: false,
  });
  assert.equal(calls.length, 1);
  const [url, request] = calls[0];
  assert.equal(
    url,
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
  );
  assert.equal(request.method, "POST");
  assert.equal(request.redirect, "error");
  assert.equal(request.signal instanceof AbortSignal, true);
  assert.deepEqual(request.headers, {
    Authorization: `Basic ${Buffer.from(`${env.TWILIO_API_KEY_SID}:${env.TWILIO_API_KEY_SECRET}`, "utf8").toString("base64")}`,
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  });
  assert.deepEqual(Object.fromEntries(new URLSearchParams(request.body)), {
    To: input.to,
    Body: input.body,
    MessagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
    ValidityPeriod: "60",
  });
  assert.equal(request.body.includes("To=%2B44"), true);
  assert.equal(request.body.includes("%26+safe+%2B"), true);
});

test("international E.164 formatting and a single printable GSM-7 segment are enforced before fetching", async () => {
  const f = fixture((_url, request) =>
    acceptedResponse({ to: new URLSearchParams(request.body).get("To") }),
  );
  for (const to of ["+14155552671", "+442079460123", "+919876543210", "+123456789012345"])
    assert.equal((await f.send({ ...input, to })).outcome, "accepted");
  for (const body of ["A".repeat(160), "^".repeat(80), `${"A".repeat(158)}{`, "{}[]\\^~|"])
    assert.equal((await f.send({ ...input, body })).outcome, "accepted");
  const acceptedCalls = f.calls.length;
  for (const to of [
    "442079460123",
    "+042079460123",
    "+1",
    "+1234567890123456",
    "+44 2079460123",
    "whatsapp:+442079460123",
    123,
  ])
    assert.deepEqual(await f.send({ ...input, to }), outcome("rejected", "invalid_recipient"));
  for (const body of [
    "",
    " ",
    "A".repeat(161),
    "^".repeat(81),
    `${"A".repeat(159)}{`,
    "code `123456`",
    "café",
    "€",
    "📱",
    "code\n123456",
    "code\r123456",
    "code\t123456",
    null,
  ])
    assert.deepEqual(await f.send({ ...input, body }), outcome("rejected", "invalid_body"));
  for (const value of [
    null,
    [],
    "code",
    { ...input, From: "+14155552671" },
    { ...input, StatusCallback: "https://example.test/" },
    {
      get to() {
        throw new Error("private input detail");
      },
    },
  ])
    assert.deepEqual(await f.send(value), outcome("rejected", "invalid_input"));
  assert.equal(f.calls.length, acceptedCalls);
});

test("create acceptance validates message ownership and never claims independently verified delivery", async () => {
  for (const status of ["accepted", "queued", "sending", "sent", "delivered"]) {
    const f = fixture(() => acceptedResponse({ status }));
    assert.deepEqual(await f.send(input), {
      outcome: "accepted",
      messageId,
      status,
      deliveryVerified: false,
    });
  }
  for (const patch of [
    { sid: `MM${"d".repeat(32)}` },
    { sid: `SM${"d".repeat(31)}` },
    { account_sid: `AC${"e".repeat(32)}` },
    { to: "+14155552671" },
    { messaging_service_sid: `MG${"e".repeat(32)}` },
    { status: "failed" },
    { status: "scheduled" },
    { status: "received" },
    { error_code: 21211 },
  ]) {
    const f = fixture(() => acceptedResponse(patch));
    assert.deepEqual(await f.send(input), outcome("uncertain", "unexpected_response"));
    assert.equal(f.calls.length, 1);
  }
});

test("explicit 4xx failures are rejected while 5xx and unknown responses remain uncertain without retries", async () => {
  for (const [status, expected] of [
    [400, outcome("rejected", "provider_rejected")],
    [401, outcome("rejected", "provider_rejected")],
    [403, outcome("rejected", "provider_rejected")],
    [429, outcome("rejected", "rate_limited")],
    [500, outcome("uncertain", "unexpected_response")],
    [503, outcome("uncertain", "unexpected_response")],
    [200, outcome("uncertain", "unexpected_response")],
    [202, outcome("uncertain", "unexpected_response")],
  ]) {
    const f = fixture(() => new Response("private provider error with credentials", { status }));
    assert.deepEqual(await f.send(input), expected);
    assert.equal(f.calls.length, 1);
  }
});

test("redirects, malformed or oversized responses and raw exceptions produce safe uncertain results", async () => {
  const privateMarker = `${env.TWILIO_API_KEY_SECRET} ${input.to} ${input.body}`;
  const redirected = acceptedResponse();
  Object.defineProperty(redirected, "redirected", { value: true });
  const otherUrl = acceptedResponse();
  Object.defineProperty(otherUrl, "url", { value: "https://example.test/private" });
  const cases = [
    [() => new Response(privateMarker, { status: 302 }), "redirect_rejected"],
    [() => redirected, "redirect_rejected"],
    [() => otherUrl, "redirect_rejected"],
    [
      () => {
        throw new Error(privateMarker);
      },
      "transport_uncertain",
    ],
    [
      () =>
        new Response(privateMarker, {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      "transport_uncertain",
    ],
    [
      () => acceptedResponse({}, { headers: { "Content-Type": "text/plain" } }),
      "unexpected_response",
    ],
    [
      () =>
        acceptedResponse(
          {},
          { headers: { "Content-Type": "application/json", "Content-Length": "32769" } },
        ),
      "transport_uncertain",
    ],
    [
      () => acceptedResponse({ privateField: privateMarker + "a".repeat(32768) }),
      "transport_uncertain",
    ],
    [
      () =>
        new Response(new Uint8Array([255]), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      "transport_uncertain",
    ],
    [
      () => new Response("null", { status: 201, headers: { "Content-Type": "application/json" } }),
      "unexpected_response",
    ],
  ];
  for (const [fetcher, reason] of cases) {
    const f = fixture(fetcher);
    const result = await f.send(input);
    assert.deepEqual(result, outcome("uncertain", reason));
    assert.equal(f.calls.length, 1);
    const serialized = JSON.stringify(result);
    for (const value of [
      env.TWILIO_API_KEY_SECRET,
      input.to,
      input.body,
      "private provider",
      "example.test",
    ])
      assert.equal(serialized.includes(value), false);
  }
});

test("one deadline bounds an uncooperative fetch and the complete streamed response body", async () => {
  const never = fixture(() => new Promise(() => {}), { timeoutMs: 15 });
  assert.deepEqual(await never.send(input), outcome("uncertain", "timeout"));
  assert.equal(never.calls.length, 1);
  assert.equal(never.calls[0][1].signal.aborted, true);

  let canceled = false;
  const streamed = fixture(
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("{"));
          },
          cancel() {
            canceled = true;
            return new Promise(() => {});
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    },
    { timeoutMs: 25 },
  );
  assert.deepEqual(await streamed.send(input), outcome("uncertain", "timeout"));
  assert.equal(streamed.calls.length, 1);
  assert.equal(canceled, true);
  assert.equal(streamed.calls[0][1].signal.aborted, true);
});
