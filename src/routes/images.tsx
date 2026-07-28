import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { authFetch } from "@/lib/auth-fetch";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { saveToLibrary } from "@/lib/library.functions";
import {
  PanelLeft,
  ArrowUp,
  Loader2,
  Download,
  Trash2,
  Paperclip,
  Sparkles,
  X as XIcon,
  Bookmark,
  RefreshCw,
} from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { SettingsDialog } from "@/components/SettingsDialog";

import { LoginPromptDialog } from "@/components/LoginPromptDialog";
import { LimitReachedDialog } from "@/components/LimitReachedDialog";
import { getUsage } from "@/lib/limits";
import { useNovaSettings } from "@/lib/use-nova-settings";
import { SignInButton, SignUpButton, UserButton, useUser } from "@/components/auth/ClerkSafe";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/images")({
  component: ImagesPage,
  head: () => ({
    meta: [
      { title: "AI Image Generation | KovaGPT" },
      {
        name: "description",
        content:
          "Create AI-generated images from text prompts with KovaGPT. Pick a style, describe what you want, and save the results.",
      },
      { property: "og:title", content: "AI Image Generation | KovaGPT" },
      {
        property: "og:description",
        content: "Create AI-generated images from text prompts with KovaGPT.",
      },
      { property: "og:url", content: "https://kovagpt.com/images" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "AI Image Generation | KovaGPT" },
      {
        name: "twitter:description",
        content: "Create AI-generated images from text prompts with KovaGPT.",
      },
    ],
    links: [{ rel: "canonical", href: "https://kovagpt.com/images" }],
  }),
});

import portraitModeImg from "@/assets/image-presets/portrait-mode.jpg";
import stickerPackImg from "@/assets/image-presets/sticker-pack.jpg";
import bobbleheadImg from "@/assets/image-presets/bobblehead.jpg";
import actionShotImg from "@/assets/image-presets/action-shot.jpg";
import handwrittenImg from "@/assets/image-presets/handwritten.jpg";
import interiorDesignImg from "@/assets/image-presets/interior-design.jpg";
import actionFigureImg from "@/assets/image-presets/action-figure.jpg";
import discoModeImg from "@/assets/image-presets/disco-mode.jpg";
import appIconImg from "@/assets/image-presets/app-icon.jpg";
import logoMarkImg from "@/assets/image-presets/logo-mark.jpg";
import watercolorImg from "@/assets/image-presets/watercolor.jpg";
import oilPaintingImg from "@/assets/image-presets/oil-painting.jpg";
import pixelArtImg from "@/assets/image-presets/pixel-art.jpg";
import animeImg from "@/assets/image-presets/anime.jpg";
import threeDRenderImg from "@/assets/image-presets/3d-render.jpg";
import cyberpunkImg from "@/assets/image-presets/cyberpunk.jpg";
import vintagePosterImg from "@/assets/image-presets/vintage-poster.jpg";
import lineDrawingImg from "@/assets/image-presets/line-drawing.jpg";
import origamiImg from "@/assets/image-presets/origami.jpg";
import comicBookImg from "@/assets/image-presets/comic-book.jpg";
import isometricImg from "@/assets/image-presets/isometric.jpg";
import lowPolyImg from "@/assets/image-presets/low-poly.jpg";
import ghibliImg from "@/assets/image-presets/ghibli.jpg";
import popArtImg from "@/assets/image-presets/pop-art.jpg";
import blueprintImg from "@/assets/image-presets/blueprint.jpg";

type Preset = { label: string; prompt: string; seed: string; image: string };

