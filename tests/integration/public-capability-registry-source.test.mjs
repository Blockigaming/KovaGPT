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
const help = read("src/routes/help.tsx");
const aiWriter = read("src/routes/ai-writer.tsx");
const publicRoutes = [modes, pricing, help].join("\n");
const publishedSources = [registry, publicRoutes, aiWriter].join("\n");
const allRouteCopy = readRouteTree(resolve(root, "src/routes")).join("\n");

test("Modes, Pricing, and Help consume one typed capability registry", () => {
  for (const source of [modes, pricing, help]) {
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
  assert.match(pricing, /CAPABILITY_REGISTRY\.plans\.plus\.trialPeriodDays/);
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

test("known limitations and voice exclusion remain explicit", () => {
  assert.match(registry, /voiceScope: "excluded"/);
  assert.match(registry, /availability: "excluded"/);
  assert.match(registry, /PDF, Word, PowerPoint, and Excel extraction is not currently supported/);
  assert.match(registry, /Editing an uploaded or generated image is not currently available/);
  assert.match(
    registry,
    /Signed-in ordinary chats synchronize with your account when chat sync is available/,
  );
  assert.match(
    registry,
    /Offline edits stay on this device until acknowledged; Temporary Chat stays out of history/,
  );
  assert.match(registry, /Background scheduled execution is unavailable in this deployment/);
  assert.match(registry, /Voice is intentionally outside KovaGPT's current product scope/);
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
  assert.match(help, /FEATURES\.attachments\.summary/);
  assert.match(help, /FEATURES\.dataAnalysis\.limitation/);
  assert.match(help, /FEATURES\.imageEditing\.summary/);
  assert.match(help, /FEATURES\.library\.summary/);
  assert.match(help, /FEATURES\.cloudHistory\.summary/);
  assert.match(help, /FEATURES\.scheduledTasks\.summary/);
  assert.match(help, /CAPABILITY_REGISTRY\.workingApps\.join/);
});
