import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";
import { ArrowUp, Mic, Square, Volume2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { DialogContent } from "@/components/ui/dialog";
import { ComposerVoiceDialogView } from "@/components/ComposerVoiceDialogView";
import { ComposerDictationView } from "@/components/ComposerDictationView";
import { Textarea } from "@/components/ui/textarea";
import {
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  isPrincipalBrowserStorageClearedEvent,
} from "@/lib/principal-browser-storage.mjs";
import { authFetch } from "@/lib/auth-fetch";
import { prepareVoiceRecording } from "@/lib/voice-recording";
import {
  preferredVoice,
  preferredVoiceGlow,
  readVoiceChoices,
  type VoiceChoice,
} from "@/lib/voice/preference";
import { listenForVoiceTurn } from "@/lib/voice/realtime-client";
import { createVoiceSilenceGate } from "@/lib/voice/speech-pause.mjs";
import {
  createBrowserSpeechSink,
  createSpeechPlayback,
  stopActiveSpeechPlayback,
} from "@/lib/speech-playback.mjs";
import type { ComposerVoiceSubmit, ComposerVoiceTurn } from "@/lib/composer-voice-turn";
import { createAckCache } from "@/lib/voice/acknowledgments.mjs";
import { createBargeInDetector } from "@/lib/voice/barge-in.mjs";
import { createStreamingVoicePlayback } from "@/lib/voice/streaming-playback.mjs";
import { createVoiceLatencyTracker } from "@/lib/voice/voice-latency.mjs";

// In-memory only: no text, audio or identifiers. Read it from the console with
// window.__kovaVoiceLatency.summary() to get p50/p95 on a real device.
const ackCache = createAckCache();
const latencyTracker = createVoiceLatencyTracker();
if (typeof window !== "undefined")
  (window as unknown as { __kovaVoiceLatency?: unknown }).__kovaVoiceLatency = {
    summary: () => latencyTracker.summary(),
    records: () => latencyTracker.records(),
  };

function speechErrorMessage(code: string | undefined) {
  const messages: Record<string, string> = {
    speech_message_not_synced:
      "The reply is not available in saved history. Use chat to review it before trying Voice again.",
    speech_not_eligible:
      "This reply is not from a voice-enabled model. Your reply remains in chat.",
    speech_text_too_long:
      "This reply is too long to speak. Read it in chat, then start a new voice turn.",
    speech_unauthorized: "Your voice session ended. Sign in again before starting Voice.",
    speech_not_available: "Read aloud is not configured. Your reply remains in chat.",
    speech_limit_reached: "Your Read aloud limit has been reached. Your reply remains in chat.",
  };
  return (
    messages[code ?? ""] ??
    "The reply could not be played. Your reply remains in chat. Start Voice again when you are ready."
  );
}

// Leave room for codec finalization beneath the server's hard 60-second limit.
const MAX_RECORDING_MS = 59_000;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_REPLY_CHARACTERS = 4_000;
const REQUEST_TIMEOUT_MS = 60_000;

type VoiceCapabilities = {
  configured: boolean;
  stt: boolean;
  tts: boolean;
  sts: boolean;
  conversation: boolean;
  realtime?: boolean;
  voices: VoiceChoice[];
  defaultVoiceId: string | null;
};

function conversationAvailable(capabilities: VoiceCapabilities | null, voiceId: string): boolean {
  return Boolean(
    capabilities?.conversation &&
    capabilities.voices.some((voice) => voice.available && voice.id === voiceId),
  );
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
  inlineDictation?: boolean;
  autoStartVoice?: boolean;
  onVoiceSubmit?: ComposerVoiceSubmit;
  onVoicePlaybackProgress?: (fraction: number | null) => void;
  latestAssistantText?: string;
  latestAssistantReply?: { chatId: string; messageId: string; content: string };
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

function canListenInRealtime() {
  return typeof AudioWorkletNode !== "undefined" && typeof AudioContext !== "undefined";
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
  inlineDictation = false,
  autoStartVoice = false,
  onVoiceSubmit,
  onVoicePlaybackProgress,
  latestAssistantText = "",
  latestAssistantReply,
  isStreaming,
  conversationModelControl,
  onCloseAutoFocus,
}: ComposerVoiceDialogProps) {
  const transcriptId = useId();
  const voiceGlow = useRef<HTMLDivElement>(null);
  const glowTarget = useRef(0);
  const updateGlow = (level: number) => {
    glowTarget.current = 1 - Math.exp(-9 * Math.max(0, level - 0.002));
  };

  const [realtimeFailed, setRealtimeFailed] = useState(false);
  const [capabilities, setCapabilities] = useState<VoiceCapabilities | null>(null);
  const [checking, setChecking] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  useLayoutEffect(() => {
    if (
      typeof requestAnimationFrame === "undefined" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    )
      return;
    let smoothed = 0;
    let previous = performance.now();
    let frame: number;
    const animate = (now: number) => {
      const elapsed = Math.max(0, Math.min(64, now - previous));
      previous = now;
      // Listening and speaking are driven by audio levels. While Kova is thinking,
      // searching or connecting, a slow breath keeps the glow alive and calm.
      const active = phaseRef.current;
      const target =
        active === "recording" || active === "speaking"
          ? glowTarget.current
          : Math.max(glowTarget.current, 0.2 + 0.08 * Math.sin(now / 700));
      const response = target > smoothed ? 85 : 250;
      smoothed += (target - smoothed) * (1 - Math.exp(-elapsed / response));
      // The glow mounts and unmounts across phases; always use the live element.
      voiceGlow.current?.style.setProperty("--voice-level", smoothed.toFixed(3));
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame);
      glowTarget.current = 0;
    };
  }, [open, phase]);
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState("");
  /** This voice session's turns with speaker and time; cleared when the dialog closes. */
  const [voiceLog, setVoiceLog] = useState<{ speaker: "You" | "Kova"; text: string; at: number }[]>(
    [],
  );
  const [hasTranscript, setHasTranscript] = useState(false);
  const [canRetryRecording, setCanRetryRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [audioUrl, setAudioUrl] = useState("");
  const [capabilityAttempt, setCapabilityAttempt] = useState(0);
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  const [lastVoiceReply, setLastVoiceReply] = useState("");
  const dictationStartScope = useRef<string | null>(null);
  const voiceStartScope = useRef<string | null>(null);
  const inlineWasOpen = useRef(false);

  useLayoutEffect(() => {
    const wasOpen = inlineWasOpen.current;
    inlineWasOpen.current = open && inlineDictation && mode === "dictate";
    if (wasOpen && !open) onCloseAutoFocus?.(new Event("closeAutoFocus", { cancelable: true }));
  }, [open, inlineDictation, mode, onCloseAutoFocus]);

  const current = useRef({
    open,
    userId,
    contextKey,
    disabled,
    isStreaming,
    latestAssistantText,
    latestAssistantReply,
    mode,
    onVoiceSubmit,
    onVoicePlaybackProgress,
    onOpenChange,
  });
  current.current = {
    open,
    userId,
    contextKey,
    disabled,
    isStreaming,
    latestAssistantText,
    latestAssistantReply,
    mode,
    onVoiceSubmit,
    onVoicePlaybackProgress,
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
  const silenceMonitor = useRef<{
    context: AudioContext;
    source: MediaStreamAudioSourceNode;
    interval: ReturnType<typeof setInterval>;
    gate: ReturnType<typeof createVoiceSilenceGate>;
  } | null>(null);
  const [handsFreeListening, setHandsFreeListening] = useState(false);
  const requestDeadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef("");
  const voiceCatalog = useRef<VoiceChoice[]>([]);
  const selectedVoice = useRef("");
  const defaultVoice = useRef("");
  const voiceSessionActive = useRef(false);
  const voicePlayback = useRef<{ stop(): void } | null>(null);
  const bargeIn = useRef<{ stop(): void } | null>(null);
  const bargeInGeneration = useRef(0);
  const playbackLevel = useRef(0);
  const playbackLevelSeen = useRef(false);
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
    const monitor = silenceMonitor.current;
    silenceMonitor.current = null;
    if (monitor) {
      clearInterval(monitor.interval);
      monitor.source.disconnect();
      void monitor.context.close().catch(() => undefined);
    }
  }, []);

  const releasePlayback = useCallback(() => {
    if (player.current) {
      player.current.onended = player.current.onerror = null;
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
    if (current.current.mode === "voice") current.current.onVoicePlaybackProgress?.(null);
    const activePlayback = voicePlayback.current;
    voicePlayback.current = null;
    bargeInGeneration.current += 1;
    bargeIn.current?.stop();
    bargeIn.current = null;
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
    setRealtimeFailed(false);
    voiceCatalog.current = [];
    selectedVoice.current = "";
    defaultVoice.current = "";
    setSelectedVoiceId("");
    setLastVoiceReply("");
    setVoiceLog([]);
    if (open) billingAfterClose.current = null;
    setChecking(false);
    setError("");
    setTranscript("");
    setHasTranscript(false);
    setCanRetryRecording(false);
    setElapsed(0);
    setAudioUrl("");
    setHandsFreeListening(false);
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
          const requestCapabilities = () =>
            authFetch("/api/voice", {
              signal: controller.signal,
              headers: { "X-Kova-Voice-Owner": scope.userId },
            });
          let response = await requestCapabilities();
          if (!isCurrent(scope)) return;
          // This read-only probe can retry a transient gateway failure within
          // the same startup deadline without re-opening the screen.
          if (mode === "voice" && (response.status === 502 || response.status === 504)) {
            void response.body?.cancel().catch(() => undefined);
            response = await requestCapabilities();
          }
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
            realtime: result.realtime === true,
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
    if (phaseRef.current === "synthesizing" || phaseRef.current === "speaking") cancelOperation();
    else {
      releasePlayback();
      setAudioUrl("");
    }
  }, [
    latestAssistantText,
    latestAssistantReply?.chatId,
    latestAssistantReply?.messageId,
    mode,
    cancelOperation,
    releasePlayback,
  ]);

  const stopReplyPlayback = useCallback(() => {
    if (phaseRef.current === "synthesizing" || phaseRef.current === "speaking") {
      generation.current += 1;
      request.current?.abort();
      request.current = null;
      const activePlayback = voicePlayback.current;
      voicePlayback.current = null;
      activePlayback?.stop();
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

  const stopBargeInMonitor = () => {
    bargeInGeneration.current += 1;
    bargeIn.current?.stop();
    bargeIn.current = null;
  };

  // Lets the user simply talk over Kova. Compares the microphone against Kova's own
  // playback level so speaker echo does not interrupt; needs sustained speech.
  const startBargeInMonitor = (
    scope: OperationScope,
    playback: ReturnType<typeof createStreamingVoicePlayback>,
  ) => {
    stopBargeInMonitor();
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof AudioContext === "undefined"
    )
      return;
    const generation = bargeInGeneration.current;
    void navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
      .then((micStream) => {
        if (
          bargeInGeneration.current !== generation ||
          !isCurrent(scope) ||
          voicePlayback.current !== playback
        ) {
          stopTracks(micStream);
          return;
        }
        const context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaStreamSource(micStream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        // Without a playback level reading, echo cannot be told from speech: be stricter.
        const detector = createBargeInDetector({
          floor: playbackLevelSeen.current ? 0.035 : 0.08,
        });
        detector.reset(performance.now());
        const interval = setInterval(() => {
          analyser.getFloatTimeDomainData(samples);
          let energy = 0;
          for (const value of samples) energy += value * value;
          const mic = Math.sqrt(energy / samples.length);
          if (
            !detector.feed({ mic, playback: playbackLevel.current, now: performance.now() }) ||
            voicePlayback.current !== playback ||
            !isCurrent(scope)
          )
            return;
          stopBargeInMonitor();
          voicePlayback.current = null;
          current.current.onVoicePlaybackProgress?.(null);
          playback.interrupt();
          updatePhase("idle");
          void resumeRecording.current?.(true);
        }, 40);
        bargeIn.current = {
          stop() {
            clearInterval(interval);
            stopTracks(micStream);
            void context.close().catch(() => undefined);
          },
        };
      })
      .catch(() => undefined);
  };

  // Starts speaking as soon as the first signed segment arrives, in parallel with
  // generation. The exact model, reasoning effort and limits are decided by the chat
  // request and server; nothing here selects or downgrades them.
  const startStreamingSpeech = (scope: OperationScope) => {
    let words = 0;
    const playback = createStreamingVoicePlayback({
      ownerId: scope.userId,
      voiceId: scope.voiceId,
      fetchImpl: authFetch,
      ackCache,
      tracker: latencyTracker,
      createSink: (options) =>
        createBrowserSpeechSink({
          ...options,
          onLevel: (level: number) => {
            playbackLevelSeen.current = true;
            playbackLevel.current = level;
            updateGlow(level);
          },
          onProgress: (elapsed, duration) => {
            if (!isCurrent(scope) || voicePlayback.current !== playback) return;
            const total =
              Number.isFinite(duration) && duration > 0
                ? duration
                : Math.max(words / 2.7, elapsed + 0.5);
            current.current.onVoicePlaybackProgress?.(Math.min(0.99, (elapsed + 0.18) / total));
          },
        }),
      onState: (state, code) => {
        if (!isCurrent(scope) || voicePlayback.current !== playback) return;
        if (state === "playing") {
          updatePhase("speaking");
          startBargeInMonitor(scope, playback);
        } else if (state === "error") {
          stopBargeInMonitor();
          failOperation(speechErrorMessage(code));
        }
      },
      onEnded: () => {
        if (!isCurrent(scope) || voicePlayback.current !== playback || !voiceSessionActive.current)
          return;
        stopBargeInMonitor();
        current.current.onVoicePlaybackProgress?.(null);
        voicePlayback.current = null;
        updatePhase("idle");
        // Natural end of a spoken reply: listen again automatically.
        void resumeRecording.current?.(true);
      },
    });
    voicePlayback.current = playback;
    playback.begin();
    return {
      playback,
      events: {
        onSegment: (segment: {
          chatId: string;
          messageId: string;
          index: number;
          text: string;
          receipt: string;
        }) => {
          words += segment.text.trim().split(/\s+/u).length;
          playback.segment(segment);
        },
        onDelay: (kind: "search" | "reasoning") => playback.delay(kind),
      },
    };
  };

  const submitVoiceTurn = async (scope: OperationScope, text: string, realtime = false) => {
    const submit = current.current.onVoiceSubmit;
    if (!isCurrent(scope) || !voiceSessionActive.current || !submit) return;
    updatePhase("chat");
    setVoiceLog((log) => [...log.slice(-49), { speaker: "You", text, at: Date.now() }]);
    const controller = beginRequest(120_000);
    let abortListener: (() => void) | undefined;
    let streaming: ReturnType<typeof startStreamingSpeech> | null = null;
    let handedOff = false;
    try {
      const aborted = new Promise<never>((_resolve, reject) => {
        abortListener = () => reject(new Error("voice_turn_cancelled"));
        controller.signal.addEventListener("abort", abortListener, { once: true });
        if (controller.signal.aborted) abortListener();
      });
      // Live (hands-free) turns speak while the reply is still being generated.
      if (realtime && scope.userId) streaming = startStreamingSpeech(scope);
      const reply = await Promise.race([
        submit(text, controller.signal, realtime, streaming?.events),
        aborted,
      ]);
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
      setVoiceLog((log) => [
        ...log.slice(-49),
        { speaker: "Kova", text: reply.content, at: Date.now() },
      ]);
      if (streaming?.playback.finish()) {
        // Speech is already playing from the streamed segments; its callbacks
        // finish the turn and resume listening. No second synthesis happens.
        handedOff = true;
        return;
      }
      streaming = null;
      updatePhase("synthesizing");
      let ended = false;
      let started = false;
      const wordCount = reply.content.trim().split(/\s+/u).length;
      const playback = createSpeechPlayback({
        fetchImpl: authFetch,
        createSink: (options) =>
          createBrowserSpeechSink({
            ...options,
            onLevel: updateGlow,
            onProgress: (elapsed, duration) => {
              if (!isCurrent(scope) || voicePlayback.current !== playback) return;
              // MP3 streams may initially report an infinite duration. Start
              // with a speech-rate estimate and refine it as metadata arrives.
              const total = Number.isFinite(duration) && duration > 0 ? duration : wordCount / 2.7;
              current.current.onVoicePlaybackProgress?.(Math.min(0.99, (elapsed + 0.18) / total));
            },
          }),
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
          current.current.onVoicePlaybackProgress?.(null);
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
          if (state === "playing") updatePhase("speaking");
          if (state === "error") {
            failOperation(speechErrorMessage(code));
          } else if (state === "idle" && started && !ended) {
            // The shared player emits idle immediately before an error. Let
            // its error notification run before treating an external Stop as
            // a paused session; neither path restarts microphone capture.
            void Promise.resolve().then(() => {
              if (!isCurrent(scope) || voicePlayback.current !== playback || ended) return;
              voicePlayback.current = null;
              current.current.onVoicePlaybackProgress?.(null);
              voiceSessionActive.current = false;
              updatePhase("idle");
            });
          }
        },
      });
      voicePlayback.current = playback;
      const speechInput = {
        ownerId: reply.ownerId,
        chatId: reply.chatId,
        messageId: reply.messageId,
        contentSha256: reply.contentSha256,
        ...(scope.voiceId ? { voiceId: scope.voiceId } : {}),
      };
      await playback.start(
        realtime
          ? {
              ...speechInput,
              mode: "live-reply",
              text: reply.content,
              voiceModelReceipt: reply.voiceModelReceipt,
            }
          : speechInput,
      );
    } catch (cause) {
      if (!isCurrent(scope)) return;
      const limit = cause as { code?: string; resetsAt?: string } | null;
      if (limit?.code === "message_window_limit" && typeof limit.resetsAt === "string") {
        const remaining = Math.ceil((Date.parse(limit.resetsAt) - Date.now()) / 60_000);
        if (Number.isFinite(remaining) && remaining > 0 && remaining <= 7 * 24 * 60) {
          const hours = Math.floor(remaining / 60);
          const minutes = remaining % 60;
          const duration = [
            hours ? `${hours} ${hours === 1 ? "hour" : "hours"}` : "",
            minutes ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}` : "",
          ]
            .filter(Boolean)
            .join(" and ");
          const notice = `Whoops! You've hit your usage limit, although we can talk again in ${duration}.`;
          finishRequest(controller);
          current.current.onVoicePlaybackProgress?.(null);
          setError(notice);
          updatePhase("synthesizing");
          const noticeRequest = beginRequest(20_000);
          try {
            const response = await authFetch("/api/voice", {
              method: "POST",
              signal: noticeRequest.signal,
              headers: {
                "Content-Type": "application/json",
                "X-Kova-Voice-Owner": scope.userId,
              },
              // The server picks the plan's default ElevenLabs voice.
              body: JSON.stringify({ action: "tts", text: notice }),
            });
            if (!response.ok) throw new Error("voice_notice_unavailable", { cause });
            const audio = await response.blob();
            if (!isCurrent(scope) || noticeRequest.signal.aborted) return;
            const output = new Audio();
            player.current = output;
            objectUrl.current = URL.createObjectURL(audio);
            output.src = objectUrl.current;
            const finishNotice = () => {
              if (!isCurrent(scope) || player.current !== output) return;
              releasePlayback();
              voiceSessionActive.current = false;
              updatePhase("idle");
            };
            output.onended = output.onerror = finishNotice;
            await output.play();
            if (!isCurrent(scope) || player.current !== output) return;
            updatePhase("speaking");
          } catch {
            if (isCurrent(scope)) {
              releasePlayback();
              voiceSessionActive.current = false;
              updatePhase("idle");
            }
          } finally {
            finishRequest(noticeRequest);
          }
          return;
        }
      }
      const code = cause instanceof Error ? cause.message : "";
      failOperation(
        controller.signal.aborted
          ? "This voice turn timed out. Your conversation remains in chat. Start again when you are ready."
          : code === "voice_reply_too_long"
            ? "This reply is too long to speak. Read it in chat, then start a new voice turn."
            : code === "voice_model_not_eligible"
              ? "This model is not approved for Voice. Your reply remains in chat; select a voice-enabled model."
              : "This voice turn could not be completed and saved. Review the conversation in chat before trying again.",
      );
    } finally {
      if (abortListener) controller.signal.removeEventListener("abort", abortListener);
      finishRequest(controller);
      if (!handedOff && streaming) {
        if (voicePlayback.current === streaming.playback) voicePlayback.current = null;
        stopBargeInMonitor();
        streaming.playback.stop();
      }
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
      finishRequest(controller);
      if (current.current.mode === "voice" && voiceSessionActive.current) {
        setTranscript(result.text.trim());
        setHasTranscript(true);
        await submitVoiceTurn(scope, result.text.trim());
      } else if (current.current.mode === "dictate") {
        // Dictation behaves like typing: insert into the current composer draft
        // without a second transcript review or an automatic Send action.
        closing.current = true;
        onTranscript(result.text.trim());
        closeDialog(false);
      } else {
        updatePhase("idle");
      }
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
    setHandsFreeListening(false);
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
    const realtime =
      mode === "voice" && capabilities.realtime && !realtimeFailed && canListenInRealtime();
    const canRecord =
      typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
    if (!realtime && !canRecord) {
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
    if (realtime) {
      const controller = new AbortController();
      request.current = controller;
      let startedListening = false;
      let fallbackAllowed = true;
      try {
        const text = await listenForVoiceTurn({
          signal: controller.signal,
          getToken: async () => {
            const response = await authFetch("/api/voice", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Kova-Voice-Owner": scope.userId,
              },
              body: JSON.stringify({ action: "realtime" }),
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
            });
            if (!response.ok) {
              // Preserve account, feature and quota denials. Only provider
              // transport failures can fall back to recorded transcription.
              fallbackAllowed = response.status === 502 || response.status === 504;
              throw new Error(await voiceError(response, "Live Voice could not connect."));
            }
            const { token } = await response.json();
            if (typeof token !== "string" || !token)
              throw new Error("Live Voice could not connect.");
            return token;
          },
          onLevel: updateGlow,
          onListening: () => {
            startedListening = true;
            if (isCurrent(scope)) {
              setHandsFreeListening(true);
              updatePhase("recording");
            }
          },
        });
        finishRequest(controller);
        if (isCurrent(scope)) await submitVoiceTurn(scope, text, true);
        return;
      } catch (cause) {
        if (!isCurrent(scope) || controller.signal.aborted) return;
        const mediaError = cause instanceof Error ? cause.name : "";
        const permissionDenied = mediaError === "NotAllowedError" || mediaError === "SecurityError";
        const canUseRecordedVoice =
          canRecord && !permissionDenied && mediaError !== "NotFoundError" && fallbackAllowed;
        setHandsFreeListening(false);
        if (canUseRecordedVoice) setRealtimeFailed(true);
        if (!canUseRecordedVoice || startedListening) {
          failOperation(
            permissionDenied
              ? "Allow microphone access in your browser to use Voice."
              : canUseRecordedVoice
                ? "Live Voice disconnected. Start again to use recorded Voice."
                : cause instanceof Error && cause.name === "Error"
                  ? cause.message
                  : "Live Voice could not connect. Try again.",
          );
          return;
        }
        // The waveform button starts both ElevenLabs modes. If realtime never
        // began listening, continue the same requested turn with recorded STT.
      } finally {
        finishRequest(controller);
      }
    }
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

      // Only Voice conversation uses local audio energy to detect when a
      // person finishes a turn. No raw samples or analysis leave the device.
      // If Web Audio is unavailable, manual Finish turn remains functional.
      if (mode === "voice" && typeof AudioContext !== "undefined") {
        let context: AudioContext | null = null;
        try {
          context = new AudioContext();
          const source = context.createMediaStreamSource(acquired);
          const analyser = context.createAnalyser();
          analyser.fftSize = 1024;
          source.connect(analyser);
          const samples = new Float32Array(analyser.fftSize);
          const gate = createVoiceSilenceGate();
          const interval = setInterval(() => {
            if (!isCurrent(scope) || phaseRef.current !== "recording") return;
            analyser.getFloatTimeDomainData(samples);
            let total = 0;
            for (const sample of samples) total += sample * sample;
            const level = Math.sqrt(total / samples.length);
            updateGlow(level);
            if (gate.sample(level, Date.now())) stopRecording();
          }, 100);
          silenceMonitor.current = { context, source, interval, gate };
          setHandsFreeListening(true);
          if (context.state === "suspended")
            void context.resume().catch(() => {
              // Unsupported or suspended analysis must not interfere with the
              // user's manual Finish turn control.
              setHandsFreeListening(false);
            });
        } catch {
          // Recording is still usable in manual mode without Web Audio.
          void context?.close().catch(() => undefined);
          setHandsFreeListening(false);
        }
      }
      recordingDeadline.current = setTimeout(() => {
        if (
          mode === "voice" &&
          silenceMonitor.current &&
          !silenceMonitor.current.gate.hasSpeech()
        ) {
          cancelOperation();
          setError("No speech detected before the listening limit. Press Start to try again.");
          return;
        }
        stopRecording();
      }, MAX_RECORDING_MS);
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
    const reply = latestAssistantReply;
    const voiceId = selectedVoice.current;
    if (
      !userId ||
      !reply?.chatId ||
      !reply.messageId ||
      !reply.content.trim() ||
      reply.content !== latestAssistantText ||
      !capabilities?.configured ||
      !capabilities.tts ||
      !voiceCatalog.current.some((voice) => voice.id === voiceId && voice.available) ||
      phaseRef.current !== "idle"
    )
      return;
    const scope = { generation: generation.current, userId, contextKey };
    if (!isCurrent(scope)) return;
    if (reply.content.length > MAX_REPLY_CHARACTERS) {
      setError(
        "This reply is too long to read aloud. Voice playback supports replies up to 4,000 characters.",
      );
      return;
    }
    stopReplyPlayback();
    setError("");
    updatePhase("synthesizing");
    try {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(reply.content));
      if (
        !isCurrent(scope) ||
        current.current.latestAssistantText !== reply.content ||
        current.current.latestAssistantReply?.chatId !== reply.chatId ||
        current.current.latestAssistantReply?.messageId !== reply.messageId ||
        selectedVoice.current !== voiceId
      )
        return;
      const contentSha256 = Array.from(new Uint8Array(digest), (value) =>
        value.toString(16).padStart(2, "0"),
      ).join("");
      let started = false;
      const playback = createSpeechPlayback({
        fetchImpl: authFetch,
        createSink: createBrowserSpeechSink,
        onEnded: (completed) => {
          if (
            !isCurrent(scope) ||
            voicePlayback.current !== playback ||
            completed.ownerId !== scope.userId ||
            completed.chatId !== reply.chatId ||
            completed.messageId !== reply.messageId ||
            completed.contentSha256 !== contentSha256
          )
            return;
          voicePlayback.current = null;
          updatePhase("idle");
        },
        onState: (state, code) => {
          if (!isCurrent(scope) || voicePlayback.current !== playback) return;
          if (state === "loading") started = true;
          if (state === "playing") updatePhase("speaking");
          if (state === "error") {
            const messages: Record<string, string> = {
              speech_not_eligible: "This reply is not from a voice-enabled model.",
              speech_voice_plan_required: "This voice requires a different plan.",
              speech_forbidden: "Read aloud is not available for this account right now.",
              speech_unauthorized: "Sign in again before reading aloud.",
              speech_message_unavailable: "This reply is no longer available in saved history.",
              speech_message_not_synced: "This reply is still syncing. Try again once it is saved.",
              speech_not_available: "Read aloud is not configured. Your reply remains in chat.",
            };
            failOperation(messages[code ?? ""] ?? "This reply could not be read aloud. Try again.");
          } else if (state === "idle" && started) {
            // Natural ending and failures also emit idle immediately; let their
            // callbacks settle before handling an external shared Stop.
            void Promise.resolve().then(() => {
              if (!isCurrent(scope) || voicePlayback.current !== playback) return;
              voicePlayback.current = null;
              updatePhase("idle");
            });
          }
        },
      });
      voicePlayback.current = playback;
      await playback.start({
        ownerId: scope.userId,
        chatId: reply.chatId,
        messageId: reply.messageId,
        contentSha256,
        voiceId,
      });
    } catch (cause) {
      if (isCurrent(scope)) {
        failOperation("This browser could not prepare the saved reply for playback.");
      }
    }
  };

  const closeDialog = (next: boolean) => {
    if (!next) {
      closing.current = true;
      releaseResources();
    }
    onOpenChange(next);
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

  // Clicking Type with voice is the explicit recording action. Availability
  // still resolves before requesting the microphone, once per opening/scope.
  useLayoutEffect(() => {
    if (!open) {
      dictationStartScope.current = null;
      return;
    }
    if (!inlineDictation || mode !== "dictate" || !ready || !capabilities?.stt) return;
    const scope = JSON.stringify([userId, contextKey]);
    if (dictationStartScope.current === scope) return;
    dictationStartScope.current = scope;
    void resumeRecording.current?.();
  }, [open, inlineDictation, mode, ready, capabilities?.stt, userId, contextKey]);

  // The empty-composer Voice button is an explicit user request. After the
  // authenticated server capability check succeeds, begin one voice turn
  // without making the user press a second Start button. No microphone access
  // occurs for unconfigured, unverified, disabled, or stale account scopes.
  useLayoutEffect(() => {
    if (!open) {
      voiceStartScope.current = null;
      return;
    }
    if (!autoStartVoice || mode !== "voice" || !ready || !onVoiceSubmit) return;
    const scope = JSON.stringify([userId, contextKey]);
    if (voiceStartScope.current === scope) return;
    voiceStartScope.current = scope;
    void resumeRecording.current?.();
  }, [open, autoStartVoice, mode, ready, onVoiceSubmit, userId, contextKey]);

  const VoiceView =
    inlineDictation && mode === "dictate" ? ComposerDictationView : ComposerVoiceDialogView;

  const startingVoice =
    open &&
    mode === "voice" &&
    !unavailable &&
    !error &&
    (checking || !capabilities || phase === "requesting");
  const { colors } = mode === "voice" ? preferredVoiceGlow(userId) : { colors: [] };
  const glowStyle = colors.length
    ? ({
        "--voice-glow-a": colors[0],
        "--voice-glow-b": colors[1],
        "--voice-glow-c": colors[2],
      } as CSSProperties)
    : undefined;
  const realtimeListening =
    phase === "recording" &&
    mode === "voice" &&
    capabilities?.realtime &&
    !realtimeFailed &&
    canListenInRealtime();

  if (mode === "voice" && autoStartVoice) {
    if (!open) return null;
    const liveStatus =
      error ||
      (startingVoice
        ? "Starting Voice…"
        : phase === "recording"
          ? "Listening…"
          : phase === "speaking"
            ? "Kova is speaking…"
            : busy
              ? "Kova is responding…"
              : ready
                ? "Voice paused"
                : "Voice is unavailable right now.");
    return (
      <div id="kova-inline-voice" className="kova-inline-voice" data-phase={phase}>
        {/* One continuous glow for the whole active session: connecting, listening,
            thinking, searching and speaking. Hidden only when paused or on error. */}
        {!error && (startingVoice || phase !== "idle") && (
          <div
            ref={voiceGlow}
            style={glowStyle}
            className="kova-inline-voice-glow"
            aria-hidden="true"
          />
        )}
        {/* Status stays announced to assistive technology; only errors are visible. */}
        <span role="status" aria-live="polite" className={error ? undefined : "sr-only"}>
          {liveStatus}
        </span>
        {ready && phase === "recording" && !realtimeListening && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Finish turn"
            title="Finish turn"
            onClick={stopRecording}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
        )}
        {/* Discreet recovery only when Voice is paused; no visible text label. */}
        {ready && !busy && phase === "idle" && !startingVoice && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Resume Voice"
            title="Resume Voice"
            onClick={() => void startRecording()}
          >
            <Mic aria-hidden="true" />
          </Button>
        )}
        {!checking && !capabilities && error && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              voiceStartScope.current = null;
              setCapabilityAttempt((value) => value + 1);
            }}
          >
            Try again
          </Button>
        )}
      </div>
    );
  }

  return (
    <VoiceView
      open={open}
      onOpenChange={closeDialog}
      onCloseAutoFocus={handleCloseAutoFocus}
      phase={phase}
      startingVoice={startingVoice}
      glowStyle={glowStyle}
      mode={mode}
      status={status}
      handsFreeListening={mode === "voice" && handsFreeListening}
      canFinishVoiceTurn={!realtimeListening}
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
      hasTranscript={hasTranscript && !(mode === "voice" && autoStartVoice)}
      microphoneAvailable={capabilities?.stt ?? false}
      replyAvailable={mode === "voice" ? false : (capabilities?.tts ?? false)}
      error={error}
      conversationModelControl={conversationModelControl}
      recordingControl={
        ready && !realtimeListening ? (
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
        ready &&
        ((hasTranscript && !(mode === "voice" && autoStartVoice)) ||
          (mode === "voice" && voiceLog.length > 0)) ? (
          <>
            {mode === "voice" && voiceLog.length > 0 && (
              <ol className="kova-voice-log" aria-label="Conversation transcript">
                {voiceLog.map((turn, index) => (
                  <li key={index} data-speaker={turn.speaker}>
                    <span className="kova-voice-log-meta">
                      <strong>{turn.speaker}</strong>
                      <time dateTime={new Date(turn.at).toISOString()}>
                        {new Date(turn.at).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </time>
                    </span>
                    <span>{turn.text}</span>
                  </li>
                ))}
              </ol>
            )}
            {hasTranscript && !(mode === "voice" && autoStartVoice) && (
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
            )}
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
                    !latestAssistantReply?.chatId ||
                    !latestAssistantReply.messageId ||
                    !latestAssistantReply.content.trim() ||
                    latestAssistantReply.content !== latestAssistantText ||
                    !capabilities.voices.some(
                      (voice) => voice.available && voice.id === selectedVoiceId,
                    )
                  }
                >
                  <Volume2 aria-hidden="true" /> Read latest completed reply
                </Button>
                {(!capabilities.tts || !selectedVoiceId || !latestAssistantReply) && (
                  <p>
                    {capabilities.voices.length === 0
                      ? "No reply voices are configured."
                      : !selectedVoiceId
                        ? "No reply voice is available for your current plan."
                        : "Use Read aloud on a saved reply from an approved OpenAI model."}
                  </p>
                )}
              </>
            )}
          </>
        ) : undefined
      }
      voiceReply={
        mode === "voice" && !autoStartVoice && lastVoiceReply ? lastVoiceReply : undefined
      }
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
          <Button
            type="button"
            onClick={useTranscript}
            disabled={busy || !transcript.trim()}
            aria-label="Use in chat"
            title="Add transcript to message"
          >
            {inlineDictation ? <ArrowUp aria-hidden="true" /> : "Use in chat"}
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
