import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { authFetch } from "@/lib/auth-fetch";
import { useEffect, useState } from "react";
import { PanelLeft, ChevronDown, ChevronLeft, ChevronRight, ImageIcon, ArrowUp, Loader2, Download, Trash2, History } from "lucide-react";
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
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/images" }],
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
  {
    label: "Abstract gradient",
    prompt: "Abstract liquid gradient art, vibrant magenta and teal, smooth flowing shapes",
    src: "https://images.unsplash.com/photo-1557672172-298e090bd0f1?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Forest path",
    prompt: "Sunlit misty forest path in autumn, golden leaves, cinematic depth",
    src: "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Ocean wave",
    prompt: "Macro photo of a cresting turquoise ocean wave at golden hour",
    src: "https://images.unsplash.com/photo-1505144808419-1957a94ca61e?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Mountain lake",
    prompt: "Crystal clear alpine lake reflecting snow-capped mountains, ultra realistic",
    src: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Desert dunes",
    prompt: "Endless rolling Sahara desert dunes at sunset, long shadows, photo realistic",
    src: "https://images.unsplash.com/photo-1473580044384-7ba9967e16a0?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Astronaut",
    prompt: "Lone astronaut floating above Earth, dramatic lighting, NASA style photography",
    src: "https://images.unsplash.com/photo-1457364887197-9150188c107b?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Northern lights",
    prompt: "Aurora borealis dancing above a snowy lakeside cabin, long exposure",
    src: "https://images.unsplash.com/photo-1483728642387-6c3bdd6c93e5?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Coffee art",
    prompt: "Top-down latte art with steam, on a rustic wood table, warm light",
    src: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Vintage car",
    prompt: "Glossy red 1960s convertible parked on Pacific coast highway at golden hour",
    src: "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "City skyline",
    prompt: "Modern Manhattan skyline at dusk, glowing windows, ultra-detailed",
    src: "https://images.unsplash.com/photo-1496588152823-86ff7695e68f?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Galaxy nebula",
    prompt: "Vibrant deep-space nebula with swirling cosmic dust, hubble telescope style",
    src: "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Macro flower",
    prompt: "Extreme close-up of a dewy red rose petal, photo realistic, soft focus",
    src: "https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Snowy village",
    prompt: "Cozy Christmas village under heavy snowfall at night, warm window lights",
    src: "https://images.unsplash.com/photo-1482517967863-00e15c9b44be?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Tropical beach",
    prompt: "Aerial drone shot of a tropical island with turquoise water and palm trees",
    src: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Steampunk gear",
    prompt: "Intricate brass steampunk pocket watch with exposed gears, studio lighting",
    src: "https://images.unsplash.com/photo-1509048191080-d2984bad6ae5?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Misty bridge",
    prompt: "Stone arch bridge over a foggy river at dawn, moody atmosphere",
    src: "https://images.unsplash.com/photo-1500964757637-c85e8a162699?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Studio portrait",
    prompt: "Black and white studio portrait of an elderly man, soft Rembrandt lighting",
    src: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Hot air balloons",
    prompt: "Dozens of colorful hot air balloons over Cappadocia at sunrise",
    src: "https://images.unsplash.com/photo-1507608616759-54f48f0af0ee?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Underwater coral",
    prompt: "Vivid coral reef with tropical fish, sunbeams piercing the surface",
    src: "https://images.unsplash.com/photo-1497436072909-60f360e1d4b1?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Neon arcade",
    prompt: "1980s arcade hallway with neon signs and CRT glow, synthwave aesthetic",
    src: "https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Geometric art",
    prompt: "Minimal geometric pastel composition, soft shadows, design poster style",
    src: "https://images.unsplash.com/photo-1558865869-c93f6f8482af?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Library aisle",
    prompt: "Endless old library with tall bookshelves, warm reading lamps, cinematic",
    src: "https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Foggy forest",
    prompt: "Dark misty pine forest at dawn, volumetric fog, atmospheric photography",
    src: "https://images.unsplash.com/photo-1418065460487-3e41a6c84dc5?auto=format&fit=crop&w=600&q=70",
  },
  {
    label: "Northern fjord",
    prompt: "Aerial of Norwegian fjord with tiny village by the water, dramatic cliffs",
    src: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=600&q=70",
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
  const [size, setSize] = useState<"1024x1024" | "1024x1536" | "1536x1024">("1024x1024");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [resultPrompt, setResultPrompt] = useState<string>("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);
  const [limitMessage, setLimitMessage] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);



  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [examplePage, setExamplePage] = useState(0);
  const EXAMPLES_PER_PAGE = 10;
  const exampleTotalPages = Math.max(1, Math.ceil(EXAMPLES.length / EXAMPLES_PER_PAGE));
  const visibleExamples = EXAMPLES.slice(
    examplePage * EXAMPLES_PER_PAGE,
    examplePage * EXAMPLES_PER_PAGE + EXAMPLES_PER_PAGE,
  );

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
        body: JSON.stringify({ prompt: trimmed }),
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

            <div className="mt-4 flex flex-wrap gap-2">
              {[
                "Realistic Images",
                "Anime & Illustration",
                "Logos & Icons",
                "Gaming Avatars",
                "Product Renders",
                "Wallpapers",
                "Social Media Posts",
                "Website Graphics",
                "Fantasy Art",
                "Interior Design",
                "Cyberpunk",
                "Nature & Landscapes",
              ].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setPrompt((p) => (p ? `${p}, ${cat.toLowerCase()}` : cat))}
                  className="text-xs px-3 py-1.5 rounded-full border border-border hover:bg-accent transition text-muted-foreground hover:text-foreground"
                >
                  {cat}
                </button>
              ))}
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
                  <div className="aspect-square w-full max-w-md mx-auto flex flex-col items-center justify-center gap-3 text-muted-foreground">
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <div className="text-sm">Generating your image…</div>
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

            <div className="mt-10">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">
                  Explore AI image examples
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    Page {examplePage + 1} of {exampleTotalPages}
                  </span>
                </h2>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setExamplePage((p) => Math.max(0, p - 1))}
                    disabled={examplePage === 0}
                    className="w-8 h-8 rounded-full border border-border hover:bg-accent flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label="Previous examples page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setExamplePage((p) => Math.min(exampleTotalPages - 1, p + 1))}
                    disabled={examplePage >= exampleTotalPages - 1}
                    className="w-8 h-8 rounded-full border border-border hover:bg-accent flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label="Next examples page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Click any example to use it as your prompt.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {visibleExamples.map((ex) => (
                  <button
                    key={ex.label}
                    onClick={() => {
                      setPrompt(ex.prompt);
                      generate(ex.prompt);
                    }}
                    className="group relative aspect-[3/4] rounded-2xl overflow-hidden bg-muted hover:scale-[1.02] transition-transform text-left"
                    aria-label={`Use example: ${ex.label}`}
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
