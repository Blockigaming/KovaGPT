import { useEffect, useRef, useState } from "react";
import { useUser } from "@/components/auth/ClerkSafe";
import { authFetch } from "@/lib/auth-fetch";
import { Button } from "@/components/ui/button";

export function VoiceConnectionStatus() {
  const { user, isLoaded, isSignedIn } = useUser();
  const owner = isLoaded && isSignedIn ? user?.id : null;
  const current = useRef(owner);
  current.current = owner;
  const [result, setResult] = useState<{
    owner: string;
    stt: boolean;
    conversation: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false);
  const request = useRef(0);
  useEffect(() => {
    setResult(null);
    setError("");
    pending.current = false;
    setBusy(false);
    return () => {
      request.current++;
    };
  }, [owner]);
  const check = async () => {
    if (!owner || pending.current) return;
    pending.current = true;
    const token = ++request.current;
    const active = () => current.current === owner && request.current === token;
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
      setResult({ owner, stt: value.stt, conversation: value.conversation });
    } catch {
      if (active()) setError("Voice status couldn't be checked. Try again.");
    } finally {
      if (request.current === token) pending.current = false;
      if (active()) setBusy(false);
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
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
