import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import { X, Mic, Plus } from "lucide-react";
import {
  createRecognition,
  sttSupported,
  speakRemoteChunk,
  stopSpeaking,
  isRemoteSpeaking,
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
  /** Optional voice id (alloy, echo, sage, ...). */
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

  // Map any legacy browser-voice setting to a Lovable AI voice id.
  const ttsVoice = (() => {
    const allowed = ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"];
    return allowed.includes(voiceName) ? voiceName : "alloy";
  })();

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
        const resp = await authFetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history, mode: "auto", voice: true }),
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
          // Only split on real sentence boundaries so speech is grammatical.
          const re = force
            ? /(.+)/s
            : started
              ? /([^.!?\n]+[.!?\n]+)/
              : /([^.!?\n]{12,}[.!?\n]+)/;

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
            speakRemoteChunk(sentence, { voiceId: ttsVoice, rate: voiceRate });
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
        if (speakBuffer.trim()) {
          if (!started) {
            started = true;
            setStatus("speaking");
            speakingRef.current = true;
          }
          speakRemoteChunk(speakBuffer.trim(), { voiceId: ttsVoice, rate: voiceRate });
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

      const checkDone = () => {
        if (isRemoteSpeaking()) {
          setTimeout(checkDone, 200);
        } else {
          speakingRef.current = false;
          setStatus("listening");
        }
      };
      checkDone();
    },
    [onTurn, ttsVoice, voiceRate],
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

    const rec = createRecognition(
      (text, isFinal) => {
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
          silenceTimer = setTimeout(() => {
            setTranscript((current) => {
              const toSend = current.trim();
              if (toSend) {
                sendToAI(toSend);
                return "";
              }
              return current;
            });
          }, 200);
        } else {
          setPartial(text);
          if (silenceTimer) {
            clearTimeout(silenceTimer);
            silenceTimer = null;
          }
        }
      },
      () => {
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const label =
    status === "listening" ? "Listening…" :
    status === "thinking" ? "Thinking…" :
    status === "speaking" ? "Speaking…" : "";

  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col">
      {/* Transcript / reply area — fills the empty space above the logo */}
      <div className="flex-1 overflow-y-auto px-6 pt-6 pb-2 flex flex-col items-center justify-end gap-4">
        {reply && (
          <div className="text-center text-white/70 text-sm max-w-md max-h-40 overflow-y-auto">
            {reply}
          </div>
        )}
        {(partial || transcript) && (
          <div className="text-center text-white text-lg max-w-md">
            {transcript} <span className="text-white/50">{partial}</span>
          </div>
        )}
        {label && (
          <div className="text-xs uppercase tracking-widest text-white/40">{label}</div>
        )}
      </div>

      {/* Logo circle sits right above the chat bar */}
      <div className="flex justify-center pb-4">
        <div
          className={`w-16 h-16 rounded-full overflow-hidden flex items-center justify-center bg-gradient-to-br from-sky-300 via-sky-400 to-blue-600 shadow-[0_0_40px_rgba(56,189,248,0.35)] ${
            status === "speaking" ? "animate-pulse" : ""
          }`}
        >
          <NovaLogo className="w-10 h-10" />
        </div>
      </div>

      {/* Bottom chat-bar row */}
      <div className="px-3 pb-6 pt-2 flex items-center gap-3">
        <div className="flex-1 flex items-center gap-2 rounded-full bg-white/10 px-4 py-3">
          <Plus className="w-5 h-5 text-white/70 shrink-0" />
          <span className="flex-1 text-white/50 text-base truncate">Ask KovaGPT</span>
          <button
            type="button"
            className="p-1 rounded-full hover:bg-white/10 transition"
            aria-label="Microphone"
          >
            <Mic className="w-5 h-5 text-white/80" />
          </button>
        </div>
        <button
          onClick={onClose}
          className="w-11 h-11 rounded-full bg-white text-black flex items-center justify-center shrink-0 hover:bg-white/90 transition"
          aria-label="Close voice mode"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
