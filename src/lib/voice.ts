// Browser-native TTS and STT helpers (Web Speech API)

// Preferred voices for clarity. Natural/Neural voices first - they sound
// much more like the actual text. Adam-like deep male English fallbacks.
const PREFERRED_VOICES = [
  // Highest-quality "natural" / "neural" voices first
  "Microsoft Guy Online (Natural) - English (United States)",
  "Microsoft Davis Online (Natural) - English (United States)",
  "Microsoft Andrew Online (Natural) - English (United States)",
  "Microsoft Brian Online (Natural) - English (United States)",
  "Microsoft Ryan Online (Natural) - English (United Kingdom)",
  "Google US English",
  "Google UK English Male",
  // macOS / iOS premium voices
  "Daniel",
  "Alex",
  // Generic fallbacks
  "Microsoft Guy",
  "Microsoft Davis",
  "Microsoft Ryan",
];


let cachedVoices: SpeechSynthesisVoice[] = [];

export function getVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  const v = window.speechSynthesis.getVoices();
  if (v.length) cachedVoices = v;
  return cachedVoices;
}

export function onVoicesChanged(cb: () => void) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return () => {};
  const handler = () => {
    cachedVoices = window.speechSynthesis.getVoices();
    cb();
  };
  window.speechSynthesis.addEventListener?.("voiceschanged", handler);
  // Kick once in case voices already loaded
  if (window.speechSynthesis.getVoices().length) handler();
  return () => window.speechSynthesis.removeEventListener?.("voiceschanged", handler);
}

const LANG_LABELS: Record<string, string> = {
  "en-us": "American",
  "en-gb": "British",
  "en-au": "Australian",
  "en-ca": "Canadian",
  "en-ie": "Irish",
  "en-in": "Indian",
  "en-za": "South African",
  "en-nz": "New Zealand",
};

const FEMALE_HINTS = /female|woman|girl|samantha|victoria|karen|moira|tessa|fiona|allison|ava|susan|zira|hazel|catherine|amy|emma|joanna|kendra|kimberly|salli|joelle|nicole|aria|jenny|libby|natasha|sonia|clara|heather|michelle/i;
const MALE_HINTS = /male|man|boy|adam|daniel|alex|fred|ryan|david|mark|guy|davis|james|oliver|aaron|matthew|brian|justin|joey|liam|tony|george|ethan|christopher/i;

function guessGender(name: string): "Male" | "Female" | "" {
  if (FEMALE_HINTS.test(name)) return "Female";
  if (MALE_HINTS.test(name)) return "Male";
  return "";
}

export function friendlyVoiceLabel(v: SpeechSynthesisVoice): string {
  const lang = (v.lang || "").toLowerCase();
  const region = LANG_LABELS[lang] || (lang.startsWith("en") ? "English" : v.lang || "Other");
  const gender = guessGender(v.name);
  // Strip vendor noise from the raw name for a cleaner secondary
  const cleaned = v.name
    .replace(/Microsoft\s+/i, "")
    .replace(/\s+Online\s*\(Natural\)/i, "")
    .replace(/\s+-\s+English.*/i, "")
    .replace(/\s+\(.*?\)/g, "")
    .trim();
  const main = [region, gender].filter(Boolean).join(" ");
  return `${main}  -  ${cleaned}`;
}

export function defaultVoiceName(): string {
  const voices = getVoices();
  for (const name of PREFERRED_VOICES) {
    const hit = voices.find((v) => v.name === name);
    if (hit) return hit.name;
  }
  // Prefer any "Natural" / "Neural" voice for clarity
  const natural = voices.find(
    (v) => v.lang?.startsWith("en") && /natural|neural|online/i.test(v.name),
  );
  if (natural) return natural.name;
  // Any English male-ish fallback
  const enMale = voices.find(
    (v) => v.lang?.startsWith("en") && /male|guy|david|daniel|alex|ryan|andrew|brian/i.test(v.name),
  );
  if (enMale) return enMale.name;
  const en = voices.find((v) => v.lang?.startsWith("en"));
  return en?.name ?? voices[0]?.name ?? "";
}


