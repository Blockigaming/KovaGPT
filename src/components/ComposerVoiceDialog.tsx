import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Lock, Mic, Square, Volume2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { DialogContent } from "@/components/ui/dialog";
import { ComposerVoiceDialogView } from "@/components/ComposerVoiceDialogView";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  isPrincipalBrowserStorageClearedEvent,
  principalScopedStorageKey,
  safeBrowserStorage,
} from "@/lib/principal-browser-storage.mjs";
import { authFetch } from "@/lib/auth-fetch";
import { prepareVoiceRecording } from "@/lib/voice-recording";
import {
  createBrowserSpeechSink,
  createSpeechPlayback,
  stopActiveSpeechPlayback,
} from "@/lib/speech-playback.mjs";
import type { ComposerVoiceTurn } from "@/lib/composer-voice-turn";

// Leave room for codec finalization beneath the server's hard 60-second limit.
const MAX_RECORDING_MS = 59_000;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_REPLY_CHARACTERS = 5_000;
const REQUEST_TIMEOUT_MS = 60_000;

const VOICE_PREFERENCE_KEY = "kova-voice-selection-v1";
type VoiceChoice = { id: string; label: string; available: boolean };
type VoiceCapabilities = {
  configured: boolean;
  stt: boolean;
  tts: boolean;
  sts: boolean;
  conversation: boolean;
  voices: VoiceChoice[];
  defaultVoiceId: string | null;
};

function readVoiceChoices(value: unknown): VoiceChoice[] {
  if (!Array.isArray(value) || value.length > 32) return [];
  const choices: VoiceChoice[] = [];
  const ids = new Set<string>();
  for (const choice of value) {
    if (
      !choice ||
      typeof choice !== "object" ||
      typeof choice.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(choice.id) ||
      ids.has(choice.id) ||
      typeof choice.label !== "string" ||
      !choice.label.trim() ||
      choice.label.length > 80 ||
      Array.from(choice.label as string).some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      typeof choice.available !== "boolean"
    )
      return [];
    ids.add(choice.id);
    choices.push({ id: choice.id, label: choice.label.trim(), available: choice.available });
  }
  return choices;
}

function conversationAvailable(capabilities: VoiceCapabilities | null, voiceId: string): boolean {
  return Boolean(
    capabilities?.conversation &&
    capabilities.voices.some((voice) => voice.available && voice.id === voiceId),
  );
}

function preferredVoice(userId: string, voices: VoiceChoice[], defaultId: string | null): string {
  const fallback =
    voices.find((voice) => voice.available && voice.id === defaultId)?.id ??
    voices.find((voice) => voice.available)?.id ??
    "";
  const storage = safeBrowserStorage("localStorage");
  const key = principalScopedStorageKey(VOICE_PREFERENCE_KEY, userId);
  if (!storage || !key) return fallback;
  try {
    const saved = storage.getItem(key);
    if (saved && voices.some((voice) => voice.id === saved && voice.available)) return saved;
    if (saved !== null) storage.removeItem(key);
  } catch {
    // Sandboxed or full storage must not prevent using the server's catalog.
  }
  return fallback;
}
type Phase =
  | "idle"
  | "requesting"
  | "recording"
  | "stopping"
  | "transcribing"
  | "chat"
  | "speaking"
  | "synthesizing";
type OperationScope = {
  generation: number;
  userId: string;
  contextKey: string;
  voiceId?: string;
};

export interface ComposerVoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | null;
  contextKey: string;
  disabled: boolean;
  onTranscript: (text: string) => void;
  mode?: "dictate" | "voice";
  onVoiceSubmit?: (text: string, signal: AbortSignal) => Promise<ComposerVoiceTurn>;
  latestAssistantText?: string;
  isStreaming: boolean;
  conversationModelControl?: ReactNode;
  onCloseAutoFocus?: ComponentPropsWithoutRef<typeof DialogContent>["onCloseAutoFocus"];
}

