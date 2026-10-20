import assert from "node:assert/strict";
import test from "node:test";
import {
  providerMetadataConfiguration,
  inspectProviderMetadata,
  main,
} from "../../scripts/azure/provider-metadata-preflight.mjs";

const env = {
  KOVA_PROVIDER_METADATA_INSPECTION_ENABLED: "true",
  AZURE_ENVIRONMENT: "staging",
  KOVA_DEPLOYMENT_TARGET: "ca-kovagpt-staging",
  OPENAI_API_KEY: "synthetic-openai-private",
  ELEVENLABS_API_KEY: "synthetic-elevenlabs-private",
  ELEVENLABS_VOICE_ID: "selectedFixtureVoice",
};
const payloads = () => [
  { object: "model", id: "gpt-5.6-luna", owned_by: "private-account-owner" },
  {
    voice_id: env.ELEVENLABS_VOICE_ID,
    name: "private-voice-name",
    sharing: { whitelisted_emails: ["private@example.test"] },
  },
  [
    {
      model_id: "eleven_multilingual_v2",
      can_do_text_to_speech: true,
      privateField: "private-provider-detail",
    },
  ],
  {
    status: "active",
    character_count: 10,
    character_limit: 1000,
    max_credit_limit_extension: 0,
    open_invoices: [{ amount_due_cents: 12345 }],
  },
];
const json = (value) =>
  new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
function fixtureFetcher(values = payloads()) {
  const calls = [];
  return {
    calls,
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return values[calls.length - 1] instanceof Response
        ? values[calls.length - 1]
        : json(values[calls.length - 1]);
    },
  };
}

test("default invocation neither reads credentials nor contacts any provider", async () => {
  let reads = 0,
    requests = 0;
  const value = await main(
    [],
    new Proxy(
      {},
      {
        get() {
          reads++;
          throw Error("must not read credentials");
        },
      },
    ),
    {
      fetcher() {
        requests++;
      },
    },
  );
  assert.equal(value.inspectionEnabled, false);
  assert.equal(reads, 0);
  assert.equal(requests, 0);
});

test("inspection requires explicit staging scope, existing private credentials and selected voice", () => {
  for (const patch of [
    { KOVA_PROVIDER_METADATA_INSPECTION_ENABLED: "false" },
    { AZURE_ENVIRONMENT: "production" },
    { KOVA_DEPLOYMENT_TARGET: "kovagpt-prod-web" },
    { OPENAI_API_KEY: "missing" },
    { ELEVENLABS_API_KEY: "private\r\ninvalid-credential" },
    { ELEVENLABS_VOICE_ID: "../unsafe?voice" },
  ])
    assert.throws(
      () => providerMetadataConfiguration({ ...env, ...patch }),
      /^Error: provider_metadata_/u,
    );
});

