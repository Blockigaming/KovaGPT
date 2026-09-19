import { useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  FilePenLine,
  FolderOpen,
  Loader2,
  Paperclip,
  RotateCcw,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { authFetch } from "@/lib/auth-fetch";
import {
  WRITING_FORMATS,
  WRITING_LENGTHS,
  WRITING_TONES,
  type WritingTool,
} from "@/lib/writing-tool-catalog";

const MAX_FILE_BYTES = 1024 * 1024;
const ACCEPTED_FILE_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

function textStats(text: string) {
  const trimmed = text.trim();
  return {
    words: trimmed ? trimmed.split(/\s+/u).length : 0,
    characters: text.length,
    sentences: trimmed ? trimmed.split(/[.!?]+(?:\s|$)/u).filter(Boolean).length : 0,
    lines: text ? text.split(/\r?\n/u).length : 0,
  };
}

function SelectControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="relative inline-flex min-h-10 items-center rounded-xl border border-transparent px-2 text-sm font-medium hover:bg-black/[0.045] dark:hover:bg-white/[0.07]">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="appearance-none bg-transparent py-2 pr-6 outline-none"
      >
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2 h-3.5 w-3.5"
      />
    </label>
  );
}

export function WritingToolWorkspace({ tool }: { tool: WritingTool }) {
  const [text, setText] = useState("");
  const [format, setFormat] = useState("Text");
  const [tone, setTone] = useState("Neutral");
  const [length, setLength] = useState("Standard");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const stats = useMemo(() => textStats(text), [text]);

  const importFile = async (file?: File) => {
    if (!file) return;
    setError("");
    if (file.size > MAX_FILE_BYTES) {
      setError("Choose a text file smaller than 1 MB.");
      return;
    }
    const extension = file.name.toLowerCase().split(".").pop();
    if (
      !ACCEPTED_FILE_TYPES.has(file.type) &&
      !["txt", "md", "csv", "json"].includes(extension ?? "")
    ) {
      setError("Kova can import TXT, Markdown, CSV, or JSON files here.");
      return;
    }
    try {
      setText(await file.text());
      setResult("");
    } catch {
      setError("Kova couldn't read that file. Your existing text was not changed.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const run = async () => {
    if (!text.trim() || busy) return;
    setError("");
    setCopied(false);

    if (tool.action === "count") {
      setResult(
        `${stats.words} words · ${stats.characters} characters · ${stats.sentences} sentences · ${stats.lines} lines`,
      );
      return;
    }
    if (tool.action === "detector") {
      setResult(
        `Writing-pattern review: ${stats.words} words across ${stats.sentences} sentences. No detector can reliably prove whether a person or AI wrote text, so Kova does not invent an “AI percentage.” Review repetitive phrasing, unsupported claims, and voice consistency instead.`,
      );
      return;
    }
    if (tool.action === "plagiarism") {
      setResult(
        "Kova cannot truthfully report a plagiarism score without comparing this text against a licensed source corpus. Check distinctive phrases in a trusted search or institutional checker, and verify that borrowed ideas, quotations, and data have citations.",
      );
      return;
    }

    setBusy(true);
    try {
      const instruction = [
        tool.instruction,
        `Use a ${tone.toLowerCase()} tone, ${length.toLowerCase()} length, and ${format.toLowerCase()} format.`,
      ]
        .filter(Boolean)
        .join(" ");
      const response = await authFetch("/api/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          action: tool.action,
          ...(tool.action === "custom" ? { instructions: instruction } : {}),
          ...(tool.action === "tone" ? { tone } : {}),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        text?: string;
        error?: string;
      };
      if (!response.ok || typeof payload.text !== "string") {
        const message =
          payload.error === "unauthorized"
            ? "Sign in to use Kova's generation tools. Your text is still here."
            : "Kova couldn't complete that request. Your text is still here—please try again.";
        setError(message);
        return;
      }
      setResult(payload.text);
    } catch {
      setError(
        "Kova couldn't reach the writing service. Your text is still here—please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const copyResult = async () => {
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Copying is blocked in this browser. Select the result and copy it manually.");
    }
  };

  return (
    <AppShell>
      <main id="main-content" className="min-h-full bg-background px-4 pb-12 pt-4 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-[760px]">
          <header className="flex min-h-10 items-center gap-1 text-sm text-muted-foreground">
            <Link
              to="/writing"
              className="rounded-lg px-2 py-1 hover:bg-muted hover:text-foreground"
            >
              Writing
            </Link>
            <span aria-hidden="true">›</span>
            <span className="truncate px-2 py-1 text-foreground">{tool.title}</span>
          </header>

          <section className="mt-12 text-center sm:mt-16" aria-labelledby="writing-tool-title">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-border bg-background shadow-sm">
              <FilePenLine aria-hidden="true" className="h-6 w-6" strokeWidth={1.7} />
            </div>
            <h1
              id="writing-tool-title"
              className="mt-5 text-[28px] font-semibold tracking-[-0.025em] sm:text-[32px]"
            >
              {tool.title}
            </h1>
            <p className="mx-auto mt-2 max-w-xl text-[15px] leading-6 text-muted-foreground sm:text-base">
              {tool.shortDescription}
            </p>
          </section>

          <section className="mt-8 overflow-hidden rounded-[26px] border border-black/[0.08] bg-[var(--surface-composer)] shadow-[var(--shadow-composer)] dark:border-white/[0.1]">
            <label htmlFor="writing-input" className="sr-only">
              Text for {tool.title}
            </label>
            <textarea
              id="writing-input"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setResult("");
                setError("");
              }}
              placeholder={tool.placeholder}
              rows={8}
              className="min-h-48 w-full resize-y bg-transparent px-5 pb-3 pt-5 text-[15px] leading-6 outline-none placeholder:text-muted-foreground sm:min-h-52"
            />

            <div className="flex flex-wrap items-center gap-1 border-t border-black/[0.06] px-3 py-2 dark:border-white/[0.08]">
              <input
                ref={inputRef}
                type="file"
                accept=".txt,.md,.markdown,.csv,.json,text/plain,text/markdown,text/csv,application/json"
                className="sr-only"
                onChange={(event) => void importFile(event.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm font-medium hover:bg-black/[0.045] dark:hover:bg-white/[0.07]"
              >
                <Paperclip aria-hidden="true" className="h-4 w-4" /> Upload
              </button>
              <Link
                to="/library"
                className="inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm font-medium hover:bg-black/[0.045] dark:hover:bg-white/[0.07]"
              >
                <FolderOpen aria-hidden="true" className="h-4 w-4" /> Library
              </Link>
              <div className="hidden h-5 w-px bg-border sm:block" />
              <SelectControl
                label="Format"
                value={format}
                options={WRITING_FORMATS}
                onChange={setFormat}
              />
              <SelectControl label="Tone" value={tone} options={WRITING_TONES} onChange={setTone} />
              <SelectControl
                label="Length"
                value={length}
                options={WRITING_LENGTHS}
                onChange={setLength}
              />
              <button
                type="button"
                aria-label={`Run ${tool.title}`}
                disabled={!text.trim() || busy}
                onClick={() => void run()}
                className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-full bg-foreground text-background transition-opacity disabled:cursor-not-allowed disabled:opacity-30"
              >
                {busy ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp aria-hidden="true" className="h-4 w-4" />
                )}
              </button>
            </div>
          </section>

          <div className="mt-2 flex min-h-6 items-center justify-between px-1 text-xs text-muted-foreground">
            <span>
              {stats.words} words · {stats.characters} characters
            </span>
            <span>Files stay in this browser until you submit text.</span>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          {result && (
            <section
              aria-live="polite"
              aria-label="Result"
              className="mt-6 rounded-2xl border border-border bg-background p-5 shadow-sm"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">Result</h2>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => void copyResult()}
                    className="inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-sm hover:bg-muted"
                  >
                    {copied ? (
                      <Check aria-hidden="true" className="h-4 w-4" />
                    ) : (
                      <Copy aria-hidden="true" className="h-4 w-4" />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setResult("");
                      setError("");
                    }}
                    className="grid h-9 w-9 place-items-center rounded-lg hover:bg-muted"
                    aria-label="Clear result"
                  >
                    <RotateCcw aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-[15px] leading-7">{result}</p>
            </section>
          )}

          <section className="mt-8" aria-labelledby="writing-ideas-title">
            <h2 id="writing-ideas-title" className="sr-only">
              Try an example
            </h2>
            <div className="grid gap-2 sm:grid-cols-3">
              {tool.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    setText(suggestion);
                    setResult("");
                    setError("");
                  }}
                  className="min-h-16 rounded-2xl border border-border bg-background px-4 py-3 text-left text-sm leading-5 transition-colors hover:bg-muted"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </section>

          <p className="mt-10 text-center text-xs text-muted-foreground">
            Kova can make mistakes. Check important information, citations, and final wording.
          </p>
        </div>
      </main>
    </AppShell>
  );
}
