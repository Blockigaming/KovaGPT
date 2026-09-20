import { useRef, useState } from "react";
import { ArrowLeftRight, Check, Copy, Loader2, Paperclip, Sparkles } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";
import { TRANSLATION_LANGUAGES, type TranslationPair } from "@/lib/translation-catalog";

type Refinement = "translate" | "fluent" | "professional" | "simple";
const MAX_FILE_BYTES = 40_000;
const MAX_INPUT_CHARACTERS = 40_000;
const WRITE_MAX_BODY_BYTES = 64 * 1024;

function LanguageSelect({
  label,
  value,
  allowDetect,
  onChange,
}: {
  label: string;
  value: string;
  allowDetect?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="min-w-0 flex-1">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full truncate rounded-xl border border-border bg-background px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {allowDetect && <option>Detect language</option>}
        {TRANSLATION_LANGUAGES.map((language) => (
          <option key={language}>{language}</option>
        ))}
      </select>
    </label>
  );
}

const refinements = [
  {
    id: "fluent" as const,
    title: "Make it sound more fluent",
    description: "Make the wording natural and smooth.",
  },
  {
    id: "professional" as const,
    title: "Make it professional",
    description: "Use a polished workplace tone.",
  },
  {
    id: "simple" as const,
    title: "Explain it like I’m five",
    description: "Rewrite it in very simple language.",
  },
];

