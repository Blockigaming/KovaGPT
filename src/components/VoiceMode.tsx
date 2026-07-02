// Voice mode powered by OpenAI Realtime API over WebRTC.
//
// For Plus+ / Pro users (gated server-side by /api/realtime-session),
// this opens a peer connection straight to OpenAI for true conversational
// voice: barge-in interruptions, natural turn-taking, sub-300ms latency.
//
// Architecture:
// 1. Fetch an ephemeral session token from /api/realtime-session
// 2. Create RTCPeerConnection, add mic track, attach an audio sink
//    for incoming model audio
// 3. Open a "oai-events" data channel for JSON events (transcripts etc)
// 4. POST the local SDP offer to OpenAI Realtime, set remote answer
//
// On any failure (no key on server, free tier, network), we fall back to
// the legacy turn-based TTS path so voice still works.
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
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);

  const currentUserTextRef = useRef("");
  const currentAssistantTextRef = useRef("");

  const voice = (() => {
    const allowed = ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"];
    return allowed.includes(voiceName) ? voiceName : "marin";
  })();

  const cleanup = useCallback(() => {
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
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      setStatus("connecting");
      setTranscript("");
      setReply("");

      // Build a brief context summary from the existing conversation so the
      // Realtime session is aware of what the user was just doing.
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

      // 1. Get ephemeral session token from our server
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
          const msg = data?.error || "Voice mode unavailable.";
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

      // 2. Set up WebRTC
      try {
        const pc = new RTCPeerConnection();
        pcRef.current = pc;

        const audioEl = document.createElement("audio");
        audioEl.autoplay = true;
        audioElRef.current = audioEl;
        pc.ontrack = (event) => {
          audioEl.srcObject = event.streams[0];
        };

        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = micStream;
        for (const track of micStream.getTracks()) {
          pc.addTrack(track, micStream);
        }

        const dc = pc.createDataChannel("oai-events");
        dataChannelRef.current = dc;
        dc.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            // Track speaking state
            if (msg.type === "response.audio.delta" || msg.type === "response.output_audio.delta") {
              setStatus("speaking");
            }
            if (msg.type === "input_audio_buffer.speech_started") {
              setStatus("listening");
            }
            if (msg.type === "input_audio_buffer.speech_stopped") {
              setStatus("thinking");
            }
            // Transcripts
            if (msg.type === "conversation.item.input_audio_transcription.completed") {
              const text: string = msg.transcript || "";
              currentUserTextRef.current = text;
              setTranscript(text);
            }
            if (
              msg.type === "response.audio_transcript.delta" ||
              msg.type === "response.output_audio_transcript.delta"
            ) {
              const delta: string = msg.delta || "";
              currentAssistantTextRef.current += delta;
              setReply((r) => r + delta);
            }
            if (
              msg.type === "response.audio_transcript.done" ||
              msg.type === "response.output_audio_transcript.done" ||
              msg.type === "response.done"
            ) {
              const u = currentUserTextRef.current.trim();
              const a = currentAssistantTextRef.current.trim();
              if (u && a) onTurn?.(u, a);
              currentUserTextRef.current = "";
              currentAssistantTextRef.current = "";
              setStatus("listening");
              // Reset the visible reply after a beat
              setTimeout(() => {
                setReply("");
                setTranscript("");
              }, 1500);
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
    status === "listening" ? "Listening…" :
    status === "thinking" ? "Thinking…" :
    status === "speaking" ? "Speaking…" :
    status === "error" ? "Connection error" : "";

  return (
    <div className="w-full flex flex-col items-center gap-2 px-4 pb-2 pt-1 animate-fade-in">
      {reply && (
        <div className="text-center text-muted-foreground text-sm max-w-md max-h-24 overflow-y-auto">
          {reply}
        </div>
      )}
      {transcript && (
        <div className="text-center text-foreground text-base max-w-md">{transcript}</div>
      )}

      <div className="relative flex items-center justify-center">
        <div
          className={`absolute inset-0 rounded-full bg-primary/20 blur-xl transition-opacity duration-300 ${
            status === "speaking" ? "opacity-100 animate-pulse" : "opacity-40"
          }`}
        />
        <div
          className={`relative w-20 h-20 rounded-full overflow-hidden flex items-center justify-center bg-background ring-1 ring-border transition-transform duration-300 ${
            status === "speaking"
              ? "scale-110 animate-pulse"
              : status === "listening"
                ? "scale-100"
                : "scale-95"
          }`}
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
          className="w-9 h-9 rounded-full bg-foreground text-background flex items-center justify-center hover:opacity-90 transition"
          aria-label="Close voice mode"
          title="End voice mode"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
