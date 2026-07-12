import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { authFetch } from "@/lib/auth-fetch";
import { useEffect, useState } from "react";
import { PanelLeft, ChevronDown, ImageIcon, ArrowUp, Loader2, Download, Trash2, History } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { SettingsDialog } from "@/components/SettingsDialog";
import { HelpDialog } from "@/components/HelpDialog";
import { LoginPromptDialog } from "@/components/LoginPromptDialog";
import { LimitReachedDialog } from "@/components/LimitReachedDialog";
import { getUsage } from "@/lib/limits";

import { useNovaSettings } from "@/lib/use-nova-settings";
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
      { title: "AI Image Generation | KovaGPT" },
      {
        name: "description",
        content:
          "Create AI-generated images from text prompts with KovaGPT. Explore styles, save your history, and download results in seconds.",
      },
      { property: "og:title", content: "AI Image Generation | KovaGPT" },
      {
        property: "og:description",
        content: "Create AI-generated images from text prompts with KovaGPT.",
      },
      { property: "og:url", content: "https://kovagpt.com/images" },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "https://kovagpt.com/og/images.jpg" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "AI Image Generation | KovaGPT" },
      { name: "twitter:description", content: "Create AI-generated images from text prompts with KovaGPT." },
      { name: "twitter:image", content: "https://kovagpt.com/og/images.jpg" },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/images" }],
  }),
});


// Curated example prompts, grouped into 8 visual pages of 6 cards each.
// Thumbnails come from source.unsplash.com (keyword-based public photography)
// so we never ship copyrighted or brand imagery, and only the active page's
// images are ever requested (lazy) — no eager fetch of all 8 pages.
type ExamplePrompt = { prompt: string; keyword: string };
const EXAMPLE_PAGES: ExamplePrompt[][] = [
  [
    { prompt: "Neon city skyline at night, cinematic", keyword: "neon,city,night" },
    { prompt: "Cozy modern bedroom with warm light", keyword: "cozy,bedroom,interior" },
    { prompt: "Mountain lake at sunrise, misty", keyword: "mountain,lake,sunrise" },
    { prompt: "Minimal blue geometric logo", keyword: "blue,geometric,minimal" },
    { prompt: "Luxury product photo, matte black", keyword: "product,black,luxury" },
    { prompt: "Futuristic sci-fi corridor", keyword: "sci-fi,corridor,futuristic" },
  ],
  [
    { prompt: "Watercolor cherry blossom tree", keyword: "cherry,blossom,watercolor" },
    { prompt: "Retro 80s synthwave sunset", keyword: "synthwave,sunset,retro" },
    { prompt: "Isometric pastel city block", keyword: "isometric,pastel,city" },
    { prompt: "Aerial ocean waves, turquoise", keyword: "ocean,aerial,turquoise" },
    { prompt: "Fantasy castle on a cliff", keyword: "castle,fantasy,cliff" },
    { prompt: "Steaming ramen bowl, top-down", keyword: "ramen,food,japanese" },
  ],
  [
    { prompt: "Golden hour portrait, soft bokeh", keyword: "portrait,goldenhour,bokeh" },
    { prompt: "Snowy pine forest at dusk", keyword: "snow,forest,pine" },
    { prompt: "Modern minimalist kitchen", keyword: "kitchen,minimal,modern" },
    { prompt: "Rainy Tokyo street reflections", keyword: "tokyo,rain,street" },
    { prompt: "Astronaut floating over Earth", keyword: "astronaut,earth,space" },
    { prompt: "Botanical illustration of ferns", keyword: "botanical,fern,illustration" },
  ],
  [
    { prompt: "Vintage film camera close-up", keyword: "vintage,camera,film" },
    { prompt: "Autumn forest path, warm tones", keyword: "autumn,forest,path" },
    { prompt: "Desert dunes at twilight", keyword: "desert,dunes,twilight" },
    { prompt: "Cyberpunk alley with neon signs", keyword: "cyberpunk,alley,neon" },
    { prompt: "Cozy coffee shop interior", keyword: "coffee,shop,cafe" },
    { prompt: "Aurora borealis over mountains", keyword: "aurora,northern,lights" },
  ],
  [
    { prompt: "Underwater coral reef, vibrant", keyword: "coral,reef,underwater" },
    { prompt: "Modern glass skyscraper facade", keyword: "skyscraper,glass,modern" },
    { prompt: "Stack of colorful macarons", keyword: "macaron,dessert,pastel" },
    { prompt: "Foggy Scottish highlands", keyword: "scotland,highlands,fog" },
    { prompt: "Vintage red convertible on coast", keyword: "convertible,red,coast" },
    { prompt: "Origami crane, paper texture", keyword: "origami,crane,paper" },
  ],
  [
    { prompt: "Serene zen garden with stones", keyword: "zen,garden,japanese" },
    { prompt: "Tropical waterfall in jungle", keyword: "waterfall,jungle,tropical" },
    { prompt: "Vinyl records on shelves", keyword: "vinyl,records,music" },
    { prompt: "Old library with warm lamps", keyword: "library,books,warm" },
    { prompt: "Field of lavender at sunset", keyword: "lavender,field,sunset" },
    { prompt: "Bright yellow race car, studio", keyword: "car,yellow,studio" },
  ],
  [
    { prompt: "Snowy village at Christmas", keyword: "snow,village,christmas" },
    { prompt: "Minimalist ceramic tea set", keyword: "ceramic,tea,minimal" },
    { prompt: "Hot air balloons at dawn", keyword: "hotairballoon,dawn,sky" },
    { prompt: "Old European cobblestone street", keyword: "cobblestone,europe,street" },
    { prompt: "Neon arcade cabinet, 80s", keyword: "arcade,neon,retro" },
    { prompt: "Golden wheat field, breeze", keyword: "wheat,field,golden" },
  ],
  [
    { prompt: "Colorful hot street food market", keyword: "streetfood,market,asia" },
    { prompt: "Bioluminescent forest at night", keyword: "bioluminescent,forest,glow" },
    { prompt: "Vintage typewriter on wood desk", keyword: "typewriter,vintage,desk" },
    { prompt: "Sunlit tropical beach, palms", keyword: "beach,palm,tropical" },
    { prompt: "Modern art gallery interior", keyword: "gallery,art,modern" },
    { prompt: "Enchanted mushroom forest", keyword: "mushroom,forest,fantasy" },
  ],
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
    /* quota  -  ignore */
  }
}