async function voiceError(response: Response, fallback: string): Promise<string> {
  const messages: Record<string, string> = {
    account_changed: "Your account changed. Close voice and open it again.",
    email_verification_required: "Verify your email address before using voice.",
    voice_not_configured: "Voice is not available yet. Keep typing in the meantime.",
    voice_provider_rate_limited: "Voice is busy right now. Please try again later.",
    voice_provider_unavailable:
      "The voice service is unavailable right now. Please try again later.",
    voice_invalid_response: "The voice service returned an unreadable result. Please try again.",
    voice_timeout: "The voice request timed out. Please try again.",
    voice_cancelled: "The voice request was cancelled.",
    audio_duration_exceeded:
      "This recording is longer than 60 seconds. Please record a shorter message.",
    session_expired: "Your session expired. Sign in again to use voice.",
    request_too_large: "This recording or reply is too large. Use a shorter recording or reply.",
    invalid_audio: "This audio could not be read. Please record again in a supported browser.",
    invalid_text: "There is no reply text available to read aloud.",
    invalid_voice: "This voice is no longer available. Reopen voice to refresh your choices.",
    voice_plan_required:
      "This voice is not available for your current plan. Reopen voice to refresh your choices or view plans.",
  };
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && messages[body.error]) return messages[body.error];
  } catch {
    // A proxy or disconnected preview may return HTML rather than JSON.
  }
  if (response.status === 401) return "Sign in again to use voice.";
  if (response.status === 403) return "Voice is not available for this account right now.";
  if (response.status === 409) return messages.account_changed;
  if (response.status === 429)
    return "Your voice usage limit has been reached. Please try again later.";
  if (response.status === 503) return "Voice is temporarily unavailable. Please try again later.";
  return fallback;
}

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function ComposerVoiceDialog({
  open,
  onOpenChange,
  userId,
  contextKey,
  disabled,
  onTranscript,
  mode = "dictate",
  onVoiceSubmit,
  latestAssistantText = "",
  isStreaming,
  conversationModelControl,
  onCloseAutoFocus,
}: ComposerVoiceDialogProps) {
  const transcriptId = useId();
  const voicePickerId = useId();
  const voiceHelpId = useId();
  const [capabilities, setCapabilities] = useState<VoiceCapabilities | null>(null);
  const [checking, setChecking] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState("");
  const [hasTranscript, setHasTranscript] = useState(false);
  const [canRetryRecording, setCanRetryRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [audioUrl, setAudioUrl] = useState("");
  const [capabilityAttempt, setCapabilityAttempt] = useState(0);
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  const [preferenceNotice, setPreferenceNotice] = useState("");
  const [lastVoiceReply, setLastVoiceReply] = useState("");

  const current = useRef({
    open,
    userId,
    contextKey,
    disabled,
    isStreaming,
    latestAssistantText,
    mode,
    onVoiceSubmit,
    onOpenChange,
  });
  current.current = {
    open,
    userId,
    contextKey,
    disabled,
    isStreaming,
    latestAssistantText,
    mode,
    onVoiceSubmit,
    onOpenChange,
  };
  const streamingBlocked = mode !== "voice" && isStreaming;
  const mounted = useRef(false);
  const closing = useRef(false);
  const generation = useRef(0);
  const phaseRef = useRef<Phase>("idle");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const audioBytes = useRef(0);
  const retainedRecording = useRef<Blob | null>(null);
  const request = useRef<AbortController | null>(null);
  const configRequest = useRef<AbortController | null>(null);
  const recordingDeadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingClock = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestDeadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef("");
  const voiceCatalog = useRef<VoiceChoice[]>([]);
  const selectedVoice = useRef("");
  const defaultVoice = useRef("");
  const voiceSessionActive = useRef(false);
  const voicePlayback = useRef<ReturnType<typeof createSpeechPlayback> | null>(null);
  const resumeRecording = useRef<((continuing?: boolean) => Promise<void>) | null>(null);
  const billingAfterClose = useRef<{
    userId: string;
    contextKey: string;
    handled?: boolean;
  } | null>(null);

  const updatePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clearRecordingTimers = useCallback(() => {
    if (recordingDeadline.current !== null) clearTimeout(recordingDeadline.current);
    if (recordingClock.current !== null) clearInterval(recordingClock.current);
    recordingDeadline.current = null;
    recordingClock.current = null;
  }, []);

  const releasePlayback = useCallback(() => {
    if (player.current) {
      player.current.pause();
      player.current.removeAttribute("src");
      player.current.load();
    }
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = "";
  }, []);

  const releaseResources = useCallback(() => {
    // Invalidate pending microphone prompts as well as requests before stopping
    // resources. A late getUserMedia result must immediately stop its own tracks.
    generation.current += 1;
    voiceSessionActive.current = false;
    const activePlayback = voicePlayback.current;
    voicePlayback.current = null;
    activePlayback?.stop();
    request.current?.abort();
    configRequest.current?.abort();
    request.current = null;
    configRequest.current = null;
    if (requestDeadline.current !== null) clearTimeout(requestDeadline.current);
    requestDeadline.current = null;
    clearRecordingTimers();
    const activeRecorder = recorder.current;
    recorder.current = null;
    if (activeRecorder) {
      activeRecorder.ondataavailable = null;
      activeRecorder.onstop = null;
      activeRecorder.onerror = null;
      try {
        if (activeRecorder.state !== "inactive") activeRecorder.stop();
      } catch {
        // Track and request cleanup must still run if the recorder already ended.
      }
    }
    stopTracks(stream.current);
    stream.current = null;
    chunks.current = [];
    audioBytes.current = 0;
    retainedRecording.current = null;
    phaseRef.current = "idle";
    releasePlayback();
  }, [clearRecordingTimers, releasePlayback]);

  const isCurrent = useCallback((scope: OperationScope) => {
    const value = current.current;
    return (
      mounted.current &&
      !closing.current &&
      generation.current === scope.generation &&
      (scope.voiceId === undefined || selectedVoice.current === scope.voiceId) &&
      value.open &&
      !value.disabled &&
      (!value.isStreaming ||
        (value.mode === "voice" && voiceSessionActive.current && phaseRef.current === "chat")) &&
      value.userId === scope.userId &&
      value.contextKey === scope.contextKey
    );
  }, []);

  useLayoutEffect(() => {
    mounted.current = true;
    closing.current = !open;
    releaseResources();
    setCapabilities(null);
    voiceCatalog.current = [];
    selectedVoice.current = "";
    defaultVoice.current = "";
    setSelectedVoiceId("");
    setPreferenceNotice("");
    setLastVoiceReply("");
    if (open) billingAfterClose.current = null;
    setChecking(false);
    setError("");
    setTranscript("");
    setHasTranscript(false);
    setCanRetryRecording(false);
    setElapsed(0);
    setAudioUrl("");
    updatePhase("idle");
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (open && userId && !disabled && !current.current.isStreaming) {
      const scope = { generation: generation.current, userId, contextKey };
      const controller = new AbortController();
      configRequest.current = controller;
      setChecking(true);
      timeout = setTimeout(() => controller.abort(), 15_000);
      void (async () => {
        try {
          const response = await authFetch("/api/voice", {
            signal: controller.signal,
            headers: { "X-Kova-Voice-Owner": scope.userId },
          });
          if (!isCurrent(scope)) return;
          if (!response.ok)
            throw new Error(await voiceError(response, "Voice is unavailable right now."));
          const result = (await response.json()) as Partial<VoiceCapabilities>;
          if (!isCurrent(scope)) return;
          const voices = readVoiceChoices(result.voices);
          const defaultId =
            typeof result.defaultVoiceId === "string" ? result.defaultVoiceId : null;
          voiceCatalog.current = voices;
          defaultVoice.current =
            voices.find((voice) => voice.available && voice.id === defaultId)?.id ??
            voices.find((voice) => voice.available)?.id ??
            "";
          const selection = preferredVoice(scope.userId, voices, defaultId);
          selectedVoice.current = selection;
          setSelectedVoiceId(selection);
          setCapabilities({
            voices,
            defaultVoiceId: defaultId,
            configured: result.configured === true,
            stt: result.stt === true,
            tts: result.tts === true,
            sts: result.sts === true,
            conversation: result.conversation === true,
          });
        } catch (cause) {
          if (isCurrent(scope)) {
            setError(
              controller.signal.aborted
                ? "Checking voice availability timed out. Try again."
                : cause instanceof Error
                  ? cause.message
                  : "Voice is unavailable right now.",
            );
          }
        } finally {
          clearTimeout(timeout);
          if (isCurrent(scope)) {
            configRequest.current = null;
            setChecking(false);
          }
        }
      })();
    }

    return () => {
      mounted.current = false;
      clearTimeout(timeout);
      releaseResources();
    };
  }, [
    open,
    userId,
    contextKey,
    disabled,
    streamingBlocked,
    mode,
    capabilityAttempt,
    releaseResources,
    isCurrent,
    updatePhase,
  ]);

  const cancelOperation = useCallback(() => {
    releaseResources();
    updatePhase("idle");
    setCanRetryRecording(false);
    setElapsed(0);
    setAudioUrl("");
    setError("");
  }, [releaseResources, updatePhase]);

  const failOperation = useCallback(
    (message: string) => {
      const savedRecording = retainedRecording.current;
      releaseResources();
      retainedRecording.current = savedRecording;
      setCanRetryRecording(Boolean(savedRecording));
      updatePhase("idle");
      setAudioUrl("");
      setError(message);
    },
    [releaseResources, updatePhase],
  );

  useLayoutEffect(() => {
    if (mode === "voice") return;
    if (phaseRef.current === "synthesizing") cancelOperation();
    else {
      releasePlayback();
      setAudioUrl("");
    }
  }, [latestAssistantText, mode, cancelOperation, releasePlayback]);

  const stopReplyPlayback = useCallback(() => {
    if (phaseRef.current === "synthesizing") {
      generation.current += 1;
      request.current?.abort();
      request.current = null;
      if (requestDeadline.current !== null) clearTimeout(requestDeadline.current);
      requestDeadline.current = null;
      updatePhase("idle");
    }
    releasePlayback();
    setAudioUrl("");
  }, [releasePlayback, updatePhase]);

  useLayoutEffect(() => {
    if (!open || !userId) return;
    const resetPreference = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, userId)) return;
      cancelOperation();
      closing.current = true;
      setTranscript("");
      setHasTranscript(false);
      setLastVoiceReply("");
      selectedVoice.current = defaultVoice.current;
      setSelectedVoiceId(defaultVoice.current);
      setPreferenceNotice("");
      current.current.onOpenChange(false);
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, resetPreference);
    return () =>
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, resetPreference);
  }, [open, userId, contextKey, cancelOperation]);

  useLayoutEffect(() => {
    if (!open) return;
    const leavePage = () => {
      closing.current = true;
      cancelOperation();
      current.current.onOpenChange(false);
    };
    window.addEventListener("pagehide", leavePage);
    return () => window.removeEventListener("pagehide", leavePage);
  }, [open, cancelOperation]);

  useLayoutEffect(() => {
    if (
      mode === "voice" &&
      isStreaming &&
      (!voiceSessionActive.current || phaseRef.current !== "chat")
    )
      cancelOperation();
  }, [mode, isStreaming, cancelOperation]);

  const beginRequest = (timeout = REQUEST_TIMEOUT_MS) => {
    const controller = new AbortController();
    request.current = controller;
    requestDeadline.current = setTimeout(() => controller.abort(), timeout);
    return controller;
  };

  const finishRequest = (controller: AbortController) => {
    if (request.current !== controller) return;
    request.current = null;
    if (requestDeadline.current !== null) clearTimeout(requestDeadline.current);
    requestDeadline.current = null;
  };

  const submitVoiceTurn = async (scope: OperationScope, text: string) => {
    const submit = current.current.onVoiceSubmit;
    if (!isCurrent(scope) || !voiceSessionActive.current || !submit) return;
    updatePhase("chat");
    const controller = beginRequest(120_000);
    let abortListener: (() => void) | undefined;
    try {
      const aborted = new Promise<never>((_resolve, reject) => {
        abortListener = () => reject(new Error("voice_turn_cancelled"));
        controller.signal.addEventListener("abort", abortListener, { once: true });
        if (controller.signal.aborted) abortListener();
      });
      const reply = await Promise.race([submit(text, controller.signal), aborted]);
      if (!isCurrent(scope) || controller.signal.aborted || !voiceSessionActive.current) return;
      if (
        !reply ||
        reply.ownerId !== scope.userId ||
        typeof reply.chatId !== "string" ||
        !reply.chatId ||
        typeof reply.messageId !== "string" ||
        !reply.messageId ||
        typeof reply.content !== "string" ||
        !reply.content.trim() ||
        typeof reply.contentSha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(reply.contentSha256)
      ) {
        throw new Error("voice_turn_unconfirmed");
      }
      if (reply.content.length > 4000) throw new Error("voice_reply_too_long");
      finishRequest(controller);
      setLastVoiceReply(reply.content);
      updatePhase("speaking");
      let ended = false;
      let started = false;
      const playback = createSpeechPlayback({
        fetchImpl: authFetch,
        createSink: createBrowserSpeechSink,
        onEnded: (completed) => {
          if (
            !isCurrent(scope) ||
            voicePlayback.current !== playback ||
            !voiceSessionActive.current ||
            completed.ownerId !== reply.ownerId ||
            completed.chatId !== reply.chatId ||
            completed.messageId !== reply.messageId ||
            completed.contentSha256 !== reply.contentSha256
          )
            return;
          ended = true;
          voicePlayback.current = null;
          updatePhase("idle");
          // Only the shared manager's current natural-ended receipt advances
          // the explicit session. Stop, stale sink callbacks and byte completion
          // cannot request another microphone turn.
          void resumeRecording.current?.(true);
        },
        onState: (state, code) => {
          if (!isCurrent(scope) || voicePlayback.current !== playback) return;
          if (state === "loading") started = true;
          if (state === "error") {
            const messages: Record<string, string> = {
              speech_message_not_synced:
                "The reply is not available in saved history. Use chat to review it before trying Voice again.",
              speech_text_too_long:
                "This reply is too long to speak. Read it in chat, then start a new voice turn.",
              speech_unauthorized: "Your voice session ended. Sign in again before starting Voice.",
              speech_not_available: "Read aloud is not configured. Your reply remains in chat.",
              speech_limit_reached:
                "Your Read aloud limit has been reached. Your reply remains in chat.",
            };
            failOperation(
              messages[code ?? ""] ??
                "The reply could not be played. Your reply remains in chat. Start Voice again when you are ready.",
            );
          } else if (state === "idle" && started && !ended) {
            // The shared player emits idle immediately before an error. Let
            // its error notification run before treating an external Stop as
            // a paused session; neither path restarts microphone capture.
            void Promise.resolve().then(() => {
              if (!isCurrent(scope) || voicePlayback.current !== playback || ended) return;
              voicePlayback.current = null;
              voiceSessionActive.current = false;
              updatePhase("idle");
            });
          }
        },
      });
      voicePlayback.current = playback;
      await playback.start({
        ownerId: reply.ownerId,
        chatId: reply.chatId,
        messageId: reply.messageId,
        contentSha256: reply.contentSha256,
        ...(scope.voiceId ? { voiceId: scope.voiceId } : {}),
      });
    } catch (cause) {
      if (!isCurrent(scope)) return;
      const code = cause instanceof Error ? cause.message : "";
      failOperation(
        controller.signal.aborted
          ? "This voice turn timed out. Your conversation remains in chat. Start again when you are ready."
          : code === "voice_reply_too_long"
            ? "This reply is too long to speak. Read it in chat, then start a new voice turn."
            : "This voice turn could not be completed and saved. Review the conversation in chat before trying again.",
      );
    } finally {
      if (abortListener) controller.signal.removeEventListener("abort", abortListener);
      finishRequest(controller);
    }
  };

  const transcribeRecording = async (scope: OperationScope, original: Blob) => {
    if (!isCurrent(scope)) return;
    retainedRecording.current = original;
    setCanRetryRecording(false);
    updatePhase("transcribing");
    const controller = beginRequest();
    try {
      const audio = await prepareVoiceRecording(original, { signal: controller.signal });
      if (!isCurrent(scope)) return;
      const body = new FormData();
      body.append("action", "stt");
      body.append("audio", new File([audio], "recording.wav", { type: "audio/wav" }));
      const response = await authFetch("/api/voice", {
        method: "POST",
        signal: controller.signal,
        headers: { "X-Kova-Voice-Owner": scope.userId },
        body,
      });
      if (!isCurrent(scope)) return;
      if (!response.ok)
        throw new Error(await voiceError(response, "Your recording could not be transcribed."));
      const result = (await response.json()) as { text?: unknown };
      if (!isCurrent(scope)) return;
      if (typeof result.text !== "string" || !result.text.trim()) {
        throw new Error("No speech was detected. Try speaking a little closer to your microphone.");
      }
      retainedRecording.current = null;
      setCanRetryRecording(false);
      setTranscript(result.text.trim());
      setHasTranscript(true);
      finishRequest(controller);
      if (current.current.mode === "voice" && voiceSessionActive.current)
        await submitVoiceTurn(scope, result.text.trim());
      else updatePhase("idle");
    } catch (cause) {
      if (isCurrent(scope)) {
        failOperation(
          controller.signal.aborted
            ? "Transcription timed out. You can retry this recording."
            : cause instanceof Error
              ? cause.message
              : "Your recording could not be transcribed.",
        );
      }
    } finally {
      finishRequest(controller);
    }
  };

  const transcribe = async (scope: OperationScope, mimeType: string) => {
    if (!isCurrent(scope)) return;
    const blob = new Blob(chunks.current, { type: mimeType || "audio/webm" });
    chunks.current = [];
    audioBytes.current = 0;
    if (blob.size === 0) {
      failOperation("No audio was recorded. Check your microphone and try again.");
      return;
    }
    if (blob.size > MAX_AUDIO_BYTES) {
      failOperation("Recording exceeded the 8 MB limit. Try a shorter recording.");
      return;
    }
    await transcribeRecording(scope, blob);
  };

  const retryTranscription = () => {
    if (!userId || !retainedRecording.current || !capabilities?.stt || phaseRef.current !== "idle")
      return;
    const scope = {
      generation: generation.current,
      userId,
      contextKey,
      voiceId: selectedVoice.current,
    };
    if (!isCurrent(scope)) return;
    if (mode === "voice") {
      if (!onVoiceSubmit || !conversationAvailable(capabilities, selectedVoice.current)) return;
      voiceSessionActive.current = true;
    }
    setError("");
    void transcribeRecording(scope, retainedRecording.current);
  };

  const stopRecording = () => {
    if (phaseRef.current !== "recording" || recorder.current?.state !== "recording") return;
    updatePhase("stopping");
    clearRecordingTimers();
    recorder.current.stop();
    stopTracks(stream.current);
    stream.current = null;
  };

  const startRecording = async (continuing = false) => {
    if (!userId || !capabilities?.configured || !capabilities.stt || phaseRef.current !== "idle")
      return;
    if (
      mode === "voice" &&
      (!onVoiceSubmit ||
        !conversationAvailable(capabilities, selectedVoice.current) ||
        (continuing && !voiceSessionActive.current))
    )
      return;
    const scope = {
      generation: generation.current,
      userId,
      contextKey,
      voiceId: selectedVoice.current,
    };
    if (!isCurrent(scope)) return;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(
        "This browser does not support microphone recording. Try a supported browser on a secure connection, or keep typing.",
      );
      return;
    }
    stopActiveSpeechPlayback();
    if (mode === "voice") voiceSessionActive.current = true;
    releasePlayback();
    retainedRecording.current = null;
    setCanRetryRecording(false);
    setAudioUrl("");
    setError("");
    setElapsed(0);
    updatePhase("requesting");
    let acquired: MediaStream | null = null;
    try {
      // Capture starts only after explicit Start, or after actual playback ends
      // within that same still-active Voice session.
      acquired = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!isCurrent(scope)) {
        stopTracks(acquired);
        return;
      }
      stream.current = acquired;
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const next = new MediaRecorder(acquired, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 64_000,
      });
      recorder.current = next;
      chunks.current = [];
      audioBytes.current = 0;
      next.ondataavailable = (event) => {
        if (!isCurrent(scope) || !event.data.size) return;
        audioBytes.current += event.data.size;
        if (audioBytes.current > MAX_AUDIO_BYTES) {
          failOperation("Recording exceeded the 8 MB limit. Try a shorter recording.");
          return;
        }
        chunks.current.push(event.data);
      };
      next.onerror = () => {
        if (isCurrent(scope)) failOperation("The microphone recording failed. Please try again.");
      };
      next.onstop = () => {
        if (!isCurrent(scope)) return;
        clearRecordingTimers();
        stopTracks(stream.current);
        stream.current = null;
        recorder.current = null;
        void transcribe(scope, next.mimeType || mimeType || "audio/webm");
      };
      next.start(250);
      updatePhase("recording");
      const started = Date.now();
      recordingClock.current = setInterval(() => {
        if (isCurrent(scope)) setElapsed(Math.min(59, Math.floor((Date.now() - started) / 1000)));
      }, 250);
      recordingDeadline.current = setTimeout(stopRecording, MAX_RECORDING_MS);
    } catch (cause) {
      stopTracks(acquired);
      if (!isCurrent(scope)) return;
      const name = cause instanceof Error ? cause.name : "";
      failOperation(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Microphone access was denied. You can allow it in your browser settings and try again, or keep typing."
          : name === "NotFoundError"
            ? "No microphone was found. Connect one and try again, or keep typing."
            : "Your microphone could not start. Check that it is connected and not being used by another app.",
      );
    }
  };

  resumeRecording.current = startRecording;

  const readLatestReply = async () => {
    const text = latestAssistantText.trim();
    const voiceId = selectedVoice.current;
    if (
      !userId ||
      !capabilities?.configured ||
      !capabilities.tts ||
      !voiceCatalog.current.some((voice) => voice.id === voiceId && voice.available) ||
      phaseRef.current !== "idle" ||
      !text
    )
      return;
    const scope = { generation: generation.current, userId, contextKey };
    if (!isCurrent(scope)) return;
    if (text.length > MAX_REPLY_CHARACTERS) {
      setError(
        "This reply is too long to read aloud. Voice playback supports replies up to 5,000 characters.",
      );
      return;
    }
    releasePlayback();
    setAudioUrl("");
    setError("");
    updatePhase("synthesizing");
    const controller = beginRequest();
    try {
      const response = await authFetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Kova-Voice-Owner": scope.userId },
        signal: controller.signal,
        body: JSON.stringify({ action: "tts", text, voiceId }),
      });
      if (!isCurrent(scope)) return;
      if (!response.ok)
        throw new Error(await voiceError(response, "This reply could not be read aloud."));
      const blob = await response.blob();
      if (!isCurrent(scope)) return;
      if (!blob.size || !blob.type.startsWith("audio/"))
        throw new Error("No playable audio was returned. Please try again.");
      if (
        current.current.latestAssistantText.trim() !== text ||
        selectedVoice.current !== voiceId
      ) {
        updatePhase("idle");
        return;
      }
      objectUrl.current = URL.createObjectURL(blob);
      setAudioUrl(objectUrl.current);
      updatePhase("idle");
    } catch (cause) {
      if (isCurrent(scope)) {
        failOperation(
          controller.signal.aborted
            ? "Voice playback timed out. Please try again."
            : cause instanceof Error
              ? cause.message
              : "This reply could not be read aloud.",
        );
      }
    } finally {
      finishRequest(controller);
    }
  };

  const closeDialog = (next: boolean) => {
    if (!next) {
      closing.current = true;
      releaseResources();
    }
    onOpenChange(next);
  };
  const changeVoice = (id: string) => {
    if (!userId || (phaseRef.current !== "idle" && phaseRef.current !== "synthesizing")) return;
    const scope = { generation: generation.current, userId, contextKey };
    if (!isCurrent(scope)) return;
    const choice = voiceCatalog.current.find((voice) => voice.id === id);
    if (!choice) return;
    if (!choice.available) {
      billingAfterClose.current = { userId, contextKey };
      closeDialog(false);
      return;
    }
    stopReplyPlayback();
    selectedVoice.current = choice.id;
    setSelectedVoiceId(choice.id);
    setError("");
    setPreferenceNotice("");
    const key = principalScopedStorageKey(VOICE_PREFERENCE_KEY, scope.userId);
    const storage = safeBrowserStorage("localStorage");
    try {
      if (!key || !storage) throw new Error("storage_unavailable");
      storage.setItem(key, choice.id);
    } catch {
      setPreferenceNotice(
        "Your voice choice applies for this session, but could not be saved on this device.",
      );
    }
  };

  const handleCloseAutoFocus: NonNullable<ComposerVoiceDialogProps["onCloseAutoFocus"]> = (
    event,
  ) => {
    const target = billingAfterClose.current;
    if (!target) {
      onCloseAutoFocus?.(event);
      return;
    }
    event.preventDefault();
    if (target.handled) return;
    billingAfterClose.current = { ...target, handled: true };
    if (
      current.current.userId === target.userId &&
      current.current.contextKey === target.contextKey
    ) {
      // Open billing only after this dialog releases its focus trap. Do not
      // restore focus to the composer over the newly opened settings dialog.
      window.dispatchEvent(new CustomEvent("kova-open-settings", { detail: { tab: "billing" } }));
    }
  };

  const useTranscript = () => {
    if (!userId || !transcript.trim() || phaseRef.current !== "idle") return;
    const scope = { generation: generation.current, userId, contextKey };
    if (!isCurrent(scope)) return;
    closing.current = true;
    onTranscript(transcript.trim());
    closeDialog(false);
  };

  const unavailable =
    !userId || disabled || (isStreaming && !(mode === "voice" && voiceSessionActive.current));
  const busy = phase !== "idle";
  const status =
    phase === "chat"
      ? "Waiting for your chat reply and saved history…"
      : phase === "speaking"
        ? "Speaking the saved reply…"
        : phase === "requesting"
          ? "Waiting for microphone permission…"
          : phase === "recording"
            ? `Recording · ${elapsed}s of 59s`
            : phase === "stopping"
              ? "Finishing recording…"
              : phase === "transcribing"
                ? "Preparing and transcribing your recording…"
                : phase === "synthesizing"
                  ? "Preparing reply audio…"
                  : audioUrl
                    ? "Reply audio is ready. Press Play to listen."
                    : transcript
                      ? "Review your transcript before adding it to chat."
                      : "Ready when you are.";

  const conversationReady = conversationAvailable(capabilities, selectedVoiceId);
  const ready =
    !unavailable &&
    !checking &&
    capabilities?.configured &&
    (mode !== "voice" || conversationReady);

  return (
    <ComposerVoiceDialogView
      open={open}
      onOpenChange={closeDialog}
      onCloseAutoFocus={handleCloseAutoFocus}
      phase={phase}
      mode={mode}
      status={status}
      availability={
        !userId
          ? "guest"
          : disabled
            ? "disabled"
            : unavailable && isStreaming
              ? "streaming"
              : checking
                ? "checking"
                : capabilities
                  ? capabilities.configured && (mode !== "voice" || conversationReady)
                    ? "ready"
                    : "unconfigured"
                  : "error"
      }
      hasTranscript={hasTranscript}
      microphoneAvailable={capabilities?.stt ?? false}
      replyAvailable={mode === "voice" ? false : (capabilities?.tts ?? false)}
      error={error}
      conversationModelControl={conversationModelControl}
      voicePicker={
        !unavailable && !checking && capabilities && capabilities.voices.length > 0 ? (
          <>
            <label htmlFor={voicePickerId} className="sr-only">
              Reply voice
            </label>
            <Select
              value={selectedVoiceId}
              onValueChange={changeVoice}
              disabled={busy && phase !== "synthesizing"}
            >
              <SelectTrigger
                id={voicePickerId}
                aria-describedby={voiceHelpId}
                className="kova-voice-picker-trigger min-h-11"
              >
                <SelectValue placeholder="Choose a voice" />
              </SelectTrigger>
              <SelectContent
                className="max-h-64"
                onCloseAutoFocus={(event) => {
                  if (closing.current) event.preventDefault();
                }}
              >
                {capabilities.voices.map((voice) => (
                  <SelectItem
                    key={voice.id}
                    value={voice.id}
                    className="min-h-11 whitespace-normal"
                  >
                    <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
                      <span>{voice.label}</span>
                      {!voice.available && (
                        <>
                          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                          <span className="text-xs text-muted-foreground">View plans</span>
                        </>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p id={voiceHelpId} className="sr-only">
              Choose a sound. Available voices depend on your plan.
            </p>
            {preferenceNotice && (
              <p role="status" className="kova-voice-preference-notice">
                {preferenceNotice}
              </p>
            )}
          </>
        ) : undefined
      }
      recordingControl={
        ready ? (
          phase === "recording" ? (
            <Button
              type="button"
              onClick={stopRecording}
              title={mode === "voice" ? "Finish turn" : "Stop and transcribe"}
            >
              <Square aria-hidden="true" />
              <span className="sr-only">
                {mode === "voice" ? "Finish turn" : "Stop and transcribe"}
              </span>
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => void startRecording()}
              disabled={busy || !capabilities.stt || (mode === "voice" && !onVoiceSubmit)}
              title={
                mode === "voice" ? "Start" : hasTranscript ? "Record again" : "Start recording"
              }
            >
              <Mic aria-hidden="true" />
              <span className="sr-only">
                {mode === "voice" ? "Start" : hasTranscript ? "Record again" : "Start recording"}
              </span>
            </Button>
          )
        ) : undefined
      }
      retryControl={
        ready && canRetryRecording ? (
          <Button
            type="button"
            variant="ghost"
            onClick={retryTranscription}
            disabled={busy || !capabilities.stt}
          >
            Retry transcription
          </Button>
        ) : undefined
      }
      cancelControl={
        ready && (busy || canRetryRecording) ? (
          <Button type="button" variant="ghost" onClick={cancelOperation}>
            {mode === "voice" ? "Stop" : "Cancel"}
          </Button>
        ) : undefined
      }
      transcriptReview={
        ready && hasTranscript ? (
          <>
            <label htmlFor={transcriptId}>
              {mode === "voice" ? "Transcript" : "Review transcript"}
            </label>
            <Textarea
              id={transcriptId}
              value={transcript}
              onChange={(event) => setTranscript(event.target.value)}
              disabled={busy}
              readOnly={mode === "voice"}
              rows={4}
            />
            <p>
              {mode === "voice"
                ? "Transcript for this voice turn. Your composer draft stays separate; review chat for send and save status."
                : "Use in chat adds this text to your draft. It does not send a message."}
            </p>
          </>
        ) : undefined
      }
      replyControl={
        ready && mode === "voice" && !capabilities.stt ? (
          <p>Microphone transcription is not configured. You can keep typing in chat.</p>
        ) : ready && mode === "dictate" ? (
          <>
            {!capabilities.stt && <p>Microphone transcription is not configured.</p>}
            {latestAssistantText.trim() && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void readLatestReply()}
                  disabled={
                    busy ||
                    !capabilities.tts ||
                    !capabilities.voices.some(
                      (voice) => voice.available && voice.id === selectedVoiceId,
                    )
                  }
                >
                  <Volume2 aria-hidden="true" /> Read latest completed reply
                </Button>
                {(!capabilities.tts || !selectedVoiceId) && (
                  <p>
                    {capabilities.voices.length === 0
                      ? "No reply voices are configured."
                      : !selectedVoiceId
                        ? "No reply voice is available for your current plan."
                        : "Reply playback is not configured."}
                  </p>
                )}
              </>
            )}
          </>
        ) : undefined
      }
      voiceReply={mode === "voice" && lastVoiceReply ? lastVoiceReply : undefined}
      audioPlayer={
        ready && audioUrl ? (
          <audio
            ref={player}
            src={audioUrl}
            controls
            preload="metadata"
            aria-label="Reply audio playback"
            onError={() => {
              if (objectUrl.current === audioUrl && current.current.open) {
                setError("This browser could not play the audio. Try again.");
              }
            }}
          />
        ) : undefined
      }
      useTranscriptControl={
        mode === "dictate" && hasTranscript && !unavailable ? (
          <Button type="button" onClick={useTranscript} disabled={busy || !transcript.trim()}>
            Use in chat
          </Button>
        ) : undefined
      }
      availabilityRetry={
        !unavailable && !checking && !capabilities && error ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setCapabilityAttempt((value) => value + 1)}
          >
            Check again
          </Button>
        ) : undefined
      }
    />
  );
}