// Clean text so the TTS speaks what the user actually reads:
// strip markdown syntax, code, URLs, emojis, and normalize whitespace.
function cleanForSpeech(text: string): string {
  return text
    // Remove fenced code blocks entirely (they sound like noise)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    // Markdown images → drop alt text & URL
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    // Markdown links → keep visible text only
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Bare URLs
    .replace(/https?:\/\/\S+/g, " ")
    // Headings, blockquotes, list bullets
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    // Bold/italic/underline markers
    .replace(/(\*\*|__|\*|_|~~)/g, "")
    // Tables: drop pipes
    .replace(/\|/g, " ")
    // Emojis & most symbols (keep letters, numbers, punctuation, whitespace)
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
    .replace(/[#>`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Split long text into sentence-ish chunks so the synth queue can be flushed quickly on interrupt
function chunkText(text: string): string[] {
  const clean = cleanForSpeech(text);
  if (!clean) return [];
  const parts = clean.match(/[^.!?\n]+[.!?]?/g) ?? [clean];
  return parts.map((p) => p.trim()).filter(Boolean);
}


export type SpeakOpts = {
  rate?: number;
  pitch?: number;
  voice?: string; // voice name
  onEnd?: () => void;
};

export function speak(text: string, opts?: SpeakOpts) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const voices = getVoices();
  const voice = opts?.voice
    ? voices.find((v) => v.name === opts.voice) ?? null
    : voices.find((v) => v.name === defaultVoiceName()) ?? null;

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    opts?.onEnd?.();
    return;
  }
  chunks.forEach((chunk, i) => {
    const u = new SpeechSynthesisUtterance(chunk);
    u.rate = opts?.rate ?? 1;
    u.pitch = opts?.pitch ?? 1;
    if (voice) u.voice = voice;
    if (i === chunks.length - 1) u.onend = () => opts?.onEnd?.();
    synth.speak(u);
  });
}

export function speakChunk(text: string, opts?: SpeakOpts) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const synth = window.speechSynthesis;
  const voices = getVoices();
  const voice = opts?.voice
    ? voices.find((v) => v.name === opts.voice) ?? null
    : voices.find((v) => v.name === defaultVoiceName()) ?? null;
  const clean = cleanForSpeech(text);
  if (!clean) { opts?.onEnd?.(); return; }
  const u = new SpeechSynthesisUtterance(clean);
  u.rate = opts?.rate ?? 1;
  u.pitch = opts?.pitch ?? 1;
  if (voice) u.voice = voice;
  if (opts?.onEnd) u.onend = () => opts.onEnd?.();
  synth.speak(u);
}

export function stopSpeaking() {
  if (typeof window === "undefined") return;
  window.speechSynthesis?.cancel();
  stopRemoteSpeaking();
}

export function isSpeaking() {
  if (typeof window === "undefined") return false;
  return (window.speechSynthesis?.speaking ?? false) || remoteSpeaking;
}

// --- Remote (Lovable AI) TTS queue ----------------------------------------
// Streams MP3 from /api/tts and plays sequentially. Sounds dramatically more
// natural than the browser's SpeechSynthesis voices.

import { authFetch } from "@/lib/auth-fetch";

type RemoteJob = { text: string; voice?: string; speed?: number; onEnd?: () => void };
let remoteQueue: RemoteJob[] = [];
let remoteAudio: HTMLAudioElement | null = null;
let remoteAbort: AbortController | null = null;
let remoteSpeaking = false;
let remoteUrl: string | null = null;

async function processRemoteQueue() {
  if (remoteSpeaking) return;
  const job = remoteQueue.shift();
  if (!job) return;
  remoteSpeaking = true;
  try {
    remoteAbort = new AbortController();
    const resp = await authFetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: job.text, voice: job.voice, speed: job.speed }),
      signal: remoteAbort.signal,
    });
    if (!resp.ok) throw new Error(`TTS ${resp.status}`);
    const blob = await resp.blob();
    if (remoteUrl) URL.revokeObjectURL(remoteUrl);
    remoteUrl = URL.createObjectURL(blob);
    const audio = new Audio(remoteUrl);
    remoteAudio = audio;
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      audio.play().catch(() => resolve());
    });
    job.onEnd?.();
  } catch {
    // swallow — likely aborted
  } finally {
    remoteSpeaking = false;
    remoteAudio = null;
    remoteAbort = null;
    if (remoteQueue.length) void processRemoteQueue();
  }
}

export function speakRemoteChunk(text: string, opts?: SpeakOpts & { voiceId?: string }) {
  const clean = cleanForSpeech(text);
  if (!clean) { opts?.onEnd?.(); return; }
  remoteQueue.push({
    text: clean,
    voice: opts?.voiceId,
    speed: opts?.rate,
    onEnd: opts?.onEnd,
  });
  void processRemoteQueue();
}

export function stopRemoteSpeaking() {
  remoteQueue = [];
  try { remoteAbort?.abort(); } catch { /* ignore */ }
  if (remoteAudio) {
    try { remoteAudio.pause(); } catch { /* ignore */ }
    remoteAudio.src = "";
    remoteAudio = null;
  }
  if (remoteUrl) { URL.revokeObjectURL(remoteUrl); remoteUrl = null; }
  remoteSpeaking = false;
}

export function isRemoteSpeaking() {
  return remoteSpeaking || remoteQueue.length > 0;
}

// SpeechRecognition (webkit prefix in Chromium)
type SR = typeof window extends { SpeechRecognition: infer T } ? T : any;

export function createRecognition(
  onResult: (text: string, isFinal: boolean) => void,
  onEnd?: () => void,
) {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SR; webkitSpeechRecognition?: SR };
  const Cls = (w.SpeechRecognition || w.webkitSpeechRecognition) as
    | (new () => any)
    | undefined;
  if (!Cls) return null;
  const rec = new Cls();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-US";
  rec.onresult = (e: any) => {
    let interim = "";
    let final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (final) onResult(final, true);
    else if (interim) onResult(interim, false);
  };
  rec.onend = () => onEnd?.();
  return rec;
}

export function sttSupported() {
  if (typeof window === "undefined") return false;
  const w = window as any;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}
