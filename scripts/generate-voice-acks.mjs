#!/usr/bin/env node
// Owner-run only. Without --generate, print the exact work/character budget.
// --generate requires an explicit maximum and an existing ElevenLabs key.
// Existing clips with matching provenance are reused; legacy or missing clips
// are regenerated so their provider and selected-voice identity are recorded.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ACK_VARIANTS } from "../src/lib/voice/acknowledgments.mjs";
import { readVoiceCatalog, TTS_MODEL_IDS, STREAM_TTS_MODEL_IDS } from "../src/lib/voice/catalog.server.mjs";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--generate")) throw new Error("Unknown argument");
const generate = args.includes("--generate");
const env = (name) => process.env[name];
const catalog = readVoiceCatalog(env, "pro");
if (!catalog.valid || !catalog.entries.length) throw new Error("Voice catalog is missing or invalid");
const model = process.env.KOVA_ACK_TTS_MODEL ?? "eleven_flash_v2_5";
if (![...TTS_MODEL_IDS, ...STREAM_TTS_MODEL_IDS].includes(model))
  throw new Error("Invalid ElevenLabs model");
const root = "public/voice-acks";
const manifestPath = root + "/manifest.json";
const readOptional = async (path) => {
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const previous = await readOptional(manifestPath);
const manifest = previous ? JSON.parse(previous.toString("utf8")) : {};
const plan = [];
for (const voice of catalog.entries) {
  manifest[voice.id] ??= {};
  for (const entry of Object.values(ACK_VARIANTS).flat()) {
    const path = root + "/" + voice.id + "/" + entry.id + ".mp3";
    const bytes = await readOptional(path);
    const meta = manifest[voice.id][entry.id];
    const voiceFingerprint = hash(voice.providerVoiceId);
    if (
      bytes && bytes.byteLength > 0 && bytes.byteLength <= 256 * 1024 &&
      meta?.provider === "elevenlabs" && meta.modelId === model &&
      meta.voiceFingerprint === voiceFingerprint && meta.text === entry.text &&
      meta.bytes === bytes.byteLength && meta.sha256 === hash(bytes)
    ) continue;
    plan.push({ voice, entry, path, voiceFingerprint });
  }
}
const characters = plan.reduce((sum, { entry }) => sum + entry.text.length, 0);
console.log(JSON.stringify({ provider: "elevenlabs", model, clipsToGenerate: plan.length, characters, generate }));
if (!generate) process.exit(0);
if (!plan.length) process.exit(0);
const maximum = Number(process.env.KOVA_ACK_GENERATION_MAX_CHARACTERS);
if (!Number.isSafeInteger(maximum) || maximum <= 0 || characters > maximum)
  throw new Error("Generation exceeds explicit character budget; run the preview first");
const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ELEVENLABS_API_KEY is required");
for (const { voice, entry, path, voiceFingerprint } of plan) {
  const response = await fetch(
    "https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(voice.providerVoiceId) + "?output_format=mp3_44100_128",
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: entry.text, model_id: model }),
      redirect: "error",
      signal: AbortSignal.timeout(45000),
    },
  );
  if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "audio/mpeg")
    throw new Error(voice.id + "/" + entry.id + ": invalid provider response " + response.status);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing audio response");
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 256 * 1024) throw new Error("Oversized acknowledgment");
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (!total) throw new Error("Empty acknowledgment");
  const bytes = Buffer.concat(chunks);
  await mkdir(root + "/" + voice.id, { recursive: true });
  await writeFile(path, bytes);
  manifest[voice.id][entry.id] = {
    bytes: bytes.byteLength,
    durationMs: Math.round(bytes.byteLength / 16000 * 1000),
    provider: "elevenlabs",
    modelId: model,
    voiceFingerprint,
    text: entry.text,
    sha256: hash(bytes),
  };
  // Checkpoint completed assets; restarting never repeats a verified clip.
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(voice.id + "/" + entry.id + ": " + bytes.byteLength + " bytes");
}
