import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Mic, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ComposerVoiceDialogView } from "@/components/ComposerVoiceDialogView";
import type { ComposerVoicePhase } from "@/components/ComposerVoiceDialogView";

const states = [
  "ready",
  "recording",
  "transcribing",
  "transcript",
  "playback",
  "error",
  "unconfigured",
] as const;
type State = (typeof states)[number];
function VoicePreview() {
  const [state, setState] = useState<State>("ready");
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState("dark");
  const [voice, setVoice] = useState("Sample · Clear");
  const [text, setText] = useState("Help me prepare a short project update.");
  const [notice, setNotice] = useState("");
  const phase: ComposerVoicePhase =
    state === "recording" ? "recording" : state === "transcribing" ? "transcribing" : "idle";
  const action = (label: string, onClick: () => void, icon?: React.ReactNode) => (
    <Button type="button" onClick={onClick}>
      {icon}
      {label}
    </Button>
  );
  return (
    <main className="min-h-dvh bg-background p-5 text-foreground">
      <h1 className="text-xl font-semibold">Voice state review</h1>
      <p className="my-3 text-sm text-muted-foreground">
        Synthetic interaction only. No microphone, audio capture, provider request, or playback.
        This uses the actual voice presentation component.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label>
          State{" "}
          <select
            value={state}
            onChange={(e) => setState(e.target.value as State)}
            className="min-h-11 rounded-lg border bg-background px-3"
          >
            {states.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Theme{" "}
          <select
            value={theme}
            onChange={(e) => {
              setTheme(e.target.value);
              document.documentElement.classList.toggle("dark", e.target.value === "dark");
            }}
            className="min-h-11 rounded-lg border bg-background px-3"
          >
            <option>dark</option>
            <option>light</option>
          </select>
        </label>
        {action("Open voice preview", () => setOpen(true))}
      </div>
      <p role="status" className="mt-3 text-sm">
        {notice}
      </p>
      <ComposerVoiceDialogView
        open={open}
        onOpenChange={setOpen}
        phase={phase}
        availability={state === "unconfigured" ? "unconfigured" : "ready"}
        status={
          state === "recording"
            ? "Simulated recording · 12 seconds"
            : state === "transcribing"
              ? "Simulated transcription"
              : state === "playback"
                ? "Sample reply ready"
                : "Ready when you are"
        }
        hasTranscript={state === "transcript"}
        error={
          state === "error"
            ? "Couldn’t transcribe. Your recording is available to retry."
            : undefined
        }
        voicePicker={
          <select
            aria-label="Reply voice"
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            className="min-h-11 max-w-full rounded-full border-0 bg-transparent px-3 text-sm"
          >
            <option>Sample · Clear</option>
            <option>Sample · Warm</option>
            <option>Sample · Calm</option>
          </select>
        }
        conversationModelControl={
          <span title="Synthetic conversation model; live model availability is separate.">
            Sample model
          </span>
        }
        recordingControl={
          <Button
            type="button"
            disabled={state === "transcribing"}
            title={state === "recording" ? "Stop and transcribe" : "Start recording"}
            onClick={() => setState(state === "recording" ? "transcript" : "recording")}
          >
            {state === "recording" ? <Square aria-hidden="true" /> : <Mic aria-hidden="true" />}
            <span className="sr-only">
              {state === "recording" ? "Stop and transcribe" : "Start recording"}
            </span>
          </Button>
        }
        cancelControl={
          state === "recording" || state === "transcribing"
            ? action("Cancel", () => setState("ready"))
            : undefined
        }
        retryControl={
          state === "error"
            ? action("Retry transcription", () => setState("transcript"))
            : undefined
        }
        transcriptReview={
          state === "transcript" ? (
            <label className="block text-sm">
              Review transcript
              <textarea
                className="mt-2 min-h-24 w-full rounded-xl border bg-background p-3"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
          ) : undefined
        }
        useTranscriptControl={
          state === "transcript"
            ? action("Use in chat", () => {
                setNotice("Sample transcript added locally. No message sent.");
                setOpen(false);
              })
            : undefined
        }
        replyControl={
          state === "playback"
            ? action(
                "Read latest reply",
                () => setNotice("Playback is simulated. No audio requested."),
                <Volume2 aria-hidden="true" />,
              )
            : undefined
        }
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<VoicePreview />);
