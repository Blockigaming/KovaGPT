import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelLeft, ChevronDown, ChevronLeft, ChevronRight, ImageIcon, ArrowUp, Mic, Loader2, Download, Trash2, History } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { SettingsDialog, type Settings, DEFAULT_SETTINGS } from "@/components/SettingsDialog";
import { HelpDialog } from "@/components/HelpDialog";
import { LoginPromptDialog } from "@/components/LoginPromptDialog";
import {
  SignInButton,
  SignUpButton,
  UserButton,
  useUser,
} from "@/components/auth/ClerkSafe";


export const Route = createFileRoute("/images")({
  component: ImagesPage,
  head: () => ({
    meta: [
      { title: "AI Image Generation — NovaGPT" },
      {
        name: "description",
        content:
          "Create AI-generated images from text prompts with NovaGPT. Explore styles, save your history, and download results in seconds.",
      },
      { property: "og:title", content: "AI Image Generation — NovaGPT" },
      {
        property: "og:description",
        content: "Create AI-generated images from text prompts with NovaGPT.",
      },
      { property: "og:url", content: "https://nova-aigpt.lovable.app/images" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://nova-aigpt.lovable.app/images" }],
  }),
});


// Curated AI-art style example images (Unsplash, free to use).
const EXAMPLES: { label: string; prompt: string; src: string }[] = [
  {
    label: "Cinematic portrait",
    prompt: "Cinematic portrait of a woman in golden hour light, 85mm lens, shallow depth of field",
    src: "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Cyberpunk city",
    prompt: "Neon-lit cyberpunk Tokyo street at night, rainy reflections, blade runner aesthetic",
    src: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Surreal landscape",
    prompt: "Surreal floating islands above a sea of clouds at sunrise, ethereal lighting",
    src: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Astronaut on Mars",
    prompt: "An astronaut walking on Mars at golden hour, dramatic shadows, hyperreal detail",
    src: "https://images.unsplash.com/photo-1457364887197-9150188c107b?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Watercolor mountains",
    prompt: "Soft watercolor painting of misty mountains and pine forest, pastel palette",
    src: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Anime sunset",
    prompt: "Anime style girl on a rooftop watching a vivid sunset, Makoto Shinkai inspired",
    src: "https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Chibi sticker pack",
    prompt: "Cute chibi sticker of a fox wizard, vector style, white background",
    src: "https://images.unsplash.com/photo-1612392061787-2d078b3e573a?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Product render",
    prompt: "Studio product render of futuristic wireless headphones on a marble pedestal",
    src: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Fantasy castle",
    prompt: "Epic fantasy castle on a cliff at twilight, dramatic clouds, painterly",
    src: "https://images.unsplash.com/photo-1533154683836-84ea7a0bc310?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Cozy interior",
    prompt: "Cozy reading nook with warm lamp light, plants, rainy window, 3D render",
    src: "https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?auto=format&fit=crop&w=600&q=70",
  },
];

type HistoryItem = { id: string; prompt: string; imageUrl: string; createdAt: number };

const HISTORY_KEY_PREFIX = "novagpt-image-history-";
const HISTORY_LIMIT = 50;

function loadHistory(userKey: string | null): HistoryItem[] {
  if (!userKey || typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY_PREFIX + userKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(userKey: string | null, items: HistoryItem[]) {
  if (!userKey || typeof window === "undefined") return;
  try {
    localStorage.setItem(HISTORY_KEY_PREFIX + userKey, JSON.stringify(items.slice(0, HISTORY_LIMIT)));
  } catch {
    /* quota — ignore */
  }
}

function ImagesPage() {
  const { isSignedIn, user } = useUser();
  const userKey = (user as any)?.id ?? null;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // Load per-user history when sign-in state resolves.
  useEffect(() => {
    if (isSignedIn && userKey) {
      setHistory(loadHistory(userKey));
    } else {
      setHistory([]);
    }
  }, [isSignedIn, userKey]);

  function addToHistory(p: string, imageUrl: string) {
    if (!isSignedIn || !userKey) return;
    const item: HistoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      prompt: p,
      imageUrl,
      createdAt: Date.now(),
    };
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

  function clearHistory() {
    setHistory([]);
    saveHistory(userKey, []);
  }

  async function generate(p: string) {
    const trimmed = p.trim();
    if (!trimmed) return;
    if (!isSignedIn) {
      setLoginOpen(true);
      return;
    }
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
      if (!res.ok) throw new Error(data?.error || "Failed to generate image");
      setResult(data.imageUrl);
      addToHistory(trimmed, data.imageUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate image");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen w-full bg-background text-foreground">
      <Sidebar
        conversations={[]}
        activeId={null}
        onSelect={() => {}}
        onNew={() => {}}
        onDelete={() => {}}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 flex items-center px-3 border-b border-border">
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg hover:bg-accent transition mr-1"
              aria-label="Open sidebar"
            >
              <PanelLeft className="w-5 h-5" />
            </button>
          )}
          <button className="flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-accent transition font-semibold">
            <span>NovaGPT</span>
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          </button>
          <div className="ml-auto flex items-center gap-2">
            {isSignedIn ? (
              <UserButton afterSignOutUrl="/" appearance={{ elements: { avatarBox: "w-8 h-8" } }} />

            ) : (
              <>
                <SignInButton mode="modal">
                  <button className="text-sm font-medium px-4 py-1.5 rounded-full bg-foreground text-background hover:opacity-90 transition">
                    Log in
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="text-sm font-medium px-3 sm:px-4 py-1.5 rounded-full hover:bg-accent transition whitespace-nowrap">
                    Sign up for free
                  </button>
                </SignUpButton>
              </>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-6 py-8">
            <h1 className="text-3xl font-semibold mb-6">Images</h1>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                generate(prompt);
              }}
              className="rounded-3xl border border-border bg-card shadow-sm"
            >
              <div className="flex items-center px-4 py-3 gap-2">
                <ImageIcon className="w-5 h-5 text-muted-foreground shrink-0" />
                <input
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe a new image"
                  className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                />
                <button
                  type="button"
                  className="w-8 h-8 rounded-full hover:bg-accent flex items-center justify-center transition"
                  aria-label="Voice input"
                >
                  <Mic className="w-4 h-4" />
                </button>
                <button
                  type="submit"
                  disabled={!prompt.trim() || loading}
                  className="w-8 h-8 rounded-full bg-foreground text-background flex items-center justify-center disabled:opacity-30 hover:opacity-90 transition"
                  aria-label="Generate"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
                </button>
              </div>
            </form>

            {error && (
              <div className="mt-4 text-sm text-destructive">{error}</div>
            )}

            {(loading || result) && (
              <div className="mt-6 rounded-2xl border border-border bg-card overflow-hidden">
                {loading && !result && (
                  <div className="aspect-square w-full max-w-md mx-auto flex flex-col items-center justify-center gap-3 text-muted-foreground">
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <div className="text-sm">Generating your image…</div>
                  </div>
                )}
                {result && (
                  <div className="p-3">
                    <img src={result} alt="AI generated result" className="w-full max-w-md mx-auto rounded-xl" />
                    <div className="flex justify-center mt-3">
                      <a
                        href={result}
                        download="novagpt-image.png"
                        className="inline-flex items-center gap-2 text-sm px-4 py-1.5 rounded-full border border-border hover:bg-accent transition"
                      >
                        <Download className="w-4 h-4" /> Download
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )}

            {isSignedIn && history.length > 0 && (
              <div className="mt-10">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <History className="w-5 h-5" /> Your history
                    <span className="text-xs font-normal text-muted-foreground">
                      {history.length} {history.length === 1 ? "image" : "images"}
                    </span>
                  </h2>
                  <button
                    onClick={clearHistory}
                    className="text-xs text-muted-foreground hover:text-foreground transition"
                  >
                    Clear all
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {history.map((h) => (
                    <div
                      key={h.id}
                      className="group relative aspect-square rounded-2xl overflow-hidden bg-muted border border-border"
                    >
                      <img
                        src={h.imageUrl}
                        alt={h.prompt}
                        loading="lazy"
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition bg-gradient-to-t from-black/80 via-black/30 to-transparent flex flex-col justify-end p-2 gap-1">
                        <p className="text-[11px] text-white line-clamp-2" title={h.prompt}>
                          {h.prompt}
                        </p>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              setPrompt(h.prompt);
                              setResult(h.imageUrl);
                              setError(null);
                            }}
                            className="flex-1 text-[11px] px-2 py-1 rounded-full bg-white text-black font-medium hover:opacity-90"
                          >
                            Reuse
                          </button>
                          <a
                            href={h.imageUrl}
                            download={`novagpt-${h.id}.png`}
                            className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white"
                            aria-label="Download"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>
                          <button
                            onClick={() => removeFromHistory(h.id)}
                            className="w-7 h-7 rounded-full bg-white/15 hover:bg-destructive flex items-center justify-center text-white"
                            aria-label="Remove"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-10">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Explore AI image examples</h2>
                <div className="flex items-center gap-1">
                  <button className="w-8 h-8 rounded-full border border-border hover:bg-accent flex items-center justify-center" aria-label="Previous">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button className="w-8 h-8 rounded-full border border-border hover:bg-accent flex items-center justify-center" aria-label="Next">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Click any example to use it as your prompt.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.label}
                    onClick={() => {
                      setPrompt(ex.prompt);
                      generate(ex.prompt);
                    }}
                    className="group relative aspect-[3/4] rounded-2xl overflow-hidden bg-muted hover:scale-[1.02] transition-transform text-left"
                  >
                    <img
                      src={ex.src}
                      alt={ex.label}
                      loading="lazy"
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/70 to-transparent">
                      <div className="text-sm font-medium text-white">{ex.label}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={DEFAULT_SETTINGS as Settings}
        onChange={() => {}}
        onClearAll={() => {}}
      />
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <LoginPromptDialog open={loginOpen} onOpenChange={setLoginOpen} />
    </div>
  );
}
