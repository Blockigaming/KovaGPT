import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  Copy,
  FlaskConical,
  Layers3,
  Library,
  Sparkles,
  X,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useUser } from "@/components/auth/ClerkSafe";
import { saveToLibrary } from "@/lib/library.functions";
import {
  addToContextPack,
  continueInResearch,
  openInWork,
  type WorkspaceHandoff,
} from "@/lib/workspace-handoffs";
import { installShortcutListener } from "@/lib/shortcuts";

const HISTORY_KEY = "kova-lens-history-v1";
type LensHistory = { text: string; title: string; at: number };

function selectionText() {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? 0;
    if (end > start) return active.value.slice(start, end);
  }
  return window.getSelection()?.toString() ?? "";
}

export function KovaLens() {
  const { isSignedIn } = useUser();
  const save = useServerFn(saveToLibrary);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [history, setHistory] = useState<LensHistory[]>([]);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const show = useCallback(() => {
    const selected = selectionText().trim();
    setText((current) => selected || current);
    try {
      setHistory(JSON.parse(sessionStorage.getItem(HISTORY_KEY) ?? "[]"));
    } catch {
      setHistory([]);
    }
    setOpen(true);
  }, []);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const custom = () => show();
    const removeShortcut = installShortcutListener({ "open-lens": show });
    window.addEventListener("keydown", keydown);
    window.addEventListener("kova-open-lens", custom);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("kova-open-lens", custom);
      removeShortcut();
    };
  }, [show]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const handoff = (): WorkspaceHandoff => ({
    type: "chat",
    id: crypto.randomUUID(),
    title: document.title.replace(/ \| KovaGPT$/, "") || "Quick capture",
    content: text.trim(),
  });
  const remember = () => {
    const value = text.trim();
    if (!value) return;
    const next = [
      { text: value.slice(0, 4000), title: document.title, at: Date.now() },
      ...history.filter((item) => item.text !== value),
    ].slice(0, 8);
    setHistory(next);
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  };
  const goChat = () => {
    if (!text.trim()) return;
    remember();
    sessionStorage.setItem("kova-prompt-launch", JSON.stringify({ prompt: text.trim() }));
    window.location.href = "/";
  };
  const saveLibrary = async () => {
    if (!text.trim() || !isSignedIn) return;
    setSaving(true);
    try {
      await save({
        data: {
          title: handoff().title,
          item_type: "document",
          source: "manual",
          content_text: text.trim(),
        },
      });
      remember();
      toast.success("Saved to Library");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save to Library");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-40 grid h-11 w-11 place-items-center rounded-full border bg-background/90 shadow-lg backdrop-blur hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Open Kova Lens"
        title="Kova Lens · Ctrl/⌘ Shift K"
      >
        <Sparkles className="h-4 w-4" />
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-black/35 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="kova-lens-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section className="w-full max-w-2xl rounded-t-2xl border bg-background p-4 shadow-2xl sm:rounded-2xl">
            <header className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              <div>
                <h2 id="kova-lens-title" className="font-semibold">
                  Kova Lens
                </h2>
                <p className="text-xs text-muted-foreground">Capture once. Continue anywhere.</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="ml-auto p-2"
                aria-label="Close Kova Lens"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <label className="mt-3 block">
              <span className="sr-only">Captured text or idea</span>
              <textarea
                ref={inputRef}
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={5}
                placeholder="Type an idea, paste context, or select text before opening Lens…"
                className="w-full resize-none rounded-xl border bg-muted/20 p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <button
                disabled={!text.trim()}
                onClick={goChat}
                className="flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm hover:bg-accent disabled:opacity-40"
              >
                <ArrowUpRight className="h-4 w-4" />
                Ask in Chat
              </button>
              <button
                disabled={!text.trim()}
                onClick={() => {
                  remember();
                  openInWork(handoff());
                }}
                className="flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm hover:bg-accent disabled:opacity-40"
              >
                <BriefcaseBusiness className="h-4 w-4" />
                Open in Work
              </button>
              <button
                disabled={!text.trim()}
                onClick={() => {
                  remember();
                  continueInResearch(handoff());
                }}
                className="flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm hover:bg-accent disabled:opacity-40"
              >
                <FlaskConical className="h-4 w-4" />
                Research
              </button>
              <button
                disabled={!text.trim()}
                onClick={() => {
                  remember();
                  addToContextPack(handoff());
                }}
                className="flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm hover:bg-accent disabled:opacity-40"
              >
                <Layers3 className="h-4 w-4" />
                Context Pack
              </button>
              <button
                disabled={!text.trim() || !isSignedIn || saving}
                onClick={saveLibrary}
                className="flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm hover:bg-accent disabled:opacity-40"
              >
                <Library className="h-4 w-4" />
                {saving ? "Saving…" : "Save to Library"}
              </button>
              <button
                disabled={!text.trim()}
                onClick={async () => {
                  await navigator.clipboard.writeText(text);
                  toast.success("Copied");
                }}
                className="flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm hover:bg-accent disabled:opacity-40"
              >
                <Copy className="h-4 w-4" />
                Copy
              </button>
            </div>
            {history.length ? (
              <div className="mt-4 border-t pt-3">
                <h3 className="text-xs font-medium text-muted-foreground">Recent captures</h3>
                <div className="mt-2 flex gap-2 overflow-x-auto">
                  {history.slice(0, 5).map((item) => (
                    <button
                      key={`${item.at}:${item.text}`}
                      onClick={() => setText(item.text)}
                      className="max-w-48 shrink-0 truncate rounded-lg border px-3 py-2 text-left text-xs hover:bg-accent"
                    >
                      {item.text}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <p className="mt-3 text-[11px] text-muted-foreground">
              Nothing is sent until you choose an action. Recent captures stay in this browser tab.
            </p>
          </section>
        </div>
      ) : null}
    </>
  );
}
