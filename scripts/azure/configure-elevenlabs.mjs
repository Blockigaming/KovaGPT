import { execFileSync } from "node:child_process";
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const group = option("--resource-group"),
  voice = option("--voice-id"),
  uri = option("--key-vault-secret-uri");
const apply = args.includes("--apply");
const appName = "kovagpt-prod-web";
if (
  !group ||
  !/^[a-zA-Z0-9_.()-]{1,90}$/.test(group) ||
  !voice ||
  !/^[a-zA-Z0-9_-]{1,128}$/.test(voice) ||
  !uri ||
  !/^https:\/\/[a-zA-Z0-9-]+\.vault\.azure\.net\/secrets\/[a-zA-Z0-9-]+\/[a-fA-F0-9]{32}$/.test(uri)
) {
  throw new Error(
    "Provide --resource-group, your accessible --voice-id and an existing versioned --key-vault-secret-uri. Never pass a raw API key.",
  );
}
const run = (command) =>
  execFileSync("az", command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
try {
  const app = JSON.parse(
    run(["containerapp", "show", "--name", appName, "--resource-group", group, "--output", "json"]),
  );
  const container = app.properties?.template?.containers?.find((row) => row.name === "web");
  if (!container) throw new Error("The existing web container was not found.");
  const env = Object.fromEntries((container.env || []).map((entry) => [entry.name, entry]));
  const cap = Number(env.KOVA_VOICE_DAILY_REQUEST_LIMIT?.value);
  if (!Number.isSafeInteger(cap) || cap < 1)
    throw new Error(
      "Configure an explicit positive daily voice request cap first. This script never selects or raises it.",
    );
  if (!env.KOVA_VOICE_MODEL_PROOF_SECRET?.secretRef || !env.KOVA_VOICE_OPENAI_MODELS_JSON?.value)
    throw new Error(
      "Preserve/configure the existing voice model policy and signing-secret reference before enabling spoken replies.",
    );
  if (env.KOVA_GENERATION_DISABLED?.value === "true")
    throw new Error("Generation is disabled. Keep its separate rollout gate intact.");
  const ids = Object.keys(app.identity?.userAssignedIdentities || {});
  const identity = String(app.identity?.type || "").includes("SystemAssigned")
    ? "system"
    : ids.length === 1
      ? ids[0]
      : null;
  if (!identity)
    throw new Error(
      "An unambiguous existing managed identity is required. No identity or access is created by this script.",
    );
  console.log(
    JSON.stringify(
      {
        app: appName,
        mode: apply ? "apply" : "review",
        provider: "ElevenLabs",
        preservedDailyRequestCap: cap,
        credentialSource: "existing versioned Azure Key Vault secret",
        liveProviderVerified: false,
      },
      null,
      2,
    ),
  );
  if (apply) {
    run([
      "containerapp",
      "secret",
      "set",
      "--name",
      appName,
      "--resource-group",
      group,
      "--secrets",
      `elevenlabs-api-key=keyvaultref:${uri},identityref:${identity}`,
      "--output",
      "none",
    ]);
    run([
      "containerapp",
      "update",
      "--name",
      appName,
      "--resource-group",
      group,
      "--set-env-vars",
      "ELEVENLABS_API_KEY=secretref:elevenlabs-api-key",
      `ELEVENLABS_VOICE_ID=${voice}`,
      "KOVA_VOICE_ENABLED=true",
      "KOVA_VOICE_AUDIO_ENABLED=true",
      "KOVA_SPEECH_ENABLED=true",
      "--output",
      "none",
    ]);
    console.log(
      "Voice references updated. Verify the resulting revision, signed-in /api/voice status, microphone transcription and saved-reply playback before declaring voice live.",
    );
  }
} catch {
  // Azure subprocess output and parse errors may contain configuration.
  console.error(
    "Voice setup could not complete. Check Azure sign-in, the existing web container, daily cap, model-signing policy and managed-identity Key Vault access.",
  );
  process.exitCode = 1;
}
