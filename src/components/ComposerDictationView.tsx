import { useLayoutEffect, useRef } from "react";
import { ArrowUp, Loader2, X } from "lucide-react";
import type { ComposerVoiceDialogViewProps } from "@/components/ComposerVoiceDialogView";
import "./composer-voice.css";

// A bounded visual waveform. It animates only while the recorder is active;
// the status text describes the actual recording and transcription states.
const WAVE_BARS = Array.from({ length: 72 }, (_, index) => {
  const envelope = [15, 29, 42, 53].reduce((sum, center, cluster) => {
    const distance = (index - center) / (cluster === 1 ? 4.4 : 3.1);
    return sum + Math.exp(-distance * distance) * (cluster === 1 ? 27 : 18);
  }, 0);
  return Math.round(
    Math.min(38, Math.max(3, 3 + envelope * (0.42 + 0.58 * Math.abs(Math.sin(index * 1.47))))),
  );
});

/** Inline dictation shares the server-authorized voice controller and media cleanup. */
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
  const showDetails = Boolean(
    error || hasTranscript || unavailable || availabilityRetry || retryControl,
  );

  return (
    <section
      id="kova-inline-dictation"
      className="kova-inline-dictation"
      role="region"
      aria-label="Type with voice"
      data-voice-phase={phase}
      data-voice-availability={availability}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(false);
        }
      }}
    >
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
        <div
          className="kova-inline-dictation-wave"
          data-recording={recording}
          role="img"
          aria-label={recording ? "Recording in progress" : "Voice waveform"}
        >
          {WAVE_BARS.map((height, index) => (
            <i
              key={index}
              style={{ height: `${height}px`, animationDelay: `${-((index * 67) % 900)}ms` }}
            />
          ))}
        </div>
        <div className="kova-inline-dictation-actions">
          {processing ? (
            <span className="kova-inline-dictation-processing" role="status" aria-label={status}>
              <Loader2 className="animate-spin" aria-hidden="true" />
            </span>
          ) : (
            recordingControl
          )}
          {useTranscriptControl ?? (
            <button
              type="button"
              className="kova-inline-dictation-send"
              aria-label="Add transcript to chat"
              title="Stop recording to prepare a transcript"
              disabled
            >
              <ArrowUp aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <p
        className={showDetails ? "kova-inline-dictation-status" : "sr-only"}
        role={error ? "alert" : "status"}
      >
        {notice}
      </p>
      {showDetails && (
        <div className="kova-inline-dictation-content">
          {hasTranscript && transcriptReview}
          {availabilityRetry}
          {retryControl}
        </div>
      )}
    </section>
  );
}
