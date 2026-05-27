import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  createRecognition,
  sttSupported,
  speakChunk,
  stopSpeaking,
  defaultVoiceName,
} from "@/lib/voice";
import { NovaLogo } from "@/components/NovaLogo";
import type { Message } from "@/lib/chat-store";
import { toast } from "sonner";

type Status = "idle" | "listening" | "thinking" | "speaking";

export function VoiceMode({
  open,
  onClose,
  initialMessages,
  voiceName,
  voiceRate,
  onTurn,
}: {
  open: boolean;
  onClose: () => void;
  initialMessages: Message[];
  voiceName: string;
  voiceRate: number;
  /** Called when a full user/assistant turn completes so the parent can persist it. */
  onTurn?: (userText: string, assistantText: string) => void;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState("");
  const [partial, setPartial] = useState("");
  const [reply, setReply] = useState("");
  const recRef = useRef<any>(null);
  const messagesRef = useRef<Message[]>(initialMessages);
  const speakingRef = useRef(false);
  const inflightAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    messagesRef.current = initialMessages;
  }, [initialMessages]);

  const sendToAI = useCallback(
    async (userText: string) => {
      setStatus("thinking");
      setReply("");
      const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: userText };
      const history = [...messagesRef.current, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
        attachments: m.attachments,
      }));
      const ctl = new AbortController();
      inflightAbortRef.current = ctl;
      let assembled = "";
      try {
        const resp = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history, mode: "auto" }),
          signal: ctl.signal,
        });
        if (!resp.ok || !resp.body) throw new Error("Chat request failed");
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let done = false;
        let speakBuffer = "";
        let started = false;
        const flushSentence = (force = false) => {
          // Match up through sentence end or comma/clause for snappier starts on first chunk
          const re = force ? /(.+)/s : (started ? /([^.!?\n]+[.!?\n]+)/ : /([^,.!?\n]{12,}[,.!?\n])/);
          let m: RegExpMatchArray | null;
          while ((m = speakBuffer.match(re))) {
            const sentence = m[1].trim();
            speakBuffer = speakBuffer.slice(m[0].length);
            if (!sentence) continue;
            if (!started) {
              started = true;
              setStatus("speaking");
              speakingRef.current = true;
            }
            speakChunk(sentence, {
              voice: voiceName || defaultVoiceName(),
              rate: voiceRate,
            });
            if (force) break;
          }
        };
        while (!done) {
          const { done: d, value } = await reader.read();
          if (d) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n")) !== -1) {
            let line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (!line || !line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") { done = true; break; }
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                assembled += delta;
                speakBuffer += delta;
                setReply((r) => r + delta);
                flushSentence(false);
              }
            } catch { /* ignore */ }
          }
        }
        // Flush remainder
        if (speakBuffer.trim()) {
          if (!started) {
            started = true;
            setStatus("speaking");
            speakingRef.current = true;
          }
          speakChunk(speakBuffer.trim(), {
            voice: voiceName || defaultVoiceName(),
            rate: voiceRate,
          });
          speakBuffer = "";
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          toast.error((e as Error).message || "Voice chat failed");
        }
        setStatus("listening");
        return;
      }
      messagesRef.current = [
        ...messagesRef.current,
        userMsg,
        { id: crypto.randomUUID(), role: "assistant", content: assembled },
      ];
      onTurn?.(userText, assembled);

      // Poll for speech completion → return to listening
      const checkDone = () => {
        if (typeof window === "undefined") return;
        if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
          setTimeout(checkDone, 200);
        } else {
          speakingRef.current = false;
          setStatus("listening");
        }
      };
      checkDone();
    },
    [onTurn, voiceName, voiceRate],
  );

  // Start/stop recognition with open state
  useEffect(() => {
    if (!open) return;
    if (!sttSupported()) {
      toast.error("Voice mode isn't supported in this browser. Try Chrome.");
      onClose();
      return;
    }

    setTranscript("");
    setPartial("");
    setReply("");
    setStatus("listening");

    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    let lastInterim = "";

    const rec = createRecognition(
      (text, isFinal) => {
        // If AI is speaking and user starts talking → interrupt
        if (speakingRef.current && text.trim().length > 0) {
          stopSpeaking();
          speakingRef.current = false;
          inflightAbortRef.current?.abort();
          setStatus("listening");
        }
        if (isFinal) {
          const finalText = text.trim();
          if (!finalText) return;
          setTranscript((t) => (t ? t + " " : "") + finalText);
          setPartial("");
          if (silenceTimer) clearTimeout(silenceTimer);
          // Wait a brief moment for any continuation, then send
          silenceTimer = setTimeout(() => {
            setTranscript((current) => {
              const toSend = current.trim();
              if (toSend) {
                sendToAI(toSend);
                return "";
              }
              return current;
            });
          }, 350);
        } else {
          setPartial(text);
          lastInterim = text;
          // Don't auto-send on interim, but reset the silence timer if user keeps talking
          if (silenceTimer) {
            clearTimeout(silenceTimer);
            silenceTimer = null;
          }
        }
      },
      () => {
        // Auto-restart if voice mode is still open (continuous mode can stop on its own)
        if (recRef.current === rec && open) {
          try { rec.start(); } catch { /* ignore */ }
        }
      },
    );

    if (!rec) {
      toast.error("Could not start voice recognition.");
      onClose();
      return;
    }
    recRef.current = rec;
    try { rec.start(); } catch { /* already started */ }

    return () => {
      recRef.current = null;
      try { rec.stop(); } catch { /* ignore */ }
      stopSpeaking();
      inflightAbortRef.current?.abort();
      if (silenceTimer) clearTimeout(silenceTimer);
      // suppress unused warning
      void lastInterim;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const label =
    status === "listening" ? "Listening…" :
    status === "thinking" ? "Thinking…" :
    status === "speaking" ? "Speaking…" : "";

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col items-center justify-center p-6">
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full hover:bg-accent transition"
        aria-label="Close voice mode"
      >
        <X className="w-6 h-6" />
      </button>

      <div className="flex flex-col items-center gap-8 max-w-xl w-full">
        <div className="relative">
          <div
            className={`w-40 h-40 rounded-full bg-gradient-to-br from-primary to-primary/40 flex items-center justify-center ${
              status === "speaking" ? "animate-pulse" : status === "listening" ? "animate-[pulse_2s_ease-in-out_infinite]" : ""
            }`}
            style={{
              boxShadow:
                status === "speaking"
                  ? "0 0 60px 10px hsl(var(--primary) / 0.4)"
                  : status === "listening"
                  ? "0 0 40px 4px hsl(var(--primary) / 0.25)"
                  : "none",
            }}
          >
            <NovaLogo className="w-20 h-20" />
          </div>
        </div>

        <div className="text-sm text-muted-foreground font-medium">{label}</div>

        {(partial || transcript) && (
          <div className="text-center text-foreground/90 text-lg max-w-md">
            {transcript} <span className="text-muted-foreground">{partial}</span>
          </div>
        )}

        {reply && (
          <div className="text-center text-muted-foreground text-sm max-w-md max-h-32 overflow-y-auto">
            {reply}
          </div>
        )}

        <div className="text-xs text-muted-foreground text-center max-w-sm">
          Just talk — Nova will reply out loud. Start talking again any time to interrupt.
        </div>
      </div>
    </div>
  );
}
