import { useEffect, useRef, useState } from "react";
import { ChatMessage } from "./ChatMessage";
import type { Message, PendingConfirm } from "@/lib/chat-store";
import type { KovaReference } from "@/lib/custom-kovas-policy.mjs";
import { fetchForPrincipal } from "@/lib/chat-summary-snapshot.mjs";
import { consumeChatSse, chatResponseError } from "@/lib/chat-sse-client.mjs";
export default function CustomKovaPreview({
  ownerId,
  kova,
  starters,
}: {
  ownerId: string;
  kova: KovaReference;
  starters: string[];
}) {
  const [messages, setMessages] = useState<Message[]>([]),
    [input, setInput] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [apps, setApps] = useState(false);
  const generation = useRef(0),
    abort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      generation.current++;
      abort.current?.abort();
    },
    [],
  );
  async function send(value = input) {
    if (busy || !value.trim()) return;
    const attempt = ++generation.current,
      controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError("");
    const user: Message = { id: crypto.randomUUID(), role: "user", content: value.trim() },
      assistant: Message = { id: crypto.randomUUID(), role: "assistant", content: "" };
    const next = [...messages, user];
    setMessages([...next, assistant]);
    setInput("");
    const current = () => attempt === generation.current && !controller.signal.aborted;
    try {
      const response = await fetchForPrincipal(ownerId, "/api/chat", {
        signal: controller.signal,
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": user.id },
        body: JSON.stringify({
          messages: next.slice(-100).map(({ role, content }) => ({ role, content })),
          kova,
          temporary: true,
          temporaryContext: apps ? "personalized" : "clean",
        }),
      });
      if (!current()) {
        void response.body?.cancel();
        return;
      }
      if (!response.ok || !response.body) throw await chatResponseError(response);
      await consumeChatSse(response.body, {
        signal: controller.signal,
        onEvent: (parsed) => {
          if (!current()) throw new DOMException("Canceled", "AbortError");
          const delta = (parsed as { choices?: { delta?: Record<string, unknown> }[] }).choices?.[0]
            ?.delta;
          if (!delta) return;
          setMessages((old) =>
            old.map((m) => {
              if (m.id !== assistant.id) return m;
              if (delta.kind === "tool_confirm" && typeof delta.action_id === "string")
                return {
                  ...m,
                  pendingConfirms: [
                    ...(m.pendingConfirms ?? []),
                    {
                      actionId: delta.action_id,
                      tool: String(delta.tool ?? ""),
                      summary: String(delta.summary ?? "Review action"),
                      argsPreview: (delta.args_preview ?? {}) as Record<string, unknown>,
                      status: "pending",
                    },
                  ],
                };
              return typeof delta.content === "string"
                ? { ...m, content: m.content + delta.content }
                : m;
            }),
          );
        },
      });
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : "Preview failed.");
    } finally {
      if (current()) setBusy(false);
    }
  }
  function stop() {
    generation.current++;
    abort.current?.abort();
    setBusy(false);
  }
  function updateConfirm(id: string, confirm: PendingConfirm) {
    setMessages((old) =>
      old.map((m) =>
        m.id === id
          ? {
              ...m,
              pendingConfirms: m.pendingConfirms?.map((c) =>
                c.actionId === confirm.actionId ? confirm : c,
              ),
            }
          : m,
      ),
    );
  }
  return (
    <section className="space-y-3 rounded-xl border p-4" aria-label="Kova preview">
      <h2 className="font-semibold">Preview the saved version</h2>
      <p className="text-sm text-muted-foreground">
        Preview conversations stay temporary. They do not enter history or create memory.
      </p>
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          checked={apps}
          disabled={busy || messages.length > 0}
          onChange={(e) => setApps(e.target.checked)}
        />
        Allow my enabled apps in this preview. Each write still requires confirmation.
      </label>
      <div className="flex flex-wrap gap-2">
        {starters.map((s, i) => (
          <button
            key={i}
            className="rounded border px-2 py-1 text-sm"
            disabled={busy}
            onClick={() => void send(s)}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="max-h-[50vh] overflow-y-auto">
        {messages.map((m) => (
          <ChatMessage
            key={m.id}
            message={m}
            userKey={ownerId}
            principalResolved
            temporary
            streaming={busy && m === messages.at(-1)}
            onUpdatePendingConfirm={updateConfirm}
          />
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="space-y-2"
      >
        <label className="block text-sm">
          Preview message
          <textarea
            className="min-h-20 w-full rounded border bg-background p-2"
            maxLength={32000}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
          />
        </label>
        <button
          className="rounded bg-primary px-3 py-2 text-primary-foreground"
          disabled={busy || !input.trim()}
        >
          Send preview
        </button>
        {busy && (
          <button type="button" onClick={stop} className="ml-2 underline">
            Stop
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            stop();
            setMessages([]);
            setError("");
          }}
          className="ml-3 underline"
        >
          Clear preview
        </button>
      </form>
    </section>
  );
}
