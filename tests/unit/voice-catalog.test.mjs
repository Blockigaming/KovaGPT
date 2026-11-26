import test from "node:test";
import assert from "node:assert/strict";
import {
  readVoiceCatalog,
  publicVoiceCatalog,
  selectCatalogVoice,
} from "../../src/lib/voice/catalog.server.mjs";
import {
  voiceConfiguration,
  publicVoiceConfiguration,
} from "../../src/lib/voice/elevenlabs.server.mjs";
import { createVoiceHandler } from "../../src/lib/voice/handler.server.mjs";
// Synthetic mappings are fixtures, not product defaults or owner choices.
const catalog = [
  {
    id: "jessica",
    label: "Fixture Basic",
    providerVoiceId: "providerFixtureA",
    allowedPlans: ["free", "plus", "pro"],
  },
  {
    id: "lauren",
    label: "Fixture Premium",
    providerVoiceId: "providerFixtureB",
    allowedPlans: ["plus", "pro"],
    showWhenLocked: true,
  },
  {
    id: "river",
    label: "Fixture Private",
    providerVoiceId: "providerFixtureC",
    allowedPlans: ["pro"],
  },
];
const vars = {
  KOVA_VOICE_ENABLED: "true",
  KOVA_VOICE_AUDIO_ENABLED: "true",
  ELEVENLABS_API_KEY: "fixture-only",
  KOVA_VOICE_DAILY_REQUEST_LIMIT: "3",
  KOVA_VOICE_CATALOG: JSON.stringify(catalog),
};
const env =
  (extra = {}) =>
  (key) =>
    ({ ...vars, ...extra })[key];
test("public catalog exposes only safe metadata and explicit visible locked options", () => {
  const free = readVoiceCatalog(env(), "free");
  assert.deepEqual(publicVoiceCatalog(free), [
    { id: "jessica", label: "Fixture Basic", available: true },
    { id: "lauren", label: "Fixture Premium", available: false },
  ]);
  const serialized = JSON.stringify(publicVoiceConfiguration(voiceConfiguration(env(), "free")));
  const capabilities = publicVoiceConfiguration(voiceConfiguration(env(), "free"));
  assert.equal(capabilities.tts, true);
  assert.equal(capabilities.sts, true);
  assert.ok(!serialized.includes("providerFixture"));
  assert.ok(!serialized.includes("fixture-only"));
  assert.ok(!serialized.includes("allowedPlans"));
});
test("Free Plus Pro enforce exact owner-configured plan lists", () => {
  for (const tier of ["free", "plus", "pro"]) {
    const value = readVoiceCatalog(env(), tier);
    assert.equal(selectCatalogVoice(value, "jessica").providerVoiceId, "providerFixtureA");
    assert.equal("providerVoiceId" in selectCatalogVoice(value, "lauren"), tier !== "free");
    assert.equal("providerVoiceId" in selectCatalogVoice(value, "river"), tier === "pro");
  }
  const nonhierarchical = readVoiceCatalog(
    env({ KOVA_VOICE_CATALOG: JSON.stringify([{ ...catalog[0], allowedPlans: ["free"] }]) }),
    "pro",
  );
  assert.equal(nonhierarchical.defaultVoiceId, null);
  assert.equal(selectCatalogVoice(nonhierarchical, "jessica").status, 403);
});
test("invalid catalog fails closed even with valid legacy provider voice", () => {
  for (const raw of [
    "",
    "broken",
    "[]",
    "{}",
    JSON.stringify([catalog[0], catalog[0]]),
    JSON.stringify([{ ...catalog[0], allowedPlans: ["enterprise"] }]),
    JSON.stringify([{ ...catalog[0], providerVoiceId: "../escape" }]),
    JSON.stringify([{ ...catalog[0], label: "x".repeat(81) }]),
    JSON.stringify([{ ...catalog[0], allowedPlans: [] }]),
    JSON.stringify([{ ...catalog[0], showWhenLocked: "yes" }]),
  ]) {
    const cfg = voiceConfiguration(
      env({ KOVA_VOICE_CATALOG: raw, ELEVENLABS_VOICE_ID: "LegacyFixture" }),
      "free",
    );
    assert.equal(cfg.configured, false);
    assert.deepEqual(publicVoiceConfiguration(cfg).voices, []);
  }
});
test("default prefers configured eligible entry, falls back only within eligible entries", () => {
  assert.equal(
    readVoiceCatalog(env({ KOVA_VOICE_DEFAULT_ID: "lauren" }), "free").defaultVoiceId,
    "jessica",
  );
  assert.equal(
    readVoiceCatalog(env({ KOVA_VOICE_DEFAULT_ID: "lauren" }), "plus").defaultVoiceId,
    "lauren",
  );
  assert.equal(readVoiceCatalog(env({ KOVA_VOICE_DEFAULT_ID: "absent" }), "pro").valid, false);
});
test("legacy singlevoice compatibility preserves existing access, absent config invents nothing", () => {
  for (const tier of ["free", "plus", "pro"])
    assert.equal(
      readVoiceCatalog(
        env({ KOVA_VOICE_CATALOG: undefined, ELEVENLABS_VOICE_ID: "LegacyFixture" }),
        tier,
      ).defaultVoiceId,
      "default",
    );
  assert.deepEqual(readVoiceCatalog(() => undefined, "free").entries, []);
  assert.equal(readVoiceCatalog(env(), "enterprise").valid, false);
});
test("arbitrary provider IDs and malformed selections cannot escape catalog", () => {
  const value = readVoiceCatalog(env(), "pro");
  for (const requested of ["providerFixtureB", "https://evil.invalid", "../premium", {}, null, ""])
    assert.ok("error" in selectCatalogVoice(value, requested));
});
function fixture(tier) {
  let charged = 0;
  let executed = [];
  const run = createVoiceHandler({
    requireUser: async () => ({ userId: "owner", emailVerified: true }),
    assertNotBanned: async () => null,
    assertFeatureEnabled: async () => null,
    getCallerTier: async () => tier,
    enforceQuota: async () => {
      charged++;
      return null;
    },
    env: env(),
    execute: async (input, cfg) => {
      executed.push(cfg.voiceId);
      return Response.json({ ok: true });
    },
  });
  return {
    run,
    get charged() {
      return charged;
    },
    get executed() {
      return executed;
    },
  };
}
const request = (voiceId, tier = "pro") =>
  new Request("https://kova.invalid/api/voice", {
    method: "POST",
    headers: {
      Origin: "https://kova.invalid",
      "Content-Type": "application/json",
      "X-Kova-Voice-Owner": "owner",
    },
    body: JSON.stringify({ action: "tts", text: "fixture", voiceId, tier }),
  });
