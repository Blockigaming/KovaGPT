// Voice mode via OpenAI Realtime API over WebRTC.
//
// UX contract (Phase 2):
//   * No separate "voice screen" — voice sits inline above the chat input.
//   * Big animated NovaLogo that reacts to microphone + assistant audio via
//     AnalyserNode (real audio-reactive scale, not just CSS pulse).
//   * Barge-in: when the user starts speaking, we cancel the current
//     assistant response and mute remote audio until the next response.
//   * Each completed turn fires onTurn(userText, assistantText) so the
//     parent inserts real chat bubbles into the transcript.
import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { X, Mic, MicOff } from "lucide-react";
import { NovaLogo } from "@/components/NovaLogo";
import type { Message } from "@/lib/chat-store";
import { toast } from "sonner";

type Status = "connecting" | "listening" | "thinking" | "speaking" | "error";

export function VoiceMode({
  open,
  onClose,
  initialMessages,
  voiceName,
  onTurn,
}: {
  open: boolean;
  onClose: () => void;
  initialMessages: Message[];
  voiceName: string;
  voiceRate: number;
  onTurn?: (userText: string, assistantText: string) => void;
}) {
  const [status, setStatus] = useState<Status>("connecting");
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0); // 0..1 audio energy for the logo

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);

  // Web Audio graph for audio-reactive animation + barge-in metering.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const remoteAnalyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  const currentUserTextRef = useRef("");
  const currentAssistantTextRef = useRef("");
  const activeResponseIdRef = useRef<string | null>(null);

  const voice = (() => {
    const allowed = ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"];
    return allowed.includes(voiceName) ? voiceName : "verse";
  })();

  const cleanup = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    try { dataChannelRef.current?.close(); } catch { /* ignore */ }
    dataChannelRef.current = null;
    try { pcRef.current?.close(); } catch { /* ignore */ }
    pcRef.current = null;
    if (micStreamRef.current) {
      for (const track of micStreamRef.current.getTracks()) {
        try { track.stop(); } catch { /* ignore */ }
      }
      micStreamRef.current = null;
    }
    if (audioElRef.current) {
      try { audioElRef.current.pause(); } catch { /* ignore */ }
      audioElRef.current.srcObject = null;
    }
    try { audioCtxRef.current?.close(); } catch { /* ignore */ }
    audioCtxRef.current = null;
    micAnalyserRef.current = null;
    remoteAnalyserRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      setStatus("connecting");
      setLevel(0);

      const recentContext = initialMessages
        .slice(-6)
        .map((m) => `${m.role === "user" ? "User" : "KovaGPT"}: ${m.content}`)
        .join("\n")
        .slice(0, 1500);
      const instructions =
        "You are KovaGPT, a warm, helpful, conversational AI built by Zachary Block. " +
        "Speak naturally in short, complete sentences. Keep replies under three sentences unless asked for more. " +
        "Never use markdown, lists, code, URLs, or symbols. Never repeat profanity. Stay PG. " +
        "If the user sounds frustrated, briefly acknowledge it before solving. " +
        (recentContext ? `\n\nRecent chat context:\n${recentContext}` : "");

      // 1. Ephemeral session token
      let token: string;
      let model: string;
      try {
        const resp = await authFetch("/api/realtime-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ voice, instructions }),
        });
        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          const msg = data?.error || `Voice mode unavailable (${resp.status}).`;
          toast.error(msg);
          setStatus("error");
          onClose();
          return;
        }
        const data = await resp.json();
        token = data?.client_secret?.value;
        model = data?.model || "gpt-4o-realtime-preview-2024-12-17";
        if (!token) throw new Error("Missing session token");
      } catch (e) {
        toast.error((e as Error).message || "Could not start voice mode.");
        setStatus("error");
        onClose();
        return;
      }
      if (cancelled) return;

      // 2. WebRTC + Web Audio graph
      try {
        const pc = new RTCPeerConnection();
        pcRef.current = pc;

        const audioEl = document.createElement("audio");
        audioEl.autoplay = true;
        audioElRef.current = audioEl;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
        const ctx = new AC();
        audioCtxRef.current = ctx;

        pc.ontrack = (event) => {
          const stream = event.streams[0];
          audioEl.srcObject = stream;
          try {
            const src = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 512;
            src.connect(analyser);
            remoteAnalyserRef.current = analyser;
          } catch { /* ignore */ }
        };

        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = micStream;
        for (const track of micStream.getTracks()) {
          pc.addTrack(track, micStream);
        }
        try {
          const micSrc = ctx.createMediaStreamSource(micStream);
          const micAnalyser = ctx.createAnalyser();
          micAnalyser.fftSize = 512;
          micSrc.connect(micAnalyser);
          micAnalyserRef.current = micAnalyser;
        } catch { /* ignore */ }

        // Animation loop — read whichever analyser is louder and expose it.
        const buf = new Uint8Array(256);
        const loop = () => {
          let m = 0;
          const readRMS = (a: AnalyserNode | null) => {
            if (!a) return 0;
            a.getByteTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) {
              const v = (buf[i] - 128) / 128;
              sum += v * v;
            }
            return Math.sqrt(sum / buf.length);
          };
          const micLvl = muted ? 0 : readRMS(micAnalyserRef.current);
          const remoteLvl = readRMS(remoteAnalyserRef.current);
          m = Math.max(micLvl, remoteLvl);
          // Smooth + normalise into 0..1 with a floor so it always breathes slightly.
          setLevel((prev) => prev * 0.7 + Math.min(1, m * 4) * 0.3);
          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);

        const dc = pc.createDataChannel("oai-events");
        dataChannelRef.current = dc;
        dc.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === "response.created" && msg.response?.id) {
              activeResponseIdRef.current = msg.response.id;
              // A fresh response — un-mute remote if we muted for barge-in.
              if (audioElRef.current) audioElRef.current.muted = false;
            }
            if (msg.type === "response.audio.delta" || msg.type === "response.output_audio.delta") {
              setStatus("speaking");
            }
            if (msg.type === "input_audio_buffer.speech_started") {
              setStatus("listening");
              // BARGE-IN: cancel current response and mute remote audio.
              if (activeResponseIdRef.current) {
                try {
                  dc.send(JSON.stringify({ type: "response.cancel" }));
                } catch { /* ignore */ }
                if (audioElRef.current) audioElRef.current.muted = true;
              }
            }
            if (msg.type === "input_audio_buffer.speech_stopped") {
              setStatus("thinking");
            }
            if (msg.type === "conversation.item.input_audio_transcription.completed") {
              currentUserTextRef.current = (msg.transcript || "").trim();
            }
            if (
              msg.type === "response.audio_transcript.delta" ||
              msg.type === "response.output_audio_transcript.delta"
            ) {
              currentAssistantTextRef.current += (msg.delta || "");
            }
            if (
              msg.type === "response.audio_transcript.done" ||
              msg.type === "response.output_audio_transcript.done" ||
              msg.type === "response.done"
            ) {
              const u = currentUserTextRef.current.trim();
              const a = currentAssistantTextRef.current.trim();
              if (u || a) onTurn?.(u, a);
              currentUserTextRef.current = "";
              currentAssistantTextRef.current = "";
              activeResponseIdRef.current = null;
              setStatus("listening");
            }
            if (msg.type === "error") {
              console.warn("[realtime] error event", msg);
            }
          } catch { /* ignore non-JSON */ }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const sdpResp = await fetch(`https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/sdp",
          },
        });
        if (!sdpResp.ok) {
          throw new Error(`Realtime handshake failed (${sdpResp.status})`);
        }
        const answer = { type: "answer" as const, sdp: await sdpResp.text() };
        await pc.setRemoteDescription(answer);

        if (!cancelled) setStatus("listening");
      } catch (e) {
        console.error("[VoiceMode] webrtc setup failed", e);
        toast.error((e as Error).message || "Voice mode could not start.");
        setStatus("error");
        cleanup();
        onClose();
      }
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleMute = useCallback(() => {
    const stream = micStreamRef.current;
    if (!stream) return;
    const next = !muted;
    for (const track of stream.getAudioTracks()) {
      track.enabled = !next;
    }
    setMuted(next);
  }, [muted]);

  if (!open) return null;

  const label =
    status === "connecting" ? "Connecting…" :
    status === "listening" ? "Listening" :
    status === "thinking" ? "Thinking…" :
    status === "speaking" ? "Speaking" :
    status === "error" ? "Connection error" : "";

  // Logo scale reacts to audio energy: baseline breathes 1.0 -> 1.03, peaks push to 1.3.
  const baseline = 1 + Math.sin(Date.now() / 700) * 0.015;
  const scale = baseline + level * 0.35;
  const glow = 0.25 + level * 0.75;

  return (
    <div className="w-full flex flex-col items-center gap-3 pt-2 pb-3 animate-fade-in">
      <div className="relative flex items-center justify-center">
        <div
          className="absolute inset-0 rounded-full blur-2xl transition-opacity duration-150"
          style={{
            background: "radial-gradient(circle, hsl(var(--primary) / 0.6), transparent 70%)",
            opacity: glow,
            transform: `scale(${1 + level * 0.6})`,
          }}
        />
        <div
          className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden flex items-center justify-center bg-background ring-1 ring-border transition-transform duration-75"
          style={{ transform: `scale(${scale})` }}
        >
          <NovaLogo className="w-full h-full" />
        </div>
      </div>

      <div className="flex items-center gap-3">
        {label && (
          <span className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</span>
        )}
        <button
          onClick={toggleMute}
          className="w-9 h-9 rounded-full bg-accent text-foreground flex items-center justify-center hover:bg-accent/80 transition"
          aria-label={muted ? "Unmute microphone" : "Mute microphone"}
          title={muted ? "Unmute" : "Mute"}
        >
          {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center hover:opacity-90 transition"
          aria-label="Close voice mode"
          title="End voice mode"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