export function TranslationWorkspace({ pair }: { pair?: TranslationPair }) {
  const [sourceLanguage, setSourceLanguage] = useState<string>(pair?.source ?? "Detect language");
  const [targetLanguage, setTargetLanguage] = useState<string>(pair?.target ?? "Spanish");
  const [source, setSource] = useState("");
  const [translation, setTranslation] = useState("");
  const [busy, setBusy] = useState<Refinement | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const revisionRef = useRef(0);

  const title = pair
    ? `Translate ${pair.source} To ${pair.target === "Portuguese (Portugal)" ? "Portuguese" : pair.target} In Kova`
    : "Translate with Kova";

  const run = async (refinement: Refinement = "translate") => {
    const input = refinement === "translate" ? source : translation;
    if (!input.trim() || busy) return;
    const instruction =
      refinement === "translate"
        ? `Translate this ${sourceLanguage === "Detect language" ? "from its detected language" : `from ${sourceLanguage}`} to ${targetLanguage}. Preserve the original meaning, tone, names, numbers, formatting, and intent. Return only the translation.`
        : refinement === "fluent"
          ? `Rewrite this ${targetLanguage} translation so it sounds natural and fluent. Preserve every fact and return only the revised translation.`
          : refinement === "professional"
            ? `Rewrite this ${targetLanguage} translation in a polished professional tone. Preserve every fact and return only the revised translation.`
            : `Rewrite this ${targetLanguage} translation in very simple language while preserving its meaning. Return only the revision.`;
    const requestBody = JSON.stringify({
      text: input,
      action: "custom",
      instructions: instruction,
    });
    if (new TextEncoder().encode(requestBody).byteLength > WRITE_MAX_BODY_BYTES) {
      setError("Shorten your text so the request stays below 64 KB.");
      return;
    }

    const requestRevision = revisionRef.current;
    setBusy(refinement);
    setError("");
    setCopied(false);
    try {
      const response = await fetchWithTimeoutAuthenticated("/api/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        text?: string;
        error?: string;
      };
      if (requestRevision !== revisionRef.current) return;
      if (!response.ok || typeof payload.text !== "string" || !payload.text.trim()) {
        setError(
          response.status === 401
            ? "Sign in to translate with Kova. Your text is still here."
            : "Kova couldn't translate that right now. Your text is still here—please try again.",
        );
        return;
      }
      setTranslation(payload.text);
    } catch {
      if (requestRevision !== revisionRef.current) return;
      setError(
        "Kova couldn't reach the translation service. Your text is still here—please try again.",
      );
    } finally {
      setBusy(null);
    }
  };

  const swap = () => {
    if (sourceLanguage === "Detect language") return;
    revisionRef.current += 1;
    setSourceLanguage(targetLanguage);
    setTargetLanguage(sourceLanguage);
    setSource(translation || source);
    setTranslation(translation ? source : "");
    setError("");
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    setError("");
    if (file.size > MAX_FILE_BYTES) {
      setError("Choose a text file no larger than 40 KB.");
    } else if (!file.type.startsWith("text/") && !/\.(txt|md|csv|json)$/iu.test(file.name)) {
      setError("Kova can import TXT, Markdown, CSV, or JSON files here.");
    } else {
      try {
        const importedText = await file.text();
        if (importedText.length > MAX_INPUT_CHARACTERS) {
          setError("Choose a text file with no more than 40,000 characters.");
          return;
        }
        revisionRef.current += 1;
        setSource(importedText);
        setTranslation("");
      } catch {
        setError("Kova couldn't read that file. Your existing text was not changed.");
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(translation);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Copying is blocked in this browser. Select the translation and copy it manually.");
    }
  };

  return (
    <AppShell>
      <main
        id="main-content"
        tabIndex={-1}
        className="min-h-full bg-background px-4 pb-12 pt-12 sm:px-6 sm:pt-16 lg:px-8"
      >
        <div className="mx-auto w-full max-w-4xl">
          <header className="text-center">
            <h1 className="text-[30px] font-semibold tracking-[-0.03em] sm:text-[34px]">{title}</h1>
            <p className="mt-2 text-[15px] leading-6 text-muted-foreground sm:text-base">
              Translate text while keeping the original meaning, tone, and intent intact.
            </p>
          </header>

          <section className="mt-8" aria-label="Translator">
            <div className="mx-auto flex max-w-xl items-center gap-2">
              <LanguageSelect
                label="Source language"
                value={sourceLanguage}
                allowDetect
                onChange={(value) => {
                  revisionRef.current += 1;
                  setSourceLanguage(value);
                  setTranslation("");
                }}
              />
              <button
                type="button"
                aria-label="Swap source and target languages"
                disabled={sourceLanguage === "Detect language"}
                onClick={swap}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border hover:bg-muted disabled:opacity-35"
              >
                <ArrowLeftRight aria-hidden="true" className="h-4 w-4" />
              </button>
              <LanguageSelect
                label="Target language"
                value={targetLanguage}
                onChange={(value) => {
                  revisionRef.current += 1;
                  setTargetLanguage(value);
                  setTranslation("");
                }}
              />
            </div>

            <div className="mt-4 grid overflow-hidden rounded-[24px] border border-border bg-background shadow-[var(--shadow-composer)] md:grid-cols-2">
              <div className="relative min-h-64 border-b border-border md:border-b-0 md:border-r">
                <label htmlFor="translation-source" className="sr-only">
                  Source content to translate
                </label>
                <textarea
                  id="translation-source"
                  aria-label="Source content to translate"
                  dir="auto"
                  value={source}
                  maxLength={MAX_INPUT_CHARACTERS}
                  onChange={(event) => {
                    revisionRef.current += 1;
                    setSource(event.target.value);
                    setTranslation("");
                    setError("");
                  }}
                  placeholder="Type, paste, or upload file to translate"
                  className="h-full min-h-64 w-full resize-y bg-transparent px-5 pb-16 pt-5 text-[15px] leading-7 outline-none placeholder:text-muted-foreground"
                />
                <div className="absolute inset-x-3 bottom-3 flex items-center gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".txt,.md,.markdown,.csv,.json,text/*"
                    className="sr-only"
                    onChange={(event) => void importFile(event.target.files?.[0])}
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    aria-label="Add files and more"
                    className="grid h-10 w-10 place-items-center rounded-full border border-border hover:bg-muted"
                  >
                    <Paperclip aria-hidden="true" className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={!source.trim() || Boolean(busy)}
                    onClick={() => void run()}
                    className="ml-auto inline-flex min-h-10 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-medium text-background disabled:opacity-30"
                  >
                    {busy === "translate" ? (
                      <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles aria-hidden="true" className="h-4 w-4" />
                    )}
                    Translate
                  </button>
                </div>
              </div>

              <div className="relative min-h-64 bg-muted/25">
                <label htmlFor="translation-output" className="sr-only">
                  Translation
                </label>
                <textarea
                  id="translation-output"
                  aria-label="Translation"
                  dir="auto"
                  value={translation}
                  readOnly
                  placeholder="Translation"
                  className="h-full min-h-64 w-full resize-y bg-transparent px-5 pb-16 pt-5 text-[15px] leading-7 outline-none placeholder:text-muted-foreground"
                />
                <button
                  type="button"
                  aria-label="Copy translation"
                  disabled={!translation}
                  onClick={() => void copy()}
                  className="absolute bottom-3 right-3 inline-flex min-h-10 items-center gap-2 rounded-full border border-border bg-background px-3 text-sm hover:bg-muted disabled:opacity-35"
                >
                  {copied ? (
                    <Check aria-hidden="true" className="h-4 w-4" />
                  ) : (
                    <Copy aria-hidden="true" className="h-4 w-4" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          </section>

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <section aria-label="Refine translation" className="mt-5 grid gap-2 sm:grid-cols-3">
            {refinements.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={!translation || Boolean(busy)}
                onClick={() => void run(item.id)}
                className="min-h-20 rounded-2xl border border-border bg-background px-4 py-3 text-left disabled:opacity-45 enabled:hover:bg-muted"
              >
                <span className="block text-sm font-medium">{item.title}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  {item.description}
                </span>
              </button>
            ))}
          </section>

          <p className="mt-8 text-center text-xs text-muted-foreground">
            Kova can make mistakes. Check important information.
          </p>
        </div>
      </main>
    </AppShell>
  );
}
