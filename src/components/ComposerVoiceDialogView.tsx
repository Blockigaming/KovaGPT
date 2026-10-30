import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { AudioLines, Info, Loader2, X } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import "./composer-voice.css";

export type ComposerVoicePhase =
  | "idle"
  | "requesting"
  | "recording"
  | "stopping"
  | "transcribing"
  | "chat"
  | "speaking"
  | "synthesizing";
export type ComposerVoiceAvailability =
  "ready" | "checking" | "unconfigured" | "guest" | "disabled" | "streaming" | "error";

/**
 * Presentation only. This boundary has no account, media, storage, request, or
 * timer access. The live controller supplies guarded controls; a local review
 * can render the same canvas with explicitly synthetic controls and state.
 */
export interface ComposerVoiceDialogViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: ComponentPropsWithoutRef<typeof DialogContent>["onCloseAutoFocus"];
  phase: ComposerVoicePhase;
  mode?: "dictate" | "voice";
  voiceReply?: string;
  status: string;
  availability: ComposerVoiceAvailability;
  hasTranscript: boolean;
  microphoneAvailable?: boolean;
  replyAvailable?: boolean;
  error?: string;
  voicePicker?: ReactNode;
  conversationModelControl?: ReactNode;
  recordingControl?: ReactNode;
  retryControl?: ReactNode;
  cancelControl?: ReactNode;
  transcriptReview?: ReactNode;
  replyControl?: ReactNode;
  audioPlayer?: ReactNode;
  useTranscriptControl?: ReactNode;
  availabilityRetry?: ReactNode;
}

