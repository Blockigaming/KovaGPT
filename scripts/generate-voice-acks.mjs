#!/usr/bin/env node
// Owner-run: pre-generates the acknowledgment clips for every configured voice.
//   ELEVENLABS_API_KEY=... KOVA_VOICE_CATALOG='[...]' node scripts/generate-voice-acks.mjs
// Output: public/voice-acks/<catalogVoiceId>/<clip>.mp3 and manifest.json.
// Uses Flash v2.5 (or KOVA_ACK_TTS_MODEL) so generation cost is trivial; run it
// again only if a voice or a phrase changes.
import { mkdir, writeFile } from "node:fs/promises";
import { ACK_KINDS } from "../src/lib/voice/acknowledgments.mjs";
import { readVoiceCatalog } from "../src/lib/voice/catalog.server.mjs";

const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ELEVENLABS_API_KEY is required");
const env = (name) => process.env[name];
const catalog = readVoiceCatalog(env, "pro");
if (!catalog.valid) throw new Error("KOVA_VOICE_CATALOG is missing or invalid");
const model = process.env.KOVA_ACK_TTS_MODEL ?? "eleven_flash_v2_5";
const manifest = {};
for (const voice of catalog.entries) {
  manifest[voice.id] = {};
  await mkdir(`public/voice-acks/${voice.id}`, { recursive: true });
  for (const entry of Object.values(ACK_KINDS)) {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.providerVoiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text: entry.text, model_id: model }),
      },
    );
    if (!response.ok)
      throw new Error(`${voice.id}/${entry.id}: provider status ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    await writeFile(`public/voice-acks/${voice.id}/${entry.id}.mp3`, bytes);
    // 128 kbps MP3: 16000 bytes per second.
    manifest[voice.id][entry.id] = {
      bytes: bytes.byteLength,
      durationMs: Math.round((bytes.byteLength / 16000) * 1000),
    };
    console.log(`${voice.id}/${entry.id}: ${bytes.byteLength} bytes`);
  }
}
await writeFile("public/voice-acks/manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
