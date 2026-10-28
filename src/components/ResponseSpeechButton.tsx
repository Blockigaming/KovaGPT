import { useEffect, useRef, useState } from "react";
import { Loader2, Square, Volume2 } from "lucide-react";
import { authFetch } from "@/lib/auth-fetch";
import { createSpeechPlayback } from "@/lib/speech-playback.mjs";
import { PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT } from "@/lib/principal-browser-storage.mjs";

const errors: Record<string, string> = {
  speech_unauthorized: "Sign in with a verified account to read aloud.",
  speech_not_eligible: "Read aloud is available for saved replies from approved OpenAI models.",
  speech_voice_plan_required: "This voice requires a different plan.",
  speech_forbidden: "Read aloud is not available for this account right now.",
  speech_message_unavailable: "Save this response to your chat history before reading it aloud.",
  speech_message_not_synced: "This response is still syncing. Try again once it is saved.",
  speech_text_too_long: "Read aloud supports responses up to 4,000 characters.",
  speech_limit_reached: "Read-aloud limit reached. Try again later.",
  speech_not_available: "Read aloud is not available right now.",
  speech_timeout: "Read aloud timed out.",
};

export function ResponseSpeechButton({
  ownerId,
  chatId,
  messageId,
  content,
}: {
  ownerId: string;
  chatId: string;
  messageId: string;
  content: string;
}) {
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");
  const playback = useRef<ReturnType<typeof createSpeechPlayback> | null>(null);
  const intent = useRef(0);
  const identity = `${ownerId}:${chatId}:${messageId}:${content}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  useEffect(() => {
    const player = createSpeechPlayback({
      fetchImpl: authFetch,
      onState: (next: string, code?: string) => {
        setState(next);
        setError(code ? (errors[code] ?? "Read aloud failed. Try again.") : "");
      },
    });
    playback.current = player;
    const halt = () => {
      intent.current++;
      player.stop();
    };
    window.addEventListener("pagehide", halt);
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, halt);
    return () => {
      window.removeEventListener("pagehide", halt);
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, halt);
      halt();
      if (playback.current === player) playback.current = null;
    };
  }, [identity]);
  const busy = state === "loading" || state === "playing";
  const click = async () => {
    if (busy) {
      intent.current++;
      playback.current?.stop();
      return;
    }
    const captured = identity;
    const attempt = ++intent.current;
    try {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
      if (identityRef.current !== captured || intent.current !== attempt) return;
      const contentSha256 = Array.from(new Uint8Array(digest), (v) =>
        v.toString(16).padStart(2, "0"),
      ).join("");
      void playback.current?.start({ ownerId, chatId, messageId, contentSha256 });
    } catch {
      setState("error");
      setError("Read aloud is not supported in this browser.");
    }
  };
  return (
    <span className="inline-flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={() => void click()}
        aria-label={busy ? "Stop reading aloud" : "Read aloud"}
        title={busy ? "Stop reading aloud" : "Read aloud"}
        aria-pressed={busy}
        className="inline-flex items-center gap-1.5 rounded-lg p-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        {state === "loading" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : busy ? (
          <Square className="h-4 w-4" />
        ) : (
          <Volume2 className="h-4 w-4" />
        )}
        {busy ? "Stop" : "Read aloud"}
      </button>
      <span role="status" className={error ? "text-xs text-destructive" : "sr-only"}>
        {error ||
          (state === "loading" ? "Loading audio" : state === "playing" ? "Reading aloud" : "")}
      </span>
    </span>
  );
}
