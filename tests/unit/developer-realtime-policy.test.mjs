import assert from "node:assert/strict";
import test from "node:test";
import {
  REALTIME_MODEL,
  REALTIME_DIMENSIONS,
  developerRealtimeFields,
  developerRealtimeUsage,
  runDeveloperRealtime,
} from "../../src/lib/pricing/developer-realtime-policy.mjs";
import { parseDeveloperInput } from "../../src/lib/pricing/developer-platform-policy.mjs";
import {
  prepareDeveloperQuote,
  runMeteredProvider,
} from "../../src/lib/pricing/developer-metering.mjs";
const body = {
  model: REALTIME_MODEL,
  input: "Hello",
  output_modality: "text",
  max_output_tokens: 64,
};
const usage = {
  total_tokens: 35,
  input_tokens: 30,
  output_tokens: 5,
  input_token_details: {
    text_tokens: 20,
    audio_tokens: 10,
    cached_tokens: 7,
    cached_tokens_details: { text_tokens: 5, audio_tokens: 2 },
    image_tokens: 0,
  },
  output_token_details: { text_tokens: 5, audio_tokens: 0 },
};
const receipt = { id: "resp_fixture", model: REALTIME_MODEL, status: "completed", usage };
class Socket extends EventTarget {
  readyState = 1;
  sent = [];
  closed = 0;
  send(value) {
    this.sent.push(JSON.parse(value));
  }
  close() {
    this.closed++;
    this.readyState = 3;
  }
  event(value) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) }));
  }
}
function setup(input = body, options = {}) {
  const socket = new Socket();
  const result = runDeveloperRealtime(input, {
    apiKey: "fixture",
    connect: (url, headers) => {
      assert.equal(url, `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`);
      assert.deepEqual(headers, { Authorization: "Bearer fixture" });
      return socket;
    },
    ...options,
  });
  const start = () => {
    socket.event({ type: "session.created", session: { model: REALTIME_MODEL } });
    assert.equal(socket.sent[0].type, "session.update");
    socket.event({ type: "session.updated", session: socket.sent[0].session });
    assert.equal(socket.sent[1].type, "response.create");
    assert.equal(socket.sent[1].response.conversation, "none");
    socket.event({ type: "response.created", response: { id: receipt.id } });
  };
  return { socket, result, start };
}
test("Realtime validates exclusive bounded media and rejects arbitrary provider authority", () => {
  const audio = Buffer.alloc(4800).toString("base64");
  assert.equal(
    parseDeveloperInput("realtime", { ...body, model: "kova-realtime" }).capability,
    "realtime",
  );
  assert.equal(
    developerRealtimeFields({
      model: "kova-realtime",
      audio,
      output_modality: "audio",
      max_output_tokens: 1,
    }).audio,
    audio,
  );
  for (const input of [
    { ...body, audio },
    { ...body, input: "é".repeat(501) },
    { ...body, max_output_tokens: 513 },
    { ...body, api_key: "x" },
    { ...body, tools: [] },
    { ...body, input: undefined, audio: "AA==" },
  ])
    assert.throws(() => developerRealtimeFields(input), /realtime_invalid/);
});
test("Realtime receipts split cached modalities and reject absent, forged or inconsistent usage", () => {
  assert.deepEqual(
    developerRealtimeUsage(receipt),
    Object.fromEntries(REALTIME_DIMENSIONS.map((key, i) => [key, [15, 5, 8, 2, 5, 0][i]])),
  );
  for (const mutate of [
    (x) => delete x.usage.input_token_details.cached_tokens_details,
    (x) => x.usage.total_tokens++,
    (x) => (x.usage.input_token_details.image_tokens = 1),
    (x) => x.usage.output_token_details.audio_tokens++,
    (x) => (x.model = "foreign"),
    (x) => (x.id = "not-a-response"),
  ]) {
    const value = structuredClone(receipt);
    mutate(value);
    assert.equal(developerRealtimeUsage(value), null);
  }
});
test("native Realtime executes exactly one authorized text turn and closes the socket", async () => {
  const { socket, result, start } = setup();
  start();
  assert.deepEqual(socket.sent[1].response.input, [
    { type: "message", role: "user", content: [{ type: "input_text", text: "Hello" }] },
  ]);
  socket.event({ type: "response.output_text.delta", response_id: receipt.id, delta: "Hello" });
  socket.event({ type: "response.done", response: receipt });
  assert.equal((await (await result).json()).text, "Hello");
  assert.equal(socket.closed, 1);
  assert.equal(socket.sent.length, 2);
});
test("native Realtime validates audio and returns bounded PCM and transcript", async () => {
  const input = {
    model: REALTIME_MODEL,
    audio: Buffer.alloc(4800).toString("base64"),
    output_modality: "audio",
    max_output_tokens: 64,
  };
  const { socket, result, start } = setup(input);
  start();
  assert.equal(socket.sent[1].response.input[0].content[0].audio, input.audio);
  const audio = Buffer.from([1, 2, 3, 4]).toString("base64");
  socket.event({ type: "response.output_audio.delta", response_id: receipt.id, delta: audio });
  socket.event({
    type: "response.output_audio_transcript.delta",
    response_id: receipt.id,
    delta: "Hi",
  });
  const actual = structuredClone(receipt);
  actual.usage.output_token_details = { text_tokens: 0, audio_tokens: 5 };
  socket.event({ type: "response.done", response: actual });
  const data = await (await result).json();
  assert.equal(data.audio, audio);
  assert.equal(data.transcript, "Hi");
  assert.equal(data.sample_rate, 24000);
  assert.equal(socket.closed, 1);
});
test("cancel, premature close, malformed receipt and unexpected provider response never yield success", async () => {
  for (const mode of ["cancel", "close", "receipt", "foreign", "overrun", "session"]) {
    const controller = new AbortController();
    const { socket, result, start } = setup(body, { signal: controller.signal });
    const rejected = assert.rejects(result, /realtime_unavailable/);
    if (mode === "session")
      socket.event({ type: "session.created", session: { model: "foreign" } });
    else {
      start();
      if (mode === "cancel") controller.abort();
      else if (mode === "close") socket.dispatchEvent(new Event("close"));
      else if (mode === "receipt")
        socket.event({ type: "response.done", response: { ...receipt, usage: null } });
      else if (mode === "foreign")
        socket.event({ type: "response.output_text.delta", response_id: "resp_other", delta: "x" });
      else {
        const value = structuredClone(receipt);
        value.usage.output_tokens = 65;
        value.usage.output_token_details.text_tokens = 65;
        value.usage.total_tokens = 95;
        socket.event({ type: "response.done", response: value });
      }
    }
    await rejected;
    assert.equal(socket.closed, 1);
    if (mode === "cancel") assert.equal(socket.sent.at(-1).type, "response.cancel");
  }
});
test("meter reserves every approved Realtime dimension and settles only a genuine terminal receipt", async () => {
  const maximumUsage = Object.fromEntries(
    REALTIME_DIMENSIONS.map((key, i) => [key, [2048, 2048, 5000, 5000, 512, 512][i]]),
  );
  const config = {
    version: {
      id: "version",
      status: "approved",
      approved_by: "owner",
      approved_at: "2026-01-01",
      effective_at: "2026-01-01",
      expires_at: "2027-01-01",
      currency: "USD",
      margin_floor: 0.5,
      risk_buffer_percentage: 0.15,
      minimum_request_charge: 0.01,
      rounding_increment: 0.0001,
      allowance_configuration: {
        fixed: { compute: 0.01 },
        percentages: { fraud: 0.01 },
        collectionPercentage: 0.03,
        collectionFixed: 0.01,
      },
      public_price_configuration: {
        contracts: [
          {
            provider: "openai",
            upstreamModel: REALTIME_MODEL,
            publicModel: "kova-realtime",
            capability: "realtime",
            meter: "realtime_tokens",
            expectedResponseModels: [REALTIME_MODEL],
            maximumRequestBytes: 1048576,
            maximumUsage,
          },
        ],
      },
    },
    registry: REALTIME_DIMENSIONS.map((key) => ({
      provider: "openai",
      upstream_model: REALTIME_MODEL,
      billing_dimension: key,
      unit_quantity: 1000,
      unit_price: 1,
      currency: "USD",
      verification_status: "approved",
      effective_at: "2026-01-01",
      expires_at: "2027-01-01",
      active: true,
    })),
  };
  const request = { provider: "openai", capability: "realtime", body };
  const at = new Date("2026-11-27");
  const prepared = prepareDeveloperQuote(config, request, at);
  assert.deepEqual(prepared.options.usage.dimensions, maximumUsage);
  assert.throws(
    () => prepareDeveloperQuote({ ...config, registry: config.registry.slice(1) }, request, at),
    /upstream_price_missing/,
  );
  for (const [value, expected] of [
    [receipt, "settled"],
    [{ ...receipt, usage: null }, "uncertain"],
  ]) {
    const outcomes = [];
    const response = await runMeteredProvider({
      prepared,
      admit: async () => ({ decision: "admitted", request_id: "r", lease_token: "l" }),
      dispatch: async () => true,
      finish: async (_a, outcome, result) => outcomes.push({ outcome, result }),
      send: async () => Response.json(value),
    });
    await response.json();
    assert.equal(outcomes[0].outcome, expected);
    if (expected === "settled")
      assert.deepEqual(outcomes[0].result.usage, developerRealtimeUsage(receipt));
  }
});
