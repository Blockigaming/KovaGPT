import assert from "node:assert/strict";
import test from "node:test";
import {
  TRANSLATION_MODEL,
  TRANSLATION_ACCOUNTING,
  developerTranslationFields,
  developerTranslationReceipt,
  developerTranslationSeconds,
  runDeveloperTranslation,
} from "../../src/lib/pricing/developer-translation-policy.mjs";
import { parseDeveloperInput } from "../../src/lib/pricing/developer-platform-policy.mjs";
import {
  prepareDeveloperQuote,
  runMeteredProvider,
} from "../../src/lib/pricing/developer-metering.mjs";
const body = {
  model: TRANSLATION_MODEL,
  audio: Buffer.alloc(19200).toString("base64"),
  target_language: "es",
};
const receipt = {
  model: TRANSLATION_MODEL,
  id: "sess_test",
  status: "completed",
  usage: { translation_seconds: 0.4, accounting: TRANSLATION_ACCOUNTING },
};
class Socket extends EventTarget {
  readyState = 1;
  sent = [];
  closed = 0;
  sequence = 0;
  send(value) {
    this.sent.push(JSON.parse(value));
  }
  close() {
    this.closed++;
    this.readyState = 3;
  }
  event(value) {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ event_id: `e_${++this.sequence}`, ...value }),
      }),
    );
  }
}
function setup(options = {}) {
  const socket = new Socket();
  const result = runDeveloperTranslation(body, {
    apiKey: "fixture",
    connect: (url, headers) => {
      assert.equal(url, `wss://api.openai.com/v1/realtime/translations?model=${TRANSLATION_MODEL}`);
      assert.deepEqual(headers, { Authorization: "Bearer fixture" });
      return socket;
    },
    ...options,
  });
  const session = { model: TRANSLATION_MODEL, id: "sess_test", type: "translation" };
  const start = () => {
    socket.event({ type: "session.created", session });
    assert.deepEqual(socket.sent[0], {
      type: "session.update",
      session: {
        audio: {
          input: { transcription: null, noise_reduction: null },
          output: { language: "es" },
        },
      },
    });
    socket.event({ type: "session.updated", session: { ...session, ...socket.sent[0].session } });
  };
  return { socket, result, start, session };
}
test("native audio translation admits only exact bounded PCM frames and target language", () => {
  assert.equal(
    parseDeveloperInput("audio/translations", { ...body, model: "kova-translate" }).capability,
    "audio_translation",
  );
  assert.equal(developerTranslationSeconds(body), 0.4);
  for (const bad of [
    { ...body, target_language: "xx" },
    { ...body, api_key: "x" },
    { ...body, audio: "AA==" },
    { ...body, audio: Buffer.alloc(9602).toString("base64") },
    { ...body, audio: Buffer.alloc(489600).toString("base64") },
  ])
    assert.throws(() => developerTranslationFields(bad), /translation_invalid/);
});
test("native translation sends only authorized frames and settles after graceful close", async () => {
  const { socket, result, start } = setup();
  start();
  assert.deepEqual(socket.sent.slice(1), [
    { type: "session.input_audio_buffer.append", audio: Buffer.alloc(9600).toString("base64") },
    { type: "session.input_audio_buffer.append", audio: Buffer.alloc(9600).toString("base64") },
    { type: "session.close" },
  ]);
  socket.event({ type: "session.output_transcript.delta", delta: "Hola" });
  socket.event({ type: "session.output_audio.delta", delta: "AQIDBA==" });
  socket.event({ type: "session.closed" });
  const value = await (await result).json();
  assert.equal(value.text, "Hola");
  assert.equal(value.audio, "AQIDBA==");
  assert.deepEqual(developerTranslationReceipt(value), { translation_seconds: 0.4 });
  assert.equal(socket.closed, 1);
});
test("native translation never returns success on cancellation, malformed provider events or interrupted close", async () => {
  for (const mode of [
    "cancel",
    "close",
    "bad-audio",
    "duplicate",
    "foreign",
    "wrong-language",
    "timeout",
  ]) {
    const controller = new AbortController();
    const { socket, result, start, session } = setup({
      signal: controller.signal,
      ...(mode === "timeout" ? { timeoutMs: 10 } : {}),
    });
    const rejected = assert.rejects(result, /translation_unavailable/);
    if (mode === "foreign")
      socket.event({ type: "session.created", session: { ...session, model: "other" } });
    else if (mode === "wrong-language") {
      socket.event({ type: "session.created", session });
      socket.event({
        type: "session.updated",
        session: { ...session, audio: { output: { language: "en" } } },
      });
    } else {
      start();
      if (mode === "cancel") controller.abort();
      else if (mode === "close") socket.dispatchEvent(new Event("close"));
      else if (mode === "bad-audio")
        socket.event({ type: "session.output_audio.delta", delta: "AA==" });
      else if (mode === "duplicate")
        socket.event({ type: "session.output_transcript.delta", event_id: "e_1", delta: "x" });
      else await new Promise((resolve) => setTimeout(resolve, 30));
    }
    await rejected;
    assert.equal(socket.closed, 1);
  }
});
test("translation billing reserves exact audio duration only under approved accounting basis", async () => {
  const maximumUsage = { translation_seconds: 10 };
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
            upstreamModel: TRANSLATION_MODEL,
            publicModel: "kova-translate",
            capability: "audio_translation",
            meter: "translation_duration",
            translationAccounting: TRANSLATION_ACCOUNTING,
            expectedResponseModels: [TRANSLATION_MODEL],
            maximumRequestBytes: 1048576,
            maximumUsage,
          },
        ],
      },
    },
    registry: ["translation_seconds"].map((key) => ({
      provider: "openai",
      upstream_model: TRANSLATION_MODEL,
      billing_dimension: key,
      unit_quantity: 60,
      unit_price: 1,
      currency: "USD",
      verification_status: "approved",
      effective_at: "2026-01-01",
      expires_at: "2027-01-01",
      active: true,
    })),
  };
  const request = { provider: "openai", capability: "audio_translation", body };
  const at = new Date("2026-11-27");
  const prepared = prepareDeveloperQuote(config, request, at);
  assert.deepEqual(prepared.options.usage.dimensions, { translation_seconds: 0.4 });
  const wrong = structuredClone(config);
  delete wrong.version.public_price_configuration.contracts[0].translationAccounting;
  assert.throws(() => prepareDeveloperQuote(wrong, request, at), /translation_contract_invalid/);
  for (const [value, expected] of [
    [receipt, "settled"],
    [{ ...receipt, usage: null }, "uncertain"],
    [{ ...receipt, usage: { ...receipt.usage, translation_seconds: 0.6 } }, "uncertain"],
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
      assert.deepEqual(outcomes[0].result.usage, { translation_seconds: 0.4 });
  }
});
