import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { authFetch } from "@/lib/auth-fetch";
import { useEffect, useRef, useState } from "react";
import { PanelLeft, ArrowUp, Loader2, Download, Trash2, Paperclip, Sparkles } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { SettingsDialog } from "@/components/SettingsDialog";

import { LoginPromptDialog } from "@/components/LoginPromptDialog";
import { LimitReachedDialog } from "@/components/LimitReachedDialog";
import { getUsage } from "@/lib/limits";
import { useNovaSettings } from "@/lib/use-nova-settings";
import { SignInButton, SignUpButton, UserButton, useUser } from "@/components/auth/ClerkSafe";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/images")({
  component: ImagesPage,
  head: () => ({
    meta: [
      { title: "AI Image Generation | KovaGPT" },
      { name: "description", content: "Create AI-generated images from text prompts with KovaGPT. Pick a style, describe what you want, and save the results." },
      { property: "og:title", content: "AI Image Generation | KovaGPT" },
      { property: "og:description", content: "Create AI-generated images from text prompts with KovaGPT." },
      { property: "og:url", content: "https://kovagpt.com/images" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "AI Image Generation | KovaGPT" },
      { name: "twitter:description", content: "Create AI-generated images from text prompts with KovaGPT." },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/images" }],
  }),
});

type Preset = { label: string; prompt: string; seed: string; gradient: string };

const PRESETS: Preset[] = [
  { label: "Portrait mode", prompt: "A cinematic close-up portrait, soft natural light, shallow depth of field", seed: "portrait-mode", gradient: "from-rose-400 via-orange-300 to-amber-200" },
  { label: "Sticker pack", prompt: "A cute die-cut sticker illustration of my subject, thick white border, flat colors", seed: "sticker-pack", gradient: "from-violet-400 via-fuchsia-300 to-pink-200" },
  { label: "Bobblehead", prompt: "A miniature bobblehead figurine on a stadium field, oversized head, detailed uniform, studio lighting", seed: "bobblehead", gradient: "from-emerald-400 via-lime-300 to-yellow-200" },
  { label: "Action shot", prompt: "A dynamic action shot mid-motion, dramatic lighting, sports photography, sharp focus", seed: "action-shot", gradient: "from-sky-400 via-cyan-300 to-emerald-200" },
  { label: "Handwritten", prompt: "A candid family moment illustrated in a warm handwritten storybook style, pastel palette", seed: "handwritten", gradient: "from-indigo-400 via-blue-300 to-cyan-200" },
  { label: "Interior design", prompt: "A modern interior of my described room, warm wood, natural light, magazine photography", seed: "interior-design", gradient: "from-amber-500 via-orange-300 to-rose-200" },
  { label: "Action figure", prompt: "A collectible action figure of my subject in a blister-pack toy box with accessories, product photo", seed: "action-figure", gradient: "from-blue-500 via-indigo-400 to-purple-300" },
  { label: "Disco mode", prompt: "A shiny mirrorball sculpture of my subject on a reflective black stage, studio lights, sparkle", seed: "disco-mode", gradient: "from-slate-800 via-slate-500 to-slate-200" },
  { label: "App icon", prompt: "A polished app icon for my described product, gradient background, rounded corners, minimal", seed: "app-icon", gradient: "from-fuchsia-500 via-pink-400 to-orange-300" },
  { label: "Logo mark", prompt: "A minimal vector logo mark for my described brand, symmetrical, black on white", seed: "logo-mark", gradient: "from-neutral-800 via-neutral-500 to-neutral-200" },
];

type HistoryItem = { id: string; prompt: string; imageUrl: string; createdAt: number };
const HISTORY_KEY_PREFIX = "novagpt-image-history-";
const HISTORY_LIMIT = 60;

