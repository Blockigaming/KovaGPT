import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { authFetch } from "@/lib/auth-fetch";
import { loadVoiceTools, submitVoiceTool } from "@/lib/voice-tools-client.mjs";
import { safeDocumentFilename } from "@/lib/writing-export/common";
import type { SpeechBlock } from "@/lib/interactive-ui.mjs";

export function ResponseSpeech({ block, ownerId }: { block: SpeechBlock; ownerId?: string }) {
  const id = useId();
  const active = useRef<AbortController | null>(null);
  const [audio, setAudio] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => active.current?.abort(), []);
  useEffect(
    () => () => {
      if (audio) URL.revokeObjectURL(audio);
    },
    [audio],
  );

  async function generate() {
    if (!ownerId || active.current || audio) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    active.current = controller;
    setRunning(true);
    setError("");
    const options = { signal: controller.signal, fetchImpl: authFetch };
    try {
      const tools = await loadVoiceTools(ownerId, options);
      if (!tools.configured || !tools.tts || !tools.defaultVoiceId)
        throw new Error("Audio generation is unavailable for this account.");
      const result = await submitVoiceTool(
        {
          ownerId,
          action: "tts",
          text: block.script,
          voiceId: tools.defaultVoiceId,
        },
        options,
      );
      if (!controller.signal.aborted && active.current === controller && result.audio)
        setAudio(URL.createObjectURL(result.audio));
    } catch (cause) {
      if (active.current === controller)
        setError(
          controller.signal.aborted
            ? "Audio generation was stopped."
            : cause instanceof Error
              ? cause.message
              : "Could not generate the audio.",
        );
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) {
        active.current = null;
        setRunning(false);
      }
    }
  }

  return (
    <section
      aria-labelledby={id}
      className="my-3 min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5"
    >
      <h3 id={id} className="font-semibold">
        {block.title}
      </h3>
      {block.description && (
        <p className="mt-1 text-sm text-muted-foreground">{block.description}</p>
      )}
      <div className="mt-3 space-y-2">
        {!ownerId ? (
          <p className="text-sm">Sign in to generate audio.</p>
        ) : audio ? (
          <>
            <audio
              className="w-full max-w-full"
              controls
              preload="metadata"
              src={audio}
              aria-label={block.title}
            />
            <a
              href={audio}
              download={safeDocumentFilename(block.title, "mp3")}
              className="inline-flex min-h-11 items-center text-sm underline"
            >
              Download MP3
            </a>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              className="min-h-11"
              disabled={running}
              onClick={() => void generate()}
            >
              {running ? "Generating audio…" : "Generate audio"}
            </Button>
            {running && (
              <Button type="button" variant="ghost" onClick={() => active.current?.abort()}>
                Stop
              </Button>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <details className="text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center">Transcript</summary>
          <p className="whitespace-pre-wrap break-words">{block.script}</p>
        </details>
      </div>
    </section>
  );
}
