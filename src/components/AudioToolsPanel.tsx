import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { prepareVoiceRecording } from "@/lib/voice-recording";
import {
  loadVoiceTools,
  submitVoiceTool,
  type VoiceToolAction,
  type VoiceToolsAvailability,
} from "@/lib/voice-tools-client.mjs";

const operationLabels = { tts: "Generate speech", stt: "Transcribe audio", sts: "Transform voice" };

export function AudioToolsPanel({ ownerId }: { ownerId: string | null }) {
  const [availability, setAvailability] = useState<VoiceToolsAvailability | null>(null);
  const [checking, setChecking] = useState(false);
  const [action, setAction] = useState<VoiceToolAction>("tts");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [voiceId, setVoiceId] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ ownerId: string; text?: string; url?: string } | null>(
    null,
  );
  const owner = useRef(ownerId);
  const active = useRef<AbortController | null>(null);
  const audioUrl = useRef<string | null>(null);
  const audioPlayer = useRef<HTMLAudioElement | null>(null);
  const pauseAudio = useCallback(() => audioPlayer.current?.pause(), []);
  owner.current = ownerId;

  const clearResult = useCallback(() => {
    pauseAudio();
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    audioUrl.current = null;
    setResult(null);
  }, [pauseAudio]);

  useEffect(() => {
    active.current?.abort();
    active.current = null;
    setAvailability(null);
    setText("");
    setFile(null);
    setVoiceId("");
    setRunning(false);
    setError("");
    clearResult();
    setChecking(Boolean(ownerId));
    if (!ownerId) return;
    let live = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    void loadVoiceTools(ownerId, { signal: controller.signal, fetchImpl: authFetch })
      .then((next) => {
        if (!live || owner.current !== ownerId || controller.signal.aborted) return;
        setAvailability(next);
        setVoiceId(next.defaultVoiceId ?? "");
        setAction(next.tts ? "tts" : next.stt ? "stt" : "sts");
      })
      .catch((reason) => {
        if (live && owner.current === ownerId)
          setError(
            controller.signal.aborted
              ? "Checking audio availability timed out."
              : reason instanceof Error
                ? reason.message
                : "Audio tools are unavailable.",
          );
      })
      .finally(() => {
        clearTimeout(timeout);
        if (live && owner.current === ownerId) setChecking(false);
      });
    return () => {
      live = false;
      controller.abort();
      clearTimeout(timeout);
      active.current?.abort();
      pauseAudio();
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = null;
    };
  }, [ownerId, pauseAudio, clearResult]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !ownerId ||
      running ||
      active.current ||
      !availability?.[action] ||
      (action === "tts" ? !text.trim() : !file) ||
      (action !== "stt" &&
        !availability.voices.some((voice) => voice.id === voiceId && voice.available))
    )
      return;
    const controller = new AbortController();
    active.current = controller;
    setRunning(true);
    setError("");
    clearResult();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    const current = () =>
      owner.current === ownerId && active.current === controller && !controller.signal.aborted;
    try {
      const audio =
        action !== "tts" && file
          ? await prepareVoiceRecording(file, { signal: controller.signal })
          : undefined;
      if (!current()) return;
      const answer = await submitVoiceTool(
        { ownerId, action, text, audio, ...(action !== "stt" ? { voiceId } : {}) },
        { signal: controller.signal, fetchImpl: authFetch },
      );
      if (!current()) return;
      const url = answer.audio ? URL.createObjectURL(answer.audio) : undefined;
      audioUrl.current = url ?? null;
      setResult({ ownerId, text: answer.text, url });
    } catch (reason) {
      if (owner.current === ownerId && active.current === controller)
        setError(
          controller.signal.aborted
            ? "Audio operation cancelled. A request already started may still count toward usage."
            : reason instanceof Error
              ? reason.message
              : "The audio operation could not be completed.",
        );
    } finally {
      clearTimeout(timeout);
      if (owner.current === ownerId && active.current === controller) {
        active.current = null;
        setRunning(false);
      }
    }
  }
  return (
    <section className="my-4 rounded-2xl border bg-card p-4" aria-label="Audio tools">
      <h2 className="text-lg font-semibold">Audio tools</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Generate speech, transcribe an audio file, or transform its voice with ElevenLabs. Audio is
        sent only when you run an operation.
      </p>
      {!ownerId ? (
        <p className="mt-3 text-sm" role="status">
          Sign in to use Audio tools.
        </p>
      ) : (
        <>
          {checking && (
            <p className="mt-3 text-sm" role="status">
              Checking audio availability…
            </p>
          )}
          {availability &&
            (!availability.configured ||
              (!availability.tts && !availability.stt && !availability.sts)) && (
              <p className="mt-3 text-sm" role="status">
                Audio tools are unavailable for your account right now.
              </p>
            )}
          {availability?.configured &&
            (availability.tts || availability.stt || availability.sts) && (
              <form onSubmit={(event) => void submit(event)} className="mt-3 space-y-3">
                <label className="block text-sm">
                  Audio operation
                  <select
                    aria-label="Audio operation"
                    className="mt-1 block w-full border bg-background"
                    value={action}
                    disabled={running}
                    onChange={(event) => {
                      setAction(event.target.value as VoiceToolAction);
                      setFile(null);
                      setError("");
                      clearResult();
                    }}
                  >
                    {(Object.keys(operationLabels) as VoiceToolAction[]).map((operation) => (
                      <option key={operation} value={operation} disabled={!availability[operation]}>
                        {operationLabels[operation]}
                      </option>
                    ))}
                  </select>
                </label>
                {action !== "stt" && (
                  <label className="block text-sm">
                    Voice
                    <select
                      aria-label="Audio voice"
                      className="mt-1 block w-full border bg-background"
                      value={voiceId}
                      disabled={running}
                      onChange={(event) => {
                        setVoiceId(event.target.value);
                        clearResult();
                      }}
                    >
                      {availability.voices.map((voice) => (
                        <option key={voice.id} value={voice.id} disabled={!voice.available}>
                          {voice.label}
                          {voice.available ? "" : " — unavailable on your plan"}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {action === "tts" ? (
                  <label className="block text-sm">
                    Text to speak
                    <Textarea
                      className="mt-1 block min-h-28 w-full border bg-background"
                      maxLength={5000}
                      value={text}
                      disabled={running}
                      onChange={(event) => setText(event.target.value)}
                    />
                  </label>
                ) : (
                  <label className="block text-sm">
                    Audio file · up to 60 seconds and 8 MB
                    <Input
                      key={`${ownerId}:${action}`}
                      className="mt-1 block w-full border bg-background"
                      type="file"
                      accept="audio/*"
                      disabled={running}
                      onChange={(event) => {
                        const selected = event.target.files?.[0] ?? null;
                        clearResult();
                        setError("");
                        if (selected && (!selected.size || selected.size > 8 * 1024 * 1024)) {
                          setFile(null);
                          event.target.value = "";
                          setError("Choose an audio file between 0 and 8 MB.");
                        } else setFile(selected);
                      }}
                    />
                  </label>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="default"
                    type="submit"
                    className="bg-primary text-sm text-primary-foreground disabled:opacity-40"
                    disabled={
                      running ||
                      !availability[action] ||
                      (action === "tts" ? !text.trim() : !file) ||
                      (action !== "stt" && !voiceId)
                    }
                  >
                    {running ? "Processing audio…" : operationLabels[action]}
                  </Button>
                  {running && (
                    <Button
                      variant="outline"
                      type="button"
                      className="border text-sm"
                      onClick={() => active.current?.abort()}
                    >
                      Cancel audio
                    </Button>
                  )}
                </div>
              </form>
            )}
          {error && (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {result?.ownerId === ownerId && (
            <div className="mt-4 rounded-lg border p-3" role="status" aria-live="polite">
              <h3 className="font-medium">Audio result</h3>
              {result.text && (
                <p className="mt-2 whitespace-pre-wrap break-words text-sm">{result.text}</p>
              )}
              {result.url && (
                <audio
                  ref={audioPlayer}
                  controls
                  preload="metadata"
                  className="mt-2 max-w-full"
                  src={result.url}
                  aria-label="Generated audio"
                />
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