function loadHistory(userKey: string | null): HistoryItem[] {
  if (!userKey || typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY_PREFIX + userKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function saveHistory(userKey: string | null, items: HistoryItem[]) {
  if (!userKey || typeof window === "undefined") return;
  try { localStorage.setItem(HISTORY_KEY_PREFIX + userKey, JSON.stringify(items.slice(0, HISTORY_LIMIT))); } catch {/*ignore*/}
}

function ImagesPage() {
  const navigate = useNavigate();
  const { isSignedIn, user } = useUser();
  const userKey = (user as { id?: string } | null)?.id ?? null;
  const [settings, setSettings] = useNovaSettings(userKey);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined);
  const openSettings = (tab?: string) => { setSettingsTab(tab); setSettingsOpen(true); };
  useEffect(() => {
    const h = (e: Event) => openSettings((e as CustomEvent<{ tab?: string }>).detail?.tab);
    window.addEventListener("kova-open-settings", h);
    return () => window.removeEventListener("kova-open-settings", h);
  }, []);
  const openHelp = () => navigate({ to: "/help" as never });

  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [resultPrompt, setResultPrompt] = useState<string>("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);
  const [limitMessage, setLimitMessage] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const submittingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isSignedIn && userKey) setHistory(loadHistory(userKey));
    else setHistory([]);
  }, [isSignedIn, userKey]);

  function addToHistory(p: string, imageUrl: string) {
    if (!isSignedIn || !userKey) return;
    const item: HistoryItem = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, prompt: p, imageUrl, createdAt: Date.now() };
    setHistory((prev) => {
      const next = [item, ...prev].slice(0, HISTORY_LIMIT);
      saveHistory(userKey, next);
      return next;
    });
  }
  function removeFromHistory(id: string) {
    setHistory((prev) => {
      const next = prev.filter((h) => h.id !== id);
      saveHistory(userKey, next);
      return next;
    });
  }

  async function generate(p: string) {
    const trimmed = p.trim();
    if (!trimmed || submittingRef.current) return;
    if (!isSignedIn) { setLoginOpen(true); return; }
    submittingRef.current = true;
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await authFetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data?.error || "Failed to generate image";
        if (res.status === 429 && /limit/i.test(msg)) { setLimitMessage(msg); setLimitOpen(true); }
        throw new Error(msg);
      }
      setResult(data.imageUrl);
      setResultPrompt(trimmed);
      addToHistory(trimmed, data.imageUrl);
      setPrompt("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate image");
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  const usePreset = (p: Preset) => {
    setPrompt(p.prompt);
    inputRef.current?.focus();
  };

  return (
    <div className="flex h-dvh w-full bg-background text-foreground">
      <Sidebar
        conversations={[]}
        activeId={null}
        onSelect={() => {}}
        onNew={() => navigate({ to: "/" })}
        onDelete={() => {}}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        onOpenSettings={openSettings}
        onOpenHelp={() => setHelpOpen(true)}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 flex items-center px-3 border-b border-border shrink-0">
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="p-2 rounded-lg hover:bg-accent transition mr-1"
              aria-label="Toggle sidebar"
            >
              <PanelLeft className="w-5 h-5" />
            </button>
          )}
          <h1 className="text-lg font-semibold tracking-tight">Images</h1>
          <div className="ml-auto flex items-center gap-2">
            {isSignedIn ? (
              <UserButton />
            ) : (
              <>
                <SignInButton mode="modal">
                  <button className="text-sm font-medium px-4 py-1.5 rounded-full bg-foreground text-background hover:opacity-90 transition">Log in</button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="text-sm font-medium px-3 sm:px-4 py-1.5 rounded-full bg-neutral-200 text-neutral-900 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-white dark:hover:bg-neutral-700 transition whitespace-nowrap">Sign up for free</button>
                </SignUpButton>
              </>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 pb-40">
            {/* Create an image */}
            <section>
              <h2 className="text-[22px] font-semibold tracking-tight mb-3">Create an image</h2>
              <div className="-mx-4 sm:-mx-6 px-4 sm:px-6 overflow-x-auto scrollbar-none">
                <div className="flex gap-3 pb-2 min-w-max">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => usePreset(p)}
                      className="group flex flex-col items-start w-[128px] shrink-0 focus:outline-none"
                    >
                      <div className={cn(
                        "relative w-[128px] h-[176px] rounded-2xl overflow-hidden ring-1 ring-border/60 bg-gradient-to-br transition-transform duration-200 group-hover:scale-[1.03] group-hover:ring-foreground/30",
                        p.gradient,
                      )}>
                        <img
                          src={`https://picsum.photos/seed/${p.seed}/256/352`}
                          alt=""
                          loading="lazy"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                          className="absolute inset-0 w-full h-full object-cover mix-blend-luminosity opacity-90"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
                      </div>
                      <span className="mt-2 text-sm text-foreground/90 group-hover:text-foreground text-center w-full">{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* Current result */}
            {(loading || result || error) && (
              <section className="mt-8">
                {loading && !result && (
                  <div className="max-w-md mx-auto aspect-square rounded-3xl overflow-hidden bg-muted relative ring-1 ring-border">
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-foreground/10 to-transparent animate-[shimmer_1.6s_infinite]" style={{ backgroundSize: "200% 100%" }} />
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                      <Loader2 className="w-6 h-6 animate-spin" />
                      <div className="text-sm">Generating your image…</div>
                    </div>
                  </div>
                )}
                {result && (
                  <div className="max-w-md mx-auto">
                    <img src={result} alt={resultPrompt || "Generated image"} className="w-full rounded-3xl ring-1 ring-border" />
                    <div className="flex justify-center mt-3 gap-2 flex-wrap">
                      <a href={result} download="kovagpt-image.png" className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-full border border-border hover:bg-accent transition">
                        <Download className="w-4 h-4" /> Download
                      </a>
                    </div>
                  </div>
                )}
                {error && <div className="mt-3 text-sm text-destructive text-center">{error}</div>}
              </section>
            )}

            {/* My images */}
            <section className="mt-10">
              <h2 className="text-[22px] font-semibold tracking-tight mb-3">My images</h2>
              {history.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border p-10 text-center">
                  <div className="mx-auto w-10 h-10 rounded-full bg-foreground/5 flex items-center justify-center mb-3">
                    <Sparkles className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Nothing here yet. Pick a style above or describe an image below.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {history.map((h) => (
                    <div key={h.id} className="group relative aspect-square rounded-2xl overflow-hidden bg-muted ring-1 ring-border">
                      <img src={h.imageUrl} alt={h.prompt} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition bg-gradient-to-t from-black/85 via-black/25 to-transparent flex flex-col justify-end p-2 gap-1.5">
                        <p className="text-[11px] text-white line-clamp-2" title={h.prompt}>{h.prompt}</p>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => { setPrompt(h.prompt); inputRef.current?.focus(); }}
                            className="flex-1 text-[11px] px-2 py-1 rounded-full bg-white text-black font-medium hover:opacity-90"
                          >
                            Reuse
                          </button>
                          <a href={h.imageUrl} download={`kovagpt-${h.id}.png`} className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white" aria-label="Download">
                            <Download className="w-3.5 h-3.5" />
                          </a>
                          <button onClick={() => removeFromHistory(h.id)} className="w-7 h-7 rounded-full bg-white/15 hover:bg-destructive flex items-center justify-center text-white" aria-label="Remove">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>

        {/* Bottom composer */}
        <div className="sticky bottom-0 border-t border-border/60 bg-gradient-to-t from-background via-background to-background/80 backdrop-blur">
          <form
            onSubmit={(e) => { e.preventDefault(); generate(prompt); }}
            className="max-w-3xl mx-auto px-4 sm:px-6 py-3"
          >
            <div className="flex items-end gap-2 rounded-3xl border border-border bg-card shadow-sm px-3 py-2.5">
              <button type="button" aria-label="Attach" className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition shrink-0">
                <Paperclip className="w-5 h-5" />
              </button>
              <textarea
                ref={inputRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generate(prompt); }
                }}
                rows={1}
                placeholder="Describe an image"
                className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-muted-foreground resize-none py-1.5 max-h-40"
              />
              <button
                type="submit"
                disabled={!prompt.trim() || loading}
                className="w-9 h-9 rounded-full bg-foreground text-background flex items-center justify-center disabled:opacity-30 hover:opacity-90 transition shrink-0"
                aria-label="Generate"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
              </button>
            </div>
          </form>
        </div>
      </main>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onChange={setSettings}
        initialTab={settingsTab}
        onClearAll={() => {
          try {
            for (const k of Object.keys(localStorage)) {
              if (k.startsWith("novagpt-image-history-") || k.startsWith("nova-gpt-conversations")) localStorage.removeItem(k);
            }
          } catch { /* ignore */ }
          setHistory([]);
        }}
      />
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <LoginPromptDialog
        open={loginOpen}
        onOpenChange={setLoginOpen}
        title="Log in to continue"
        description="Sign in or create a free KovaGPT account to generate images and save them to your library."
      />
      <LimitReachedDialog
        open={limitOpen}
        onOpenChange={setLimitOpen}
        kind="image"
        message={limitMessage}
        resetsAt={getUsage().resetsAt}
      />
    </div>
  );
}
