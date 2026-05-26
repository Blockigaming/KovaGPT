// Browser-native TTS and STT helpers (Web Speech API)

export function speak(text: string, opts?: { rate?: number; pitch?: number; voice?: string }) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = opts?.rate ?? 1;
  utter.pitch = opts?.pitch ?? 1;
  if (opts?.voice) {
    const v = window.speechSynthesis.getVoices().find((x) => x.name === opts.voice);
    if (v) utter.voice = v;
  }
  window.speechSynthesis.speak(utter);
}

export function stopSpeaking() {
  if (typeof window === "undefined") return;
  window.speechSynthesis?.cancel();
}

export function isSpeaking() {
  if (typeof window === "undefined") return false;
  return window.speechSynthesis?.speaking ?? false;
}

// SpeechRecognition (webkit prefix in Chromium)
type SR = typeof window extends { SpeechRecognition: infer T } ? T : any;

export function createRecognition(onResult: (text: string, isFinal: boolean) => void, onEnd?: () => void) {
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