test("handler uses verified tier, denies paidvoice before quota and ignores client claimed plan", async () => {
  const free = fixture("free");
  assert.equal((await free.run(request("lauren", "pro"))).status, 403);
  assert.equal(free.charged, 0);
  assert.deepEqual(free.executed, []);
  const plus = fixture("plus");
  const response = await plus.run(request("lauren", "free"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(plus.charged, 1);
  assert.deepEqual(plus.executed, ["providerFixtureB"]);
});
test("selection rechecked for every request including downgrade and stale IDs", async () => {
  const downgraded = fixture("free");
  assert.equal((await downgraded.run(request("river"))).status, 403);
  assert.equal((await downgraded.run(request("removed"))).status, 400);
  assert.equal(downgraded.charged, 0);
});
test("explicit model allowlist and legacy default are server owned", () => {
  for (const modelId of ["eleven_flash_v2_5", "eleven_multilingual_v2", "eleven_v4"]) {
    const value = readVoiceCatalog(
      env({ KOVA_VOICE_CATALOG: JSON.stringify([{ ...catalog[0], modelId }]) }),
      "free",
    );
    assert.equal(selectCatalogVoice(value, "jessica").modelId, modelId);
    assert.ok(!JSON.stringify(publicVoiceCatalog(value)).includes(modelId));
  }
  assert.equal(
    selectCatalogVoice(readVoiceCatalog(env(), "free"), "jessica").modelId,
    "eleven_multilingual_v2",
  );
  assert.equal(
    voiceConfiguration(env({ KOVA_VOICE_CATALOG: undefined, ELEVENLABS_VOICE_ID: "LegacyFixture" }))
      .modelId,
    "eleven_multilingual_v2",
  );
});
test("unsupported configured models fail before quota; client overrides cannot select model or provider", async () => {
  for (const modelId of ["eleven_v4_turbo", "eleven_v3", "arbitrary", null, {}, ""]) {
    let charged = 0;
    const run = createVoiceHandler({
      requireUser: async () => ({ userId: "owner", emailVerified: true }),
      assertNotBanned: async () => null,
      assertFeatureEnabled: async () => null,
      getCallerTier: async () => "free",
      enforceQuota: async () => {
        charged++;
        return null;
      },
      env: env({ KOVA_VOICE_CATALOG: JSON.stringify([{ ...catalog[0], modelId }]) }),
      execute: async () => {
        throw new Error("must not execute");
      },
    });
    assert.equal((await run(request("jessica"))).status, 503);
    assert.equal(charged, 0);
  }
  const events = [];
  const run = createVoiceHandler({
    requireUser: async () => ({ userId: "owner", emailVerified: true }),
    assertNotBanned: async () => null,
    assertFeatureEnabled: async () => null,
    getCallerTier: async () => "plus",
    enforceQuota: async () => {
      events.push("quota");
      return null;
    },
    env: env({
      KOVA_VOICE_CATALOG: JSON.stringify([
        catalog[0],
        { ...catalog[1], modelId: "eleven_flash_v2_5" },
      ]),
    }),
    execute: async (input, cfg) => {
      assert.equal(cfg.modelId, "eleven_flash_v2_5");
      assert.equal(cfg.voiceId, "providerFixtureB");
      assert.equal(input.modelId, undefined);
      events.push("execute");
      return Response.json({ ok: true });
    },
  });
  const req = request("lauren");
  const hostile = new Request(req, {
    body: JSON.stringify({
      action: "tts",
      text: "fixture",
      voiceId: "lauren",
      modelId: "eleven_v4",
      model_id: "evil",
      providerVoiceId: "evil",
    }),
  });
  assert.equal((await run(hostile)).status, 200);
  assert.deepEqual(events, ["quota", "execute"]);
});

test("plan rule: Free gets Jessica, Plus gets Jarnathan/Jessica/Lauren, Pro gets every voice", () => {
  const ids = ["jarnathan", "jessica", "lauren", "river", "sam"];
  const all = ids.map((id) => ({
    id,
    label: id,
    providerVoiceId: `fixture-${id}`,
    allowedPlans: ["free", "plus", "pro"],
    showWhenLocked: true,
  }));
  const withCatalog = env({ KOVA_VOICE_CATALOG: JSON.stringify(all) });
  const available = (tier) =>
    readVoiceCatalog(withCatalog, tier)
      .entries.filter((entry) => entry.available)
      .map((entry) => entry.id);
  assert.deepEqual(available("free"), ["jessica"]);
  assert.deepEqual(available("plus"), ["jarnathan", "jessica", "lauren"]);
  assert.deepEqual(available("pro"), ids);
  // The realtime flag no longer reshuffles access by catalog position.
  const realtime = env({
    KOVA_VOICE_CATALOG: JSON.stringify(all),
    KOVA_VOICE_REALTIME_ENABLED: "true",
  });
  assert.deepEqual(
    readVoiceCatalog(realtime, "free")
      .entries.filter((entry) => entry.available)
      .map((entry) => entry.id),
    ["jessica"],
  );
  // Locked voices stay visible but unavailable and cannot be selected.
  const free = readVoiceCatalog(withCatalog, "free");
  assert.equal(publicVoiceCatalog(free).filter((voice) => !voice.available).length, 4);
  assert.equal(selectCatalogVoice(free, "jarnathan").status, 403);
  assert.equal(readVoiceCatalog(withCatalog, "free").defaultVoiceId, "jessica");
});

test("an entry's own allowedPlans can narrow the plan rule but never widen it", () => {
  const widened = readVoiceCatalog(
    env({
      KOVA_VOICE_CATALOG: JSON.stringify([
        { id: "jessica", label: "J", providerVoiceId: "a", allowedPlans: ["pro"] },
        { id: "river", label: "R", providerVoiceId: "b", allowedPlans: ["free", "plus", "pro"] },
      ]),
    }),
    "free",
  );
  const byId = Object.fromEntries(widened.entries.map((entry) => [entry.id, entry.available]));
  assert.deepEqual(byId, { jessica: false, river: false });
  assert.equal(widened.defaultVoiceId, null);
});
