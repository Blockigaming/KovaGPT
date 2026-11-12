import { useEffect, useRef, useState } from "react";
import { useUser } from "@/components/auth/ClerkSafe";
import { authFetch } from "@/lib/auth-fetch";
import { principalScopedStorageKey, safeBrowserStorage } from "@/lib/principal-browser-storage.mjs";
import {
  VOICE_PREFERENCE_KEY,
  VOICE_GLOW_KEY,
  VOICE_GLOW_PALETTES,
  preferredVoiceGlow,
  preferredVoice,
  readVoiceChoices,
  type VoiceChoice,
} from "@/lib/voice/preference";
import { Button } from "@/components/ui/button";

export function VoiceConnectionStatus() {
  const { user, isLoaded, isSignedIn } = useUser();
  const owner = isLoaded && isSignedIn ? user?.id : null;
  const [glow, setGlow] = useState(() => preferredVoiceGlow(owner).id);
  const current = useRef(owner);
  current.current = owner;
  const [result, setResult] = useState<{
    owner: string;
    stt: boolean;
    conversation: boolean;
    voices: VoiceChoice[];
    voiceId: string;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false);
  const request = useRef({ generation: 0 });
  useEffect(() => {
    setGlow(preferredVoiceGlow(owner).id);
    setResult(null);
    setError("");
    pending.current = false;
    setBusy(false);
    const lifetime = request.current;
    return () => {
      lifetime.generation++;
    };
  }, [owner]);
  const check = async () => {
    if (!owner || pending.current) return;
    pending.current = true;
    const token = ++request.current.generation;
    const active = () => current.current === owner && request.current.generation === token;
    setBusy(true);
    setError("");
    try {
      const response = await authFetch("/api/voice", {
        cache: "no-store",
        headers: { "X-Kova-Voice-Owner": owner },
      });
      const value = await response.json();
      if (!active()) return;
      if (!response.ok || typeof value.stt !== "boolean" || typeof value.conversation !== "boolean")
        throw new Error("Voice status couldn't be checked. Try again.");
      const voices = readVoiceChoices(value.voices).filter((voice) => voice.available);
      setResult({
        owner,
        stt: value.stt,
        conversation: value.conversation,
        voices,
        voiceId: preferredVoice(owner, voices, value.defaultVoiceId),
      });
    } catch {
      if (active()) setError("Voice status couldn't be checked. Try again.");
    } finally {
      if (request.current.generation === token) pending.current = false;
      if (active()) setBusy(false);
    }
  };
  const changeVoice = (voiceId: string) => {
    if (!owner || result?.owner !== owner || !result.voices.some((voice) => voice.id === voiceId))
      return;
    const key = principalScopedStorageKey(VOICE_PREFERENCE_KEY, owner);
    const storage = safeBrowserStorage("localStorage");
    try {
      if (!key || !storage) throw new Error();
      storage.setItem(key, voiceId);
      setResult({ ...result, voiceId });
      setError("");
    } catch {
      setError("Your browser couldn't save the selected voice.");
    }
  };
  return (
    <section aria-labelledby="voice-settings-heading" className="space-y-4">
      <div>
        <h3 id="voice-settings-heading">Voice</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Dictation and spoken replies use ElevenLabs. Your microphone is accessed only when you
          start recording.
        </p>
      </div>
      {owner && (
        <label className="block space-y-2 text-sm">
          <span className="block">Live Voice glow</span>
          <select
            className="min-h-11 w-full rounded-lg border border-border bg-background px-3"
            value={glow}
            onChange={(event) => {
              const palette = VOICE_GLOW_PALETTES.find(({ id }) => id === event.target.value);
              if (!palette) return;
              const key = principalScopedStorageKey(VOICE_GLOW_KEY, owner);
              const storage = safeBrowserStorage("localStorage");
              try {
                if (!key || !storage) throw new Error();
                storage.setItem(key, palette.id);
                setGlow(palette.id);
                setError("");
              } catch {
                setError("Your browser couldn't save the glow palette.");
              }
            }}
          >
            {VOICE_GLOW_PALETTES.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={!owner || busy}
        onClick={() => void check()}
      >
        {busy ? "Checking voice…" : "Check voice connection"}
      </Button>
      {result && result.owner === owner ? (
        <div role="status" className="space-y-2 text-sm">
          <p>Dictation: {result.stt ? "Configured" : "Unavailable"}</p>
          <p>Voice conversations: {result.conversation ? "Configured" : "Unavailable"}</p>
          <p className="text-muted-foreground">
            This checks the account configuration. Start voice in a chat to test recording and
            playback.
          </p>
        </div>
      ) : null}
      {result?.owner === owner && result?.voices.length ? (
        <label className="block space-y-2 text-sm">
          <span className="block">Reply voice</span>
          <select
            className="min-h-11 w-full rounded-lg border border-border bg-background px-3"
            value={result.voiceId}
            onChange={(event) => changeVoice(event.target.value)}
          >
            {result.voices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