test("only four allowlisted GET requests occur and metadata success never becomes live qualification", async () => {
  const f = fixtureFetcher();
  const report = await inspectProviderMetadata(providerMetadataConfiguration(env), {
    fetcher: f.fetcher,
    now: () => Date.UTC(2026, 9, 20),
  });
  assert.deepEqual(
    f.calls.map((call) => call.url),
    [
      "https://api.openai.com/v1/models/gpt-5.6-luna",
      `https://api.elevenlabs.io/v1/voices/${env.ELEVENLABS_VOICE_ID}`,
      "https://api.elevenlabs.io/v1/models",
      "https://api.elevenlabs.io/v1/user/subscription",
    ],
  );
  for (const { init } of f.calls) {
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(init.body, undefined);
    assert.ok(init.signal instanceof AbortSignal);
  }
  assert.ok(f.calls[0].init.headers.Authorization);
  assert.equal(f.calls[0].init.headers["xi-api-key"], undefined);
  assert.equal(f.calls[1].init.headers.Authorization, undefined);
  assert.ok(f.calls[1].init.headers["xi-api-key"]);
  assert.equal(report.requestCount, 4);
  assert.equal(report.generationRequests, 0);
  assert.equal(report.openAI.modelMetadataMatches, true);
  assert.equal(report.elevenLabs.models.textToSpeechModelListed, true);
  assert.equal(report.elevenLabs.subscription.positiveCreditHeadroom, true);
  assert.equal(report.elevenLabs.subscription.overageMode, "disabled");
  for (const key of [
    "generationUsabilityVerified",
    "textToSpeechKeyPermissionVerified",
    "accountPricingVerified",
    "exactTokenCountVerified",
    "aggregateCostBoundVerified",
    "shutdownVerified",
    "executionAuthorityGranted",
  ])
    assert.equal(report[key], false);
  assert.match(report.reportSha256, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(
    JSON.stringify(report),
    /private-account-owner|private-voice-name|private@example|private-provider-detail|12345|synthetic-openai|synthetic-elevenlabs|selectedFixtureVoice/u,
  );
});

test("provider error bodies and thrown errors are reduced to redacted statuses without retries", async () => {
  const f = fixtureFetcher([
    new Response("private-api-key-fragment private@example.test", { status: 403 }),
    new Response("private-error-body", { status: 404 }),
    new Response("private-error-body", { status: 429 }),
    new Response("private-error-body", { status: 500 }),
  ]);
  const report = await inspectProviderMetadata(providerMetadataConfiguration(env), {
    fetcher: f.fetcher,
  });
  assert.equal(report.openAI.status, "authorization_denied");
  assert.equal(report.elevenLabs.voice.status, "not_found");
  assert.equal(report.elevenLabs.models.status, "rate_limited");
  assert.equal(report.elevenLabs.subscription.status, "provider_unavailable");
  assert.equal(f.calls.length, 4);
  assert.doesNotMatch(JSON.stringify(report), /private-/u);
  let calls = 0;
  const thrown = await inspectProviderMetadata(providerMetadataConfiguration(env), {
    fetcher: async () => {
      calls++;
      throw Error(env.OPENAI_API_KEY);
    },
  });
  assert.equal(calls, 4);
  assert.doesNotMatch(JSON.stringify(thrown), /synthetic-openai/u);
});

test("malformed, oversized and mismatched metadata cannot report the intended model or voice", async () => {
  const f = fixtureFetcher([
    { object: "model", id: "another-model" },
    { voice_id: "anotherVoice" },
    new Response("{".repeat(131073), { headers: { "Content-Type": "application/json" } }),
    {
      status: "active",
      character_count: -1,
      character_limit: "1000",
      max_credit_limit_extension: "unlimited",
    },
  ]);
  const report = await inspectProviderMetadata(providerMetadataConfiguration(env), {
    fetcher: f.fetcher,
  });
  assert.equal(report.openAI.modelMetadataMatches, false);
  assert.equal(report.elevenLabs.voice.selectedVoiceMetadataMatches, false);
  assert.equal(report.elevenLabs.models.textToSpeechModelListed, false);
  assert.equal(report.elevenLabs.subscription.positiveCreditHeadroom, null);
  assert.equal(report.elevenLabs.subscription.overageMode, "unlimited");
});

test("redirected metadata is rejected and a hanging transport is bounded without retries", async () => {
  const redirected = json(payloads()[0]);
  Object.defineProperty(redirected, "redirected", { value: true });
  const f = fixtureFetcher([redirected, ...payloads().slice(1)]);
  const report = await inspectProviderMetadata(providerMetadataConfiguration(env), {
    fetcher: f.fetcher,
  });
  assert.equal(report.openAI.status, "redirect_rejected");
  let calls = 0;
  // Keep the test process alive while unref'd native timeout signals fire.
  const keeper = setInterval(() => {}, 100);
  try {
    const timed = await inspectProviderMetadata(providerMetadataConfiguration(env), {
      timeoutMs: 10,
      fetcher: () => {
        calls++;
        return new Promise(() => {});
      },
    });
    assert.equal(calls, 4);
    assert.equal(timed.openAI.status, "timed_out");
    assert.equal(timed.elevenLabs.subscription.status, "timed_out");
  } finally {
    clearInterval(keeper);
  }
});
