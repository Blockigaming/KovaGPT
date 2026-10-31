import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

function readRouteTree(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return readRouteTree(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [readFileSync(path, "utf8")] : [];
  });
}

const registry = read("src/lib/capability-registry.ts");
const modes = read("src/routes/modes.tsx");
const pricing = read("src/routes/pricing.tsx");
const helpRoute = read("src/routes/help.tsx");
const helpData = read("src/lib/help-center-data.ts");
const help = [helpRoute, helpData].join("\n");
const aiWriter = read("src/routes/ai-writer.tsx");
const publicRoutes = [modes, pricing, help].join("\n");
const publishedSources = [registry, publicRoutes, aiWriter].join("\n");
const allRouteCopy = readRouteTree(resolve(root, "src/routes")).join("\n");

test("Modes, Pricing, and Help consume one typed capability registry", () => {
  for (const source of [modes, pricing, helpData]) {
    assert.match(source, /import \{ CAPABILITY_REGISTRY \} from "@\/lib\/capability-registry"/);
  }

  assert.match(registry, /satisfies CapabilityRegistry/);
  assert.match(registry, /MODES/);
  assert.match(registry, /modesForTier/);
  assert.match(registry, /DAILY_CHAT_LIMIT_BY_TIER/);
  assert.match(registry, /DAILY_IMAGE_LIMIT_BY_TIER/);
  assert.match(registry, /DAILY_UPLOAD_LIMIT_BY_TIER/);
  assert.match(registry, /STORAGE_LIMITS_BYTES/);
  assert.match(registry, /BILLING_PLANS\.plus_monthly\.trialPeriodDays/);
});

test("published mode and plan copy is derived from enforced source data", () => {
  assert.match(modes, /CAPABILITY_REGISTRY\.modes\.map/);
  assert.match(modes, /CAPABILITY_REGISTRY\.modesByTier\[tier\]/);
  assert.match(pricing, /features=\{CAPABILITY_REGISTRY\.plans\.free\.features\}/);
  assert.match(pricing, /features=\{CAPABILITY_REGISTRY\.plans\.plus\.features\}/);
  assert.match(pricing, /features=\{CAPABILITY_REGISTRY\.plans\.pro\.features\}/);
  for (const tier of ["free", "plus", "pro"]) {
    assert.ok(
      pricing.includes(`price={displayPrice(CAPABILITY_REGISTRY.plans.${tier}.monthlyPriceUsd)}`),
    );
  }
  const plans = read("src/lib/billing-plans.ts");
  for (const tier of ["plus", "pro"]) {
    assert.match(plans, new RegExp(`${tier}_monthly: \\{[^}]*trialPeriodDays: 0`));
  }
  assert.doesNotMatch(pricing, /trialPeriodDays|Start (?:your )?free trial/i);
  const params = read("src/lib/billing-policy-params.ts");
  const policy = read("src/lib/billing-policy.mjs");
  assert.match(params, /line_items: \[\{ price: input\.priceId, quantity: 1 \}\]/);
  assert.doesNotMatch(params, /trial_period_days:|trial_end:|price_data:/);
  assert.match(policy, /price\.id !== plan\.livePriceId/);
  assert.match(policy, /price\.lookup_key !== plan\.lookupKey/);
  assert.match(pricing, /introductoryOfferForTier\("plus"\)/);
  assert.match(pricing, /introductoryOfferForTier\("pro"\)/);
  assert.match(read("src/lib/introductory-offer.ts"), /CAPABILITY_REGISTRY\.plans\[tier\]/);
  assert.doesNotMatch(pricing, /30-day trial for eligible first-time subscribers/);
});

test("retired modes and unsupported product promises stay off public routes", () => {
  const forbiddenClaims = [
    /\bBasic Mode\b/i,
    /\bAuto Mode\b/i,
    /\bCreative Mode\b/i,
    /\bPrecise Mode\b/i,
    /\bCode Mode\b/i,
    /\bReasoning Mode\b/i,
    /\bResearch Mode\b/i,
    /\bWriter Pro\b/i,
    /\bTutor Pro\b/i,
    /Faster response times/i,
    /Priority access during peak hours/i,
    /Longer context for big documents/i,
    /SAML SSO/i,
    /audit logs/i,
    /Library holds every conversation/i,
    /upgrading to Plus removes it/i,
    /Native 2FA for email accounts is on our roadmap/i,
    /Notion/i,
    /Slack/i,
    /Linear/i,
    /AES-256/i,
    /never used to train models/i,
    /prorate automatically/i,
    /Maximum reasoning, context/i,
    /Maximum-depth reasoning/i,
    /Deepest reasoning/i,
  ];

  for (const claim of forbiddenClaims) {
    assert.doesNotMatch(publishedSources, claim);
  }
});

test("known limitations and required provider-dependent Voice remain explicit", () => {
  assert.match(registry, /voiceScope: "required_provider_dependent"/);
  assert.match(registry, /voice:[\s\S]*availability: "provider-dependent"/);
  assert.match(registry, /Microphone conversations require explicit Start and Finish turn/);
  assert.match(registry, /extracts readable text from supported PDF, DOCX, XLSX, and PPTX files/);
  assert.match(registry, /Library original PDF preview is separate from extracted text/);
  assert.match(registry, /Office originals can be downloaded but are not rendered/);
  assert.doesNotMatch(registry, /extraction is not currently supported/);
  assert.match(registry, /Edit a Library image with a supported configured image model/);
  assert.match(
    registry,
    /Signed-in ordinary chats synchronize with your account when chat sync is available/,
  );
  assert.match(
    registry,
    /Offline edits stay on this device until acknowledged; Temporary Chat stays out of history/,
  );
  assert.match(
    registry,
    /Background scheduled execution is unavailable until an approved scheduler and fresh heartbeat/,
  );
  assert.match(
    registry,
    /Transcription, speech synthesis, voice conversion, and saved-response Read aloud depend on configured voice access/u,
  );
  assert.match(
    registry,
    /Provider access, commercial entitlement, browser permission, and actual playback/u,
  );
  assert.doesNotMatch(aiWriter, /voice notes|audio notes|microphone input|audio upload/i);
  for (const unsupportedAudioClaim of [
    /turn .{0,40}\bvoice notes\b into/i,
    /upload (?:an? )?audio/i,
    /use (?:your|the) microphone/i,
    /record (?:a |your )?(?:voice|audio)/i,
    /speak (?:to|with) KovaGPT/i,
    /speech[- ]to[- ]text/i,
    /transcrib(?:e|es|ing) .{0,30}(?:voice|audio|recording)/i,
  ]) {
    assert.doesNotMatch(allRouteCopy, unsupportedAudioClaim);
  }
});

test("Help answers for high-risk capabilities come from the registry", () => {
  assert.match(help, /features\.attachments\.summary/);
  assert.match(help, /features\.dataAnalysis\.limitation/);
  assert.match(help, /features\.imageEditing\.summary/);
  assert.match(help, /features\.library\.summary/);
  assert.match(help, /features\.cloudHistory\.summary/);
  assert.match(help, /features\.scheduledTasks\.summary/);
  assert.match(help, /CAPABILITY_REGISTRY\.workingApps\.join/);
});