const PRESETS: Preset[] = [
  {
    label: "Portrait mode",
    prompt: "A cinematic close-up portrait, soft natural light, shallow depth of field",
    seed: "portrait-mode",
    image: portraitModeImg,
  },
  {
    label: "Sticker pack",
    prompt: "A cute die-cut sticker illustration of my subject, thick white border, flat colors",
    seed: "sticker-pack",
    image: stickerPackImg,
  },
  {
    label: "Bobblehead",
    prompt:
      "A miniature bobblehead figurine on a stadium field, oversized head, detailed uniform, studio lighting",
    seed: "bobblehead",
    image: bobbleheadImg,
  },
  {
    label: "Action shot",
    prompt: "A dynamic action shot mid-motion, dramatic lighting, sports photography, sharp focus",
    seed: "action-shot",
    image: actionShotImg,
  },
  {
    label: "Handwritten",
    prompt:
      "A candid family moment illustrated in a warm handwritten storybook style, pastel palette",
    seed: "handwritten",
    image: handwrittenImg,
  },
  {
    label: "Interior design",
    prompt:
      "A modern interior of my described room, warm wood, natural light, magazine photography",
    seed: "interior-design",
    image: interiorDesignImg,
  },
  {
    label: "Action figure",
    prompt:
      "A collectible action figure of my subject in a blister-pack toy box with accessories, product photo",
    seed: "action-figure",
    image: actionFigureImg,
  },
  {
    label: "Disco mode",
    prompt:
      "A shiny mirrorball sculpture of my subject on a reflective black stage, studio lights, sparkle",
    seed: "disco-mode",
    image: discoModeImg,
  },
  {
    label: "App icon",
    prompt:
      "A polished app icon for my described product, gradient background, rounded corners, minimal",
    seed: "app-icon",
    image: appIconImg,
  },
  {
    label: "Logo mark",
    prompt: "A minimal vector logo mark for my described brand, symmetrical, black on white",
    seed: "logo-mark",
    image: logoMarkImg,
  },
  {
    label: "Watercolor",
    prompt:
      "A soft watercolor painting of my subject, pastel washes, paper texture, artistic brush strokes",
    seed: "watercolor",
    image: watercolorImg,
  },
  {
    label: "Oil painting",
    prompt:
      "A classical oil painting portrait of my subject, rich textured brush strokes, chiaroscuro lighting",
    seed: "oil-painting",
    image: oilPaintingImg,
  },
  {
    label: "Pixel art",
    prompt: "A retro 16-bit pixel art scene of my subject, crisp pixels, limited palette",
    seed: "pixel-art",
    image: pixelArtImg,
  },
  {
    label: "Anime",
    prompt: "An anime illustration of my subject, cel shaded, vivid colors, expressive eyes",
    seed: "anime",
    image: animeImg,
  },
  {
    label: "3D render",
    prompt:
      "A glossy 3D render of my subject in Pixar style, soft studio lighting, subsurface scattering",
    seed: "3d-render",
    image: threeDRenderImg,
  },
  {
    label: "Cyberpunk",
    prompt:
      "My subject in a neon cyberpunk city street at night, rain reflections, purple and cyan lights, cinematic",
    seed: "cyberpunk",
    image: cyberpunkImg,
  },
  {
    label: "Vintage poster",
    prompt: "A vintage travel poster of my subject, bold flat colors, mid-century deco composition",
    seed: "vintage-poster",
    image: vintagePosterImg,
  },
  {
    label: "Line drawing",
    prompt: "A minimal continuous line drawing of my subject on cream paper, elegant black ink",
    seed: "line-drawing",
    image: lineDrawingImg,
  },
  {
    label: "Origami",
    prompt:
      "An origami paper sculpture of my subject, folded pastel paper, soft studio lighting, minimal background",
    seed: "origami",
    image: origamiImg,
  },
  {
    label: "Comic book",
    prompt:
      "A comic book panel of my subject, bold ink outlines, halftone dots, dynamic action, saturated colors",
    seed: "comic-book",
    image: comicBookImg,
  },
  {
    label: "Isometric",
    prompt:
      "An isometric illustration of my subject in a tiny cutaway scene, soft colors, detailed miniature",
    seed: "isometric",
    image: isometricImg,
  },
  {
    label: "Low poly",
    prompt:
      "A low poly geometric render of my subject, flat shaded triangles, minimal gradient background",
    seed: "low-poly",
    image: lowPolyImg,
  },
  {
    label: "Ghibli",
    prompt:
      "A Studio Ghibli inspired scene of my subject, hand painted, lush environment, nostalgic warm light",
    seed: "ghibli",
    image: ghibliImg,
  },
  {
    label: "Pop art",
    prompt:
      "A pop art Warhol style portrait of my subject, bold flat blocks of complementary colors, screen print texture",
    seed: "pop-art",
    image: popArtImg,
  },
  {
    label: "Blueprint",
    prompt:
      "A technical blueprint drawing of my subject, cyan lines on dark blue paper, dimensional annotations",
    seed: "blueprint",
    image: blueprintImg,
  },
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
  } catch {
    return [];
  }
}
function saveHistory(userKey: string | null, items: HistoryItem[]) {
  if (!userKey || typeof window === "undefined") return;
  try {
    localStorage.setItem(
      HISTORY_KEY_PREFIX + userKey,
      JSON.stringify(items.slice(0, HISTORY_LIMIT)),
    );
  } catch {
    /*ignore*/
  }
}

