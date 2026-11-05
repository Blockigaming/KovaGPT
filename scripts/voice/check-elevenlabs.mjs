import { voiceConfiguration } from "../../src/lib/voice/elevenlabs.server.mjs";

/** Run inside the app environment. It prints configuration status, never credentials. */
export function voiceReadiness(env) {
  const read = (name) => env[name];
  const missing = ["ELEVENLABS_API_KEY", "KOVA_VOICE_DAILY_REQUEST_LIMIT"].filter(
    (name) => !read(name),
  );
  if (!read("ELEVENLABS_VOICE_ID") && !read("KOVA_VOICE_CATALOG")) missing.push("voice selection");
  const tiers = Object.fromEntries(
    ["free", "plus", "pro"].map((tier) => {
      const status = voiceConfiguration(read, tier);
      return [
        tier,
        {
          dictationConfigured: status.stt === true,
          speechConfigured: status.tts === true,
          conversationConfigured: status.conversation === true,
        },
      ];
    }),
  );
  return {
    provider: "ElevenLabs",
    secretPresent: Boolean(read("ELEVENLABS_API_KEY")),
    missing,
    tiers,
    liveProviderVerified: false,
  };
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const report = voiceReadiness(process.env);
  console.log(JSON.stringify(report, null, 2));
  if (report.missing.length || !report.tiers.free.dictationConfigured) process.exitCode = 1;
}