function ImagesPage() {
  const navigate = useNavigate();
  const { isSignedIn, user } = useUser();
  const userKey = (user as any)?.id ?? null;
  const [settings, setSettings] = useNovaSettings(userKey);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined);
  const openSettings = (tab?: string) => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };
  useEffect(() => {
    const h = (e: Event) => {
      const tab = (e as CustomEvent<{ tab?: string }>).detail?.tab;
      openSettings(tab);
    };
    window.addEventListener("kova-open-settings", h);
    return () => window.removeEventListener("kova-open-settings", h);
  }, []);
  const [helpOpen, setHelpOpen] = useState(false);
  
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<"1024x1024" | "1024x1536" | "1536x1024" | "1792x1024">("1024x1024");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [resultPrompt, setResultPrompt] = useState<string>("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);
  const [limitMessage, setLimitMessage] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [galleryPage, setGalleryPage] = useState(0);



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
    setSaved(false);
    setLoading(true);
    try {
      const res = await authFetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed, size }),
      });

      const data = await res.json();
      if (!res.ok) {
        const msg = data?.error || "Failed to generate image";
        if (res.status === 429 && /limit/i.test(msg)) {
          setLimitMessage(msg);
          setLimitOpen(true);
        }
        throw new Error(msg);
      }
      setResult(data.imageUrl);
      setResultPrompt(trimmed);
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
        onNew={() => navigate({ to: "/" })}
        onDelete={() => {}}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        onOpenSettings={openSettings}
        onOpenHelp={() => setHelpOpen(true)}
        
      />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 flex items-center px-3 border-b border-border">
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="p-2 rounded-lg hover:bg-accent transition mr-1"
              aria-label="Toggle sidebar"
              title="Toggle sidebar"
            >
              <PanelLeft className="w-5 h-5" />
            </button>
          )}
          <button
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-accent transition font-semibold"
            aria-label="KovaGPT model selector"
            title="KovaGPT"
          >
            <span>KovaGPT</span>
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
                  <button className="text-sm font-medium px-3 sm:px-4 py-1.5 rounded-full bg-neutral-300 text-neutral-900 hover:bg-neutral-400 dark:bg-neutral-800 dark:text-white dark:hover:bg-neutral-700 transition whitespace-nowrap">
                    Sign up for free
                  </button>
                </SignUpButton>
              </>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-6 py-8">
            <h1 className="text-3xl font-semibold mb-2">Images</h1>
            <p className="text-sm text-muted-foreground mb-6">
              {isSignedIn ? "Generate Image" : "Sign in to generate images."}
            </p>

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
                  type="submit"
                  disabled={!prompt.trim() || loading}
                  className="w-8 h-8 rounded-full bg-foreground text-background flex items-center justify-center disabled:opacity-30 hover:opacity-90 transition"
                  aria-label="Generate"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
                </button>
              </div>
            </form>

            <div className="mt-4 space-y-4">
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1.5">Size</div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { v: "1024x1024" as const, label: "Square", hint: "1:1" },
                    { v: "1024x1536" as const, label: "Portrait", hint: "2:3" },
                    { v: "1536x1024" as const, label: "Landscape", hint: "3:2" },
                    { v: "1792x1024" as const, label: "Wide", hint: "16:9" },
                  ].map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setSize(opt.v)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition ${
                        size === opt.v
                          ? "border-foreground bg-foreground text-background"
                          : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                      }`}
                    >
                      {opt.label} <span className="opacity-70">· {opt.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">Try one of these</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    "Neon city at night",
                    "Cozy modern bedroom",
                    "Futuristic gaming avatar",
                    "Mountain lake sunrise",
                    "Minimal blue logo",
                    "Luxury product photo",
                  ].map((idea) => (
                    <button
                      key={idea}
                      type="button"
                      onClick={() => setPrompt(idea)}
                      className="text-left text-xs px-3 py-2.5 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition"
                    >
                      {idea}
                    </button>
                  ))}
                </div>
              </div>

              {/* Example gallery: 8 pages of curated example prompts with lazy thumbnails. */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium text-muted-foreground">Examples</div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setGalleryPage((p) => (p - 1 + EXAMPLE_PAGES.length) % EXAMPLE_PAGES.length)}
                      className="text-xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition"
                      aria-label="Previous examples"
                    >
                      ‹
                    </button>
                    <span className="text-[11px] text-muted-foreground tabular-nums px-1">
                      {galleryPage + 1} / {EXAMPLE_PAGES.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setGalleryPage((p) => (p + 1) % EXAMPLE_PAGES.length)}
                      className="text-xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition"
                      aria-label="Next examples"
                    >
                      ›
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {EXAMPLE_PAGES[galleryPage].map((ex) => (
                    <button
                      key={ex.prompt}
                      type="button"
                      onClick={() => setPrompt(ex.prompt)}
                      className="group relative aspect-square rounded-xl overflow-hidden border border-border bg-muted hover:ring-2 hover:ring-foreground/30 transition"
                      title={`Use prompt: ${ex.prompt}`}
                    >
                      <img
                        src={`https://picsum.photos/seed/${encodeURIComponent(ex.keyword)}/400/400`}
                        alt=""
                        loading="lazy"
                        onError={(e) => {
                          const img = e.currentTarget;
                          if (!img.dataset.fallback) {
                            img.dataset.fallback = "1";
                            img.src = `https://picsum.photos/400/400?random=${encodeURIComponent(ex.prompt)}`;
                          }
                        }}
                        className="absolute inset-0 w-full h-full object-cover transition group-hover:scale-105"
                      />
                      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                        <p className="text-[11px] text-white line-clamp-2 text-left">{ex.prompt}</p>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="flex justify-center gap-1.5 mt-3">
                  {EXAMPLE_PAGES.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setGalleryPage(i)}
                      aria-label={`Go to examples page ${i + 1}`}
                      className={`h-1.5 rounded-full transition-all ${
                        i === galleryPage ? "w-6 bg-foreground" : "w-1.5 bg-border hover:bg-muted-foreground/50"
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              AI-generated images may not always match your prompt perfectly. Review generated images before using them publicly or commercially.
            </p>



            {error && (
              <div className="mt-4 text-sm text-destructive">{error}</div>
            )}

            {(loading || result) && (
              <div className="mt-6 rounded-2xl border border-border bg-card overflow-hidden">
                {loading && !result && (
                  <div className="aspect-square w-full max-w-md mx-auto relative overflow-hidden bg-muted">
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-foreground/10 to-transparent animate-[shimmer_1.6s_infinite]" style={{ backgroundSize: "200% 100%" }} />
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                      <Loader2 className="w-6 h-6 animate-spin" />
                      <div className="text-sm">Generating your image…</div>
                    </div>
                  </div>
                )}
                {result && (
                  <div className="p-3">
                    <img
                      src={result}
                      alt={resultPrompt ? `AI-generated image of ${resultPrompt}` : "AI generated image"}
                      className="w-full max-w-md mx-auto rounded-xl"
                    />
                    <div className="flex justify-center mt-3 gap-2 flex-wrap">
                      <a
                        href={result}
                        download="kovagpt-image.png"
                        className="inline-flex items-center gap-2 text-sm px-4 py-1.5 rounded-full border border-border hover:bg-accent transition"
                      >
                        <Download className="w-4 h-4" /> Download
                      </a>
                      <button
                        type="button"
                        disabled={saving || saved}
                        onClick={async () => {
                          if (!result) return;
                          setSaving(true);
                          try {
                            if (isSignedIn) {
                              const { saveImageToLibrary } = await import("@/lib/library-images.functions");
                              await saveImageToLibrary({
                                data: {
                                  imageUrl: result,
                                  title: resultPrompt.slice(0, 120) || "Generated image",
                                  prompt: resultPrompt,
                                },
                              });
                            } else {
                              const { saveGuestItem } = await import("@/lib/guest-library");
                              saveGuestItem({
                                title: resultPrompt.slice(0, 120) || "Generated image",
                                item_type: "image",
                                source: "images",
                                content_text: resultPrompt,
                                file_url: result,
                                file_type: "image/png",
                              });
                            }
                            setSaved(true);
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "Could not save image");
                          } finally {
                            setSaving(false);
                          }
                        }}

                        className="inline-flex items-center gap-2 text-sm px-4 py-1.5 rounded-full border border-border hover:bg-accent transition disabled:opacity-60"
                      >
                        {saved ? "Saved to Library" : saving ? "Saving…" : "Save to Library"}
                      </button>
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

          </div>
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
              if (k.startsWith("novagpt-image-history-") || k.startsWith("nova-gpt-conversations")) {
                localStorage.removeItem(k);
              }
            }
          } catch { /* ignore */ }
          setHistory([]);
        }}
      />
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      
      <LoginPromptDialog open={loginOpen} onOpenChange={setLoginOpen} />
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