function ImagesPage() {
  const navigate = useNavigate();
  const { isSignedIn, user } = useUser();
  const userKey = (user as { id?: string } | null)?.id ?? null;
  const [settings, setSettings] = useNovaSettings(userKey);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined);
  const openSettings = (tab?: string) => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };
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
  const [lightbox, setLightbox] = useState<HistoryItem | null>(null);
  const [savingImage, setSavingImage] = useState(false);
  const saveImage = useServerFn(saveToLibrary);
  const submittingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  useEffect(() => {
    if (isSignedIn && userKey) setHistory(loadHistory(userKey));
    else setHistory([]);
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

  async function saveGeneratedImage(item: { prompt: string; imageUrl: string }) {
    if (!isSignedIn) {
      setLoginOpen(true);
      return;
    }
    setSavingImage(true);
    try {
      await saveImage({
        data: {
          title: item.prompt.slice(0, 100) || "Generated image",
          item_type: "image",
          source: "images",
          content_text: item.prompt,
          file_url: item.imageUrl,
        },
      });
      toast.success("Saved to Library");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save image");
    } finally {
      setSavingImage(false);
    }
  }

  async function generate(p: string) {
    const trimmed = p.trim();
    if (!trimmed || submittingRef.current) return;
    if (!isSignedIn) {
      setLoginOpen(true);
      return;
    }
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
        if (res.status === 429 && /limit/i.test(msg)) {
          setLimitMessage(msg);
          setLimitOpen(true);
        }
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

  const applyPreset = (p: Preset) => {
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
        onOpenHelp={openHelp}
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
                  <button className="text-sm font-medium px-4 py-1.5 rounded-full bg-foreground text-background hover:opacity-90 transition">
                    Log in
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="text-sm font-medium px-3 sm:px-4 py-1.5 rounded-full bg-neutral-200 text-neutral-900 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-white dark:hover:bg-neutral-700 transition whitespace-nowrap">
                    Sign up for free
                  </button>
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
                      onClick={() => applyPreset(p)}
                      className="group flex flex-col items-start w-[128px] shrink-0 focus:outline-none"
                    >
                      <div className="relative w-[128px] h-[176px] rounded-2xl overflow-hidden ring-1 ring-border/60 bg-muted transition-transform duration-200 group-hover:scale-[1.03] group-hover:ring-foreground/30">
                        <img
                          src={p.image}
                          alt={p.label}
                          loading="lazy"
                          width={512}
                          height={704}
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      </div>
                      <span className="mt-2 text-sm text-foreground/90 group-hover:text-foreground text-center w-full">
                        {p.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* Current result */}
            {(loading || result || error) && (
              <section className="mt-8">
                {loading && !result && (
                  <div className="max-w-md mx-auto aspect-square rounded-3xl overflow-hidden relative ring-1 ring-border bg-gradient-to-br from-fuchsia-500/20 via-violet-500/20 to-cyan-500/20">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,hsl(280_90%_60%/0.35),transparent_55%),radial-gradient(circle_at_70%_80%,hsl(190_90%_55%/0.35),transparent_55%),radial-gradient(circle_at_50%_50%,hsl(320_90%_60%/0.25),transparent_60%)] animate-[imgAura_6s_ease-in-out_infinite]" />
                    <div
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent animate-[shimmer_1.8s_infinite]"
                      style={{ backgroundSize: "200% 100%" }}
                    />
                    <div className="absolute inset-0 backdrop-blur-2xl" />
                    <div className="pointer-events-none absolute inset-0">
                      {Array.from({ length: 14 }).map((_, i) => (
                        <span
                          key={i}
                          className="absolute rounded-full bg-white/70 shadow-[0_0_12px_rgba(255,255,255,0.9)] animate-[floatUp_5s_linear_infinite]"
                          style={{
                            left: `${(i * 37) % 100}%`,
                            bottom: `-${(i * 13) % 40}px`,
                            width: `${4 + (i % 4) * 2}px`,
                            height: `${4 + (i % 4) * 2}px`,
                            animationDelay: `${(i * 0.3).toFixed(2)}s`,
                            opacity: 0.6,
                          }}
                        />
                      ))}
                    </div>
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white drop-shadow-lg">
                      <div className="relative w-14 h-14">
                        <div className="absolute inset-0 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                        <Sparkles className="absolute inset-0 m-auto w-6 h-6 text-white animate-pulse" />
                      </div>
                      <div className="text-sm font-medium tracking-wide">
                        Painting your image...
                      </div>
                      <div className="text-[11px] uppercase tracking-[0.2em] opacity-70">
                        Mixing colors · Adding light · Sharpening details
                      </div>
                    </div>
                  </div>
                )}
                {result && (
                  <div className="max-w-md mx-auto">
                    <img
                      src={result}
                      alt={resultPrompt || "Generated image"}
                      decoding="async"
                      className="w-full rounded-3xl ring-1 ring-border"
                    />
                    <div className="flex justify-center mt-3 gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() =>
                          saveGeneratedImage({ prompt: resultPrompt, imageUrl: result })
                        }
                        disabled={savingImage}
                        className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-full border border-border hover:bg-accent transition disabled:opacity-50"
                      >
                        <Bookmark className="h-4 w-4" />{" "}
                        {savingImage ? "Saving…" : "Save to Library"}
                      </button>
                      <button
                        type="button"
                        onClick={() => generate(resultPrompt)}
                        disabled={loading}
                        className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-full border border-border hover:bg-accent transition disabled:opacity-50"
                      >
                        <RefreshCw className="h-4 w-4" /> Create variation
                      </button>
                      <a
                        href={result}
                        download="kovagpt-image.png"
                        className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-full border border-border hover:bg-accent transition"
                      >
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
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => setLightbox(h)}
                      className="group relative aspect-square rounded-2xl overflow-hidden bg-muted ring-1 ring-border focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/60 text-left"
                      aria-label={`Open image: ${h.prompt}`}
                    >
                      <img
                        src={h.imageUrl}
                        alt={h.prompt}
                        loading="lazy"
                        decoding="async"
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition bg-gradient-to-t from-black/85 via-black/25 to-transparent flex flex-col justify-end p-2 gap-1.5">
                        <p className="text-[11px] text-white line-clamp-2" title={h.prompt}>
                          {h.prompt}
                        </p>
                        <div
                          className="flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPrompt(h.prompt);
                              inputRef.current?.focus();
                            }}
                            className="flex-1 text-[11px] px-2 py-1 rounded-full bg-white text-black font-medium hover:opacity-90"
                          >
                            Reuse
                          </button>
                          <a
                            onClick={(e) => e.stopPropagation()}
                            href={h.imageUrl}
                            download={`kovagpt-${h.id}.png`}
                            className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white"
                            aria-label="Download"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeFromHistory(h.id);
                            }}
                            className="w-7 h-7 rounded-full bg-white/15 hover:bg-destructive flex items-center justify-center text-white"
                            aria-label="Remove"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>

        {/* Bottom composer */}
        <div className="sticky bottom-0 border-t border-border/60 bg-gradient-to-t from-background via-background to-background/80 backdrop-blur">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              generate(prompt);
            }}
            className="max-w-3xl mx-auto px-4 sm:px-6 py-3"
          >
            <div className="flex items-end gap-2 rounded-3xl border border-border bg-card shadow-sm px-3 py-2.5">
              <button
                type="button"
                aria-label="Attach"
                className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition shrink-0"
              >
                <Paperclip className="w-5 h-5" />
              </button>
              <textarea
                ref={inputRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    generate(prompt);
                  }
                }}
                rows={1}
                placeholder="Describe an image"
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                className="flex-1 bg-transparent outline-none border-0 focus:ring-0 focus:outline-none text-[15px] placeholder:text-muted-foreground resize-none py-1.5 max-h-40"
              />
              <button
                type="submit"
                disabled={!prompt.trim() || loading}
                className="w-9 h-9 rounded-full bg-foreground text-background flex items-center justify-center disabled:opacity-30 hover:opacity-90 transition shrink-0"
                aria-label="Generate"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowUp className="w-4 h-4" />
                )}
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
              if (k.startsWith("novagpt-image-history-") || k.startsWith("nova-gpt-conversations"))
                localStorage.removeItem(k);
            }
          } catch {
            /* ignore */
          }
          setHistory([]);
        }}
      />

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

      {lightbox && (
        <div
          className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 sm:p-8 animate-in fade-in duration-150"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
        >
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition"
            aria-label="Close"
          >
            <XIcon className="w-5 h-5" />
          </button>
          <div
            className="relative max-w-4xl w-full flex flex-col items-center gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={lightbox.imageUrl}
              alt={lightbox.prompt}
              decoding="async"
              className="max-h-[75dvh] w-auto max-w-full rounded-2xl shadow-2xl object-contain"
            />
            <p className="text-sm text-white/85 text-center max-w-2xl px-4 line-clamp-3">
              {lightbox.prompt}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={() => {
                  setPrompt(lightbox.prompt);
                  setLightbox(null);
                  inputRef.current?.focus();
                }}
                className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-full bg-white text-black font-medium hover:opacity-90 transition"
              >
                <Sparkles className="w-4 h-4" /> Reuse prompt
              </button>
              <button
                onClick={() => {
                  const item = lightbox;
                  setLightbox(null);
                  void generate(item.prompt);
                }}
                className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
              >
                <RefreshCw className="h-4 w-4" /> Create variation
              </button>
              <button
                onClick={() => saveGeneratedImage(lightbox)}
                disabled={savingImage}
                className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition disabled:opacity-50"
              >
                <Bookmark className="h-4 w-4" /> Save
              </button>
              <a
                href={lightbox.imageUrl}
                download={`kovagpt-${lightbox.id}.png`}
                className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
              >
                <Download className="w-4 h-4" /> Download
              </a>
              <button
                onClick={() => {
                  removeFromHistory(lightbox.id);
                  setLightbox(null);
                }}
                className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-full bg-white/10 hover:bg-destructive text-white transition"
              >
                <Trash2 className="w-4 h-4" /> Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
