import { useLayoutEffect, useRef } from "react";
import { Loader2, X } from "lucide-react";
import type { ComposerVoiceDialogViewProps } from "@/components/ComposerVoiceDialogView";
import "./composer-voice.css";

/** Inline dictation shares the voice controller's scoped recording and cleanup. */
export function ComposerDictationView({
  open,
  onOpenChange,
  phase,
  status,
  availability,
  error,
  hasTranscript,
  microphoneAvailable,
  recordingControl,
  retryControl,
  transcriptReview,
  useTranscriptControl,
  availabilityRetry,
}: ComposerVoiceDialogViewProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (open) cancelRef.current?.focus({ preventScroll: true });
  }, [open]);
  if (!open) return null;
  const recording = phase === "recording";
  const processing =
    availability === "checking" || ["requesting", "stopping", "transcribing"].includes(phase);
  const unavailable = availability !== "ready" && availability !== "checking";
  const notice =
    error ||
    (unavailable
      ? availability === "guest"
        ? "Sign in to type with voice."
        : "Dictation is unavailable right now. You can keep typing."
      : !microphoneAvailable && availability === "ready"
        ? "Microphone transcription is unavailable right now."
        : processing || recording
          ? status
          : hasTranscript
            ? "Review your words, then add them to your message."
            : "Ready to record.");
  return (
    <section
      id="kova-inline-dictation"
      className="kova-inline-dictation"
      role="region"
      aria-label="Type with voice"
      data-voice-phase={phase}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(false);
        }
      }}
    >
      <div className="kova-inline-dictation-content">
        {hasTranscript ? (
          transcriptReview
        ) : (
          <span className="kova-inline-dictation-title">Type with voice</span>
        )}
        <p role={error ? "alert" : "status"}>{notice}</p>
        {availabilityRetry}
        {retryControl}
      </div>
      <div className="kova-inline-dictation-controls">
        <button
          ref={cancelRef}
          type="button"
          className="kova-inline-dictation-cancel"
          aria-label="Cancel dictation"
          title="Cancel dictation (Esc)"
          onClick={() => onOpenChange(false)}
        >
          <X aria-hidden="true" />
        </button>
        <div className="kova-inline-dictation-wave" data-recording={recording} aria-hidden="true">
          {Array.from({ length: 48 }, (_, index) => (
            <i key={index} style={{ animationDelay: `${(index % 7) * -110}ms` }} />
          ))}
        </div>
        {processing ? (
          <Loader2 className="kova-inline-dictation-processing animate-spin" aria-hidden="true" />
        ) : (
          recordingControl
        )}
        {useTranscriptControl}
      </div>
    </section>
  );
}