export function ComposerVoiceDialogView({
  open,
  onOpenChange,
  onCloseAutoFocus,
  phase,
  mode = "dictate",
  voiceReply,
  status,
  availability,
  hasTranscript,
  microphoneAvailable = true,
  replyAvailable = true,
  error,
  voicePicker,
  conversationModelControl,
  recordingControl,
  retryControl,
  cancelControl,
  transcriptReview,
  replyControl,
  audioPlayer,
  useTranscriptControl,
  availabilityRetry,
}: ComposerVoiceDialogViewProps) {
  const ready = availability === "ready";
  const processing = ready && phase !== "idle" && phase !== "recording";
  const hasError = Boolean(error);
  const contentFirst =
    hasTranscript ||
    Boolean(audioPlayer) ||
    Boolean(voiceReply) ||
    phase === "speaking" ||
    hasError;
  const compact = !ready || (hasError && !hasTranscript && !audioPlayer && !voiceReply);
  const title = hasError
    ? "Voice needs attention"
    : availability === "checking"
      ? "Checking voice"
      : availability === "unconfigured"
        ? mode === "voice"
          ? "Voice conversation unavailable"
          : "Voice is not available yet"
        : availability === "guest"
          ? "Sign in to use voice"
          : availability === "disabled"
            ? "Voice unavailable"
            : availability === "streaming"
              ? "Reply in progress"
              : availability === "error"
                ? "Voice couldn’t connect"
                : phase === "recording"
                  ? "Recording"
                  : phase === "requesting"
                    ? "Allow microphone access"
                    : phase === "stopping" || phase === "transcribing"
                      ? "Transcribing"
                      : phase === "chat"
                        ? "Reply in progress"
                        : phase === "speaking"
                          ? "Speaking"
                          : phase === "synthesizing"
                            ? "Preparing audio"
                            : hasTranscript
                              ? mode === "voice"
                                ? "Voice paused"
                                : "Review transcript"
                              : audioPlayer
                                ? "Ready to listen"
                                : !microphoneAvailable
                                  ? replyAvailable
                                    ? "Hear a reply"
                                    : "Voice unavailable"
                                  : "Ready to talk";
  const description =
    error ||
    (availability === "checking"
      ? "Checking voice availability…"
      : availability === "unconfigured"
        ? mode === "voice"
          ? microphoneAvailable
            ? "Spoken replies are not available for your account. Use Dictate for a speech-to-text draft, or keep typing."
            : "Microphone transcription is not configured. You can keep typing in chat."
          : "Keep typing in the meantime."
        : availability === "guest"
          ? "Sign in to use voice. You can keep typing without microphone access."
          : availability === "disabled"
            ? "Messaging is unavailable right now. Voice will be available when you can send messages again."
            : availability === "streaming"
              ? "Wait for the current reply to finish before using voice."
              : availability === "error"
                ? "Try again, or keep the conversation going in chat."
                : phase === "idle" && !hasTranscript && !audioPlayer
                  ? microphoneAvailable
                    ? mode === "voice"
                      ? "Start a voice conversation. Finish each turn to send it, then hear the saved reply. Stop ends microphone access and playback."
                      : "Speak, review your words, then add them to chat."
                    : replyAvailable
                      ? "Listen to a completed reply using your selected voice."
                      : "Recording and reply playback are unavailable right now."
                  : phase === "recording"
                    ? mode === "voice"
                      ? "Finish turn sends this recording through transcription and your chat. Stop ends the session and discards the current recording."
                      : "Stop when you’re ready to turn your recording into text."
                    : phase === "requesting"
                      ? "Your browser will ask before the microphone can start."
                      : phase === "stopping" || phase === "transcribing"
                        ? mode === "voice"
                          ? "Your recording is being transcribed before sending through your chat."
                          : "Your recording is being turned into a draft you can review."
                        : phase === "chat"
                          ? "Your normal chat model is replying and saving the conversation."
                          : phase === "speaking"
                            ? "The saved reply is read aloud. Your next recording starts only after playback finishes."
                            : phase === "synthesizing"
                              ? "Your completed reply is being prepared for playback."
                              : hasTranscript
                                ? mode === "voice"
                                  ? "Review the transcript and saved reply in chat. Start begins a new turn."
                                  : "Make any changes before adding this to your chat."
                                : "Press play to hear your completed reply.");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="kova-voice-dialog"
        data-ui-reference="chatgpt-separate-voice"
        data-voice-availability={availability}
        data-voice-phase={phase}
        data-voice-review={hasTranscript || Boolean(audioPlayer) ? "true" : "false"}
        data-voice-content-first={contentFirst ? "true" : "false"}
        data-voice-compact={compact ? "true" : "false"}
        data-voice-error={hasError ? "true" : "false"}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <div className="kova-voice-topbar">
          <DialogTitle className="kova-voice-title">
            <AudioLines aria-hidden="true" /> {mode === "voice" ? "Voice" : "Dictate"}
          </DialogTitle>
          {voicePicker && <div className="kova-voice-picker">{voicePicker}</div>}
        </div>

        <div className="kova-voice-body">
          <div className="kova-voice-canvas">
            {ready && !contentFirst && (
              <svg
                className="kova-voice-mark"
                viewBox="0 0 200 200"
                aria-hidden="true"
                focusable="false"
              />
            )}
            <h2 className="kova-voice-heading">{title}</h2>
            <DialogDescription
              className={
                hasError ? "kova-voice-description kova-voice-error" : "kova-voice-description"
              }
              role={hasError ? "alert" : undefined}
            >
              {description}
            </DialogDescription>
            {(ready || availability === "checking") && !hasError && (
              <p
                className={
                  phase === "idle" && ready ? "kova-voice-status sr-only" : "kova-voice-status"
                }
                role="status"
                aria-live="polite"
              >
                {(processing || availability === "checking") && (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                )}
                {phase === "recording" && (
                  <span className="kova-voice-recording-dot" aria-hidden="true" />
                )}
                {ready ? status : "Checking voice availability…"}
              </p>
            )}
          </div>

          {ready && voiceReply && (
            <div className="kova-voice-transcript">
              <h3>Latest saved reply</h3>
              <p className="whitespace-pre-wrap break-words">{voiceReply}</p>
            </div>
          )}
          {ready && transcriptReview && (
            <div className="kova-voice-transcript">{transcriptReview}</div>
          )}
          {availabilityRetry && <div className="kova-voice-retry">{availabilityRetry}</div>}
          {ready && audioPlayer && <div className="kova-voice-player">{audioPlayer}</div>}
          {ready && replyControl && <div className="kova-voice-reply">{replyControl}</div>}
        </div>

        <div className="kova-voice-bottom">
          {ready && (retryControl || cancelControl) && (
            <div className="kova-voice-recovery">
              {retryControl && <div className="kova-voice-retry-control">{retryControl}</div>}
              {cancelControl}
            </div>
          )}
          {ready && useTranscriptControl && (
            <div className="kova-voice-use-transcript">{useTranscriptControl}</div>
          )}
          <div className="kova-voice-dock">
            {ready && recordingControl && (
              <div className="kova-voice-record-control">{recordingControl}</div>
            )}
            <button type="button" className="kova-voice-close" onClick={() => onOpenChange(false)}>
              {ready ? (
                <>
                  <X aria-hidden="true" />
                  <span className="sr-only">Close</span>
                </>
              ) : (
                <span>Close</span>
              )}
            </button>
          </div>
          {ready && (
            <p className="kova-voice-limit">
              {ready && microphoneAvailable
                ? mode === "voice"
                  ? "Up to 59 seconds per turn · Finish turn to send · Stop ends Voice"
                  : "Up to 59 seconds · Stop to transcribe"
                : "Your conversation is here when you’re ready"}
            </p>
          )}
          {ready && (
            <div className="kova-voice-footnote">
              <div
                className="kova-voice-model-control"
                role="group"
                aria-label="Conversation model"
              >
                {conversationModelControl && (
                  <>
                    <span className="sr-only">
                      Conversation model. Your chat model powers the conversation.
                    </span>
                    {conversationModelControl}
                  </>
                )}
              </div>
              <div className="kova-voice-secondary-control">
                {ready && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="kova-voice-detail-button"
                        aria-label="How your audio is processed"
                      >
                        <Info aria-hidden="true" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="top" align="end" className="kova-voice-popover">
                      <p className="kova-voice-popover-title">How your audio is processed</p>
                      <p>
                        {mode === "voice"
                          ? "After explicit Start, Finish turn or the 59-second limit sends your recording to ElevenLabs for transcription. The transcript is submitted through your chat and saved to history; the saved reply is then sent to ElevenLabs for speech. The microphone restarts after actual playback ends. Stop or Close ends the session. Recordings are limited to 8 MB."
                          : "When you stop or reach 59 seconds, your recording is sent to ElevenLabs for transcription. Reply text is sent there when you choose to hear it aloud. Cancel before stopping to discard audio. Recordings are limited to 8 MB."}
                      </p>
                      <p>
                        {mode === "voice"
                          ? "Your draft stays separate from spoken turns. Reply speech uses your selected voice, or the configured default when no choices are listed."
                          : "You review the transcript before adding it to your chat draft."}
                      </p>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
