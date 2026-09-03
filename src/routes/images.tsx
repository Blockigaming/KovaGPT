import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { authFetch } from "@/lib/auth-fetch";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { saveImageToLibrary } from "@/lib/library-images.functions";
import { safeImageUrl } from "@/lib/safe-image-url";
import {
  PanelLeft,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Download,
  Trash2,
  Sparkles,
  Bookmark,
  RefreshCw,
  Copy,
} from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

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
      { title: "KovaGPT Images" },
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
const HISTORY_KEY_PREFIX = "kovagpt:v2:image-history:";
const LEGACY_HISTORY_KEY_PREFIX = "novagpt-image-history-";
const HISTORY_LIMIT = 60;

function loadHistory(userKey: string | null): HistoryItem[] {
  if (!userKey || typeof window === "undefined") return [];
  try {
    let raw = localStorage.getItem(HISTORY_KEY_PREFIX + userKey);
    if (!raw) {
      const legacyKey = LEGACY_HISTORY_KEY_PREFIX + userKey;
      raw = localStorage.getItem(legacyKey);
      if (raw) {
        localStorage.setItem(HISTORY_KEY_PREFIX + userKey, raw);
        localStorage.removeItem(legacyKey);
      }
    }
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
  const { isLoaded, isSignedIn, user } = useUser();
  const userKey = (user as { id?: string } | null)?.id ?? null;
  const [settings, setSettings] = useNovaSettings(userKey, isLoaded);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined);
  const settingsReturnFocusRef = useRef<HTMLElement | null>(null);
  const openSettings = (tab?: string) => {
    settingsReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
  const saveImage = useServerFn(saveImageToLibrary);
  const submittingRef = useRef(false);
  const generationRef = useRef(0);
  const generationControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const presetsRef = useRef<HTMLDivElement>(null);
  const scrollPresets = (direction: 1 | -1) => {
    const el = presetsRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(320, el.clientWidth * 0.8), behavior: "smooth" });
  };
  const lightboxInitialFocusRef = useRef<HTMLButtonElement>(null);
  const lightboxReturnFocusRef = useRef<HTMLElement | null>(null);
  const lightboxReturnToPromptRef = useRef(false);

  useEffect(() => {
    generationRef.current += 1;
    generationControllerRef.current?.abort();
    generationControllerRef.current = null;
    submittingRef.current = false;
    setLoading(false);
    setPrompt("");
    setError(null);
    setResult(null);
    setResultPrompt("");
    setLightbox(null);
    setSavingImage(false);
    setLoginOpen(false);
    setLimitOpen(false);
    setLimitMessage(undefined);
    setHistory(isLoaded && isSignedIn && userKey ? loadHistory(userKey) : []);
    return () => generationControllerRef.current?.abort();
  }, [isLoaded, isSignedIn, userKey]);

  function addToHistory(p: string, imageUrl: string) {
    if (!isSignedIn || !userKey) return;
    const item: HistoryItem = {
      id: crypto.randomUUID(),
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
          prompt: item.prompt,
          imageUrl: item.imageUrl,
        },
      });
      toast.success("Saved to Library");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save image");
    } finally {
      setSavingImage(false);
    }
  }

  async function copyGeneratedImage(imageUrl: string) {
    try {
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
        throw new Error("Image copying is not supported by this browser");
      }
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error("Could not read the generated image");
      const source = await response.blob();
      const blob =
        source.type === "image/png"
          ? source
          : await new Promise<Blob>((resolve, reject) => {
              const image = new Image();
              const objectUrl = URL.createObjectURL(source);
              image.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                canvas.getContext("2d")?.drawImage(image, 0, 0);
                URL.revokeObjectURL(objectUrl);
                canvas.toBlob(
                  (converted) =>
                    converted ? resolve(converted) : reject(new Error("Could not convert image")),
                  "image/png",
                );
              };
              image.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error("Could not decode image"));
              };
              image.src = objectUrl;
            });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast.success("Image copied");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not copy image");
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
    const generation = ++generationRef.current;
    const controller = new AbortController();
    generationControllerRef.current?.abort();
    generationControllerRef.current = controller;
    setError(null);
    setLoading(true);
    try {
      const res = await authFetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
        signal: controller.signal,
      });
      const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("application/json")) {
        throw new Error("Image service returned an invalid response");
      }
      const data = (await res.json()) as { error?: unknown; imageUrl?: unknown };
      if (generation !== generationRef.current || controller.signal.aborted) return;
      if (!res.ok) {
        const msg = typeof data.error === "string" ? data.error : "Failed to generate image";
        if (res.status === 429 && /limit/i.test(msg)) {
          setLimitMessage(msg);
          setLimitOpen(true);
        }
        throw new Error(msg);
      }
      const imageUrl = safeImageUrl(data.imageUrl);
      if (!imageUrl) {
        throw new Error("Image service returned an invalid image");
      }
      setResult(imageUrl);
      setResultPrompt(trimmed);
      addToHistory(trimmed, imageUrl);
      setPrompt("");
    } catch (e) {
      if (controller.signal.aborted || generation !== generationRef.current) return;
      setError(e instanceof Error ? e.message : "Failed to generate image");
    } finally {
      if (generation === generationRef.current) {
        setLoading(false);
        submittingRef.current = false;
        generationControllerRef.current = null;
      }
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

      <main
        id="main-content"
        tabIndex={-1}
        aria-labelledby="images-title"
        className="flex min-w-0 flex-1 flex-col"
      >
        <header className="h-14 flex items-center px-3 shrink-0">
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="mr-1 flex h-11 w-11 items-center justify-center rounded-lg transition hover:bg-accent"
              aria-label="Toggle sidebar"
            >
              <PanelLeft className="w-5 h-5" />
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {!isLoaded ? (
              <div
                aria-hidden="true"
                className="h-11 w-36 animate-pulse rounded-full bg-muted motion-reduce:animate-none"
              />
            ) : isSignedIn ? (
              <UserButton />
            ) : (
              <>
                <SignInButton mode="modal">
                  <button className="min-h-11 rounded-full bg-foreground px-4 text-sm font-semibold text-background transition hover:opacity-90">
                    Log in
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="min-h-11 whitespace-nowrap rounded-full bg-muted px-3 text-sm font-medium text-foreground transition hover:bg-accent sm:px-4">
                    Sign up for free
                  </button>
                </SignUpButton>
              </>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-2 pb-24">
            <h1
              id="images-title"
              className="text-[34px] font-semibold tracking-tight sm:text-[40px]"
            >
              Images
            </h1>

            {/* Prompt */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                generate(prompt);
              }}
              className="mt-5"
            >
              <div className="kova-composer flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2">
                <input
                  ref={inputRef}
                  value={prompt}
                  aria-label="Describe the image to generate"
                  maxLength={2000}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing && event.key === "Enter") {
                      event.preventDefault();
                    }
                  }}
                  placeholder="Describe a new image"
                  spellCheck={false}
                  autoComplete="off"
                  className="min-w-0 flex-1 border-0 bg-transparent text-[16px] outline-none placeholder:text-muted-foreground focus:outline-none focus:ring-0"
                />
                <button
                  type="submit"
                  disabled={!prompt.trim() || loading}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition hover:opacity-90 disabled:opacity-30"
                  aria-label="Generate"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                  ) : (
                    <ArrowUp className="h-4 w-4" />
                  )}
                </button>
              </div>
            </form>

            {/* Create an image */}
            <section className="mt-10">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-[22px] font-semibold tracking-tight">Create an image</h2>
                <div className="hidden items-center gap-2 sm:flex">
                  <button
                    type="button"
                    onClick={() => scrollPresets(-1)}
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:bg-accent hover:text-foreground"
                    aria-label="Scroll styles left"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollPresets(1)}
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:bg-accent hover:text-foreground"
                    aria-label="Scroll styles right"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div
                ref={presetsRef}
                className="-mx-4 sm:-mx-6 px-4 sm:px-6 overflow-x-auto scroll-smooth scrollbar-none"
              >
                <div className="flex gap-3 pb-2 min-w-max">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => applyPreset(p)}
                      aria-label={`Use ${p.label} style`}
                      className="group flex flex-col items-start w-[160px] shrink-0 focus:outline-none"
                    >
                      <div className="relative w-[160px] h-[160px] rounded-2xl overflow-hidden ring-1 ring-border/60 bg-muted">
                        <img
                          src={p.image}
                          alt=""
                          loading="lazy"
                          width={512}
                          height={512}
                          className="absolute inset-0 w-full h-full object-cover transition duration-200 group-hover:scale-[1.02]"
                        />
                        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-3 pb-2 pt-8 text-left text-sm font-medium text-white">
                          {p.label}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* Current result */}
            {(loading || result || error) && (
              <section className="mt-8">
                {loading && !result && (
                  <div
                    role="status"
                    aria-labelledby="image-generating-label"
                    className="relative mx-auto aspect-square max-w-md overflow-hidden rounded-2xl bg-gradient-to-br from-fuchsia-500/20 via-violet-500/20 to-cyan-500/20 ring-1 ring-border"
                  >
                    <span id="image-generating-label" className="sr-only">
                      Generating image
                    </span>
                    <div className="absolute inset-0 animate-[imgAura_6s_ease-in-out_infinite] bg-[radial-gradient(circle_at_30%_20%,hsl(280_90%_60%/0.35),transparent_55%),radial-gradient(circle_at_70%_80%,hsl(190_90%_55%/0.35),transparent_55%),radial-gradient(circle_at_50%_50%,hsl(320_90%_60%/0.25),transparent_60%)] motion-reduce:animate-none" />
                    <div
                      className="absolute inset-0 animate-[shimmer_1.8s_infinite] bg-gradient-to-r from-transparent via-white/25 to-transparent motion-reduce:animate-none"
                      style={{ backgroundSize: "200% 100%" }}
                    />
                    <div className="absolute inset-0 backdrop-blur-2xl" />
                    <div className="pointer-events-none absolute inset-0">
                      {Array.from({ length: 14 }).map((_, i) => (
                        <span
                          key={i}
                          className="absolute animate-[floatUp_5s_linear_infinite] rounded-full bg-white/70 shadow-[0_0_12px_rgba(255,255,255,0.9)] motion-reduce:animate-none"
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
                        <div className="absolute inset-0 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none" />
                        <Sparkles
                          className="absolute inset-0 m-auto h-6 w-6 animate-pulse text-white motion-reduce:animate-none"
                          aria-hidden="true"
                        />
                      </div>
                      <div className="text-sm font-medium tracking-wide">Generating image…</div>
                    </div>
                  </div>
                )}
                {result && (
                  <div className="max-w-md mx-auto">
                    <img
                      src={result}
                      alt={resultPrompt || "Generated image"}
                      decoding="async"
                      className="w-full rounded-2xl ring-1 ring-border"
                    />
                    <div className="flex justify-center mt-3 gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() =>
                          saveGeneratedImage({ prompt: resultPrompt, imageUrl: result })
                        }
                        disabled={savingImage}
                        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm transition hover:bg-accent disabled:opacity-50"
                      >
                        <Bookmark className="h-4 w-4" />{" "}
                        {savingImage ? "Saving…" : "Save to Library"}
                      </button>
                      <button
                        type="button"
                        onClick={() => generate(resultPrompt)}
                        disabled={loading}
                        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm transition hover:bg-accent disabled:opacity-50"
                      >
                        <RefreshCw className="h-4 w-4" /> Generate again
                      </button>
                      <button
                        type="button"
                        onClick={() => copyGeneratedImage(result)}
                        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm transition hover:bg-accent"
                      >
                        <Copy className="h-4 w-4" /> Copy image
                      </button>
                      <a
                        href={result}
                        download="kovagpt-image.png"
                        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm transition hover:bg-accent"
                      >
                        <Download className="w-4 h-4" /> Download
                      </a>
                    </div>
                  </div>
                )}
                {error && (
                  <div role="alert" className="mt-3 text-center text-sm text-destructive">
                    The image could not be generated. Please try again.
                  </div>
                )}
              </section>
            )}

            {/* My images */}
            <section className="mt-10" aria-labelledby="image-history-title">
              <h2
                id="image-history-title"
                className="mb-3 text-[22px] font-semibold tracking-tight"
              >
                Image history
              </h2>
              {!isLoaded ? (
                <div
                  role="status"
                  className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground"
                >
                  Loading image history…
                </div>
              ) : !isSignedIn ? (
                <div className="rounded-2xl border border-dashed border-border p-8 text-center sm:p-10">
                  <Sparkles className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
                  <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
                    Sign in to generate images and keep your image history available across
                    sessions.
                  </p>
                  <SignInButton mode="modal">
                    <Button className="mt-5 min-h-11">Sign in</Button>
                  </SignInButton>
                </div>
              ) : history.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border p-10 text-center">
                  <div className="mx-auto w-10 h-10 rounded-full bg-foreground/5 flex items-center justify-center mb-3">
                    <Sparkles className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Your generated images will appear here. Pick a style or describe an image above.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                  {history.map((h) => (
                    <article
                      key={h.id}
                      className="group relative aspect-square overflow-hidden rounded-2xl bg-muted ring-1 ring-border"
                    >
                      <button
                        type="button"
                        onClick={(event) => {
                          lightboxReturnFocusRef.current = event.currentTarget;
                          setLightbox(h);
                        }}
                        className="absolute inset-0 w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/60"
                        aria-label={`Open image: ${h.prompt}`}
                      >
                        <img
                          src={h.imageUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="absolute inset-0 h-full w-full object-cover "
                        />
                      </button>
                      <div className="pointer-events-none absolute inset-0 flex flex-col justify-end gap-1.5 bg-gradient-to-t from-black/85 via-black/25 to-transparent p-2 opacity-100 transition md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                        <p className="line-clamp-2 text-[11px] text-white" title={h.prompt}>
                          {h.prompt}
                        </p>
                        <div className="pointer-events-auto relative z-10 flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setPrompt(h.prompt);
                              inputRef.current?.focus();
                            }}
                            className="min-h-11 flex-1 rounded-full bg-white px-2 text-[11px] font-medium text-black hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                            aria-label={`Reuse prompt: ${h.prompt}`}
                          >
                            Reuse
                          </button>
                          <a
                            href={h.imageUrl}
                            download={`kovagpt-${h.id}.png`}
                            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                            aria-label={`Download image: ${h.prompt}`}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </a>
                          <button
                            type="button"
                            onClick={() => removeFromHistory(h.id)}
                            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white hover:bg-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                            aria-label={`Remove image: ${h.prompt}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </main>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onChange={setSettings}
        initialTab={settingsTab}
        returnFocusTarget={settingsReturnFocusRef.current}
        onClearAll={() => {
          try {
            if (userKey) localStorage.removeItem(HISTORY_KEY_PREFIX + userKey);
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

      <Dialog
        open={Boolean(lightbox)}
        onOpenChange={(open) => {
          if (!open) setLightbox(null);
        }}
      >
        {lightbox && (
          <DialogContent
            constrainToViewport={false}
            data-image-lightbox
            className="image-lightbox left-0 right-0 top-0 bottom-0 h-dvh w-screen max-h-none max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-none border-0 bg-black/85 p-4 pb-4 text-white shadow-none  sm:inset-0 sm:h-dvh sm:w-screen sm:max-h-none sm:max-w-none sm:translate-x-0 sm:translate-y-0 sm:rounded-none sm:border-0 sm:p-8 sm:pb-8"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              lightboxInitialFocusRef.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const prior = lightboxReturnFocusRef.current;
              const target =
                lightboxReturnToPromptRef.current || !prior?.isConnected ? inputRef.current : prior;
              lightboxReturnToPromptRef.current = false;
              lightboxReturnFocusRef.current = null;
              target?.focus();
            }}
          >
            <DialogTitle className="sr-only">Image preview</DialogTitle>
            <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col items-center justify-center gap-4">
              <img
                src={lightbox.imageUrl}
                alt={lightbox.prompt}
                decoding="async"
                className="max-h-[75dvh] w-auto max-w-full rounded-2xl shadow-lg object-contain"
              />
              <DialogDescription className="max-w-2xl px-4 text-center text-sm text-white/85 line-clamp-3">
                {lightbox.prompt}
              </DialogDescription>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  ref={lightboxInitialFocusRef}
                  onClick={() => {
                    lightboxReturnToPromptRef.current = true;
                    setPrompt(lightbox.prompt);
                    setLightbox(null);
                  }}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-black transition hover:opacity-90"
                >
                  <Sparkles className="w-4 h-4" /> Reuse prompt
                </button>
                <button
                  onClick={() => {
                    const item = lightbox;
                    setLightbox(null);
                    void generate(item.prompt);
                  }}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/10 px-4 text-sm text-white transition hover:bg-white/20"
                >
                  <RefreshCw className="h-4 w-4" /> Generate again
                </button>
                <button
                  onClick={() => saveGeneratedImage(lightbox)}
                  disabled={savingImage}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/10 px-4 text-sm text-white transition hover:bg-white/20 disabled:opacity-50"
                >
                  <Bookmark className="h-4 w-4" /> Save
                </button>
                <a
                  href={lightbox.imageUrl}
                  download={`kovagpt-${lightbox.id}.png`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/10 px-4 text-sm text-white transition hover:bg-white/20"
                >
                  <Download className="w-4 h-4" /> Download
                </a>
                <button
                  onClick={() => {
                    removeFromHistory(lightbox.id);
                    setLightbox(null);
                  }}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/10 px-4 text-sm text-white transition hover:bg-destructive"
                >
                  <Trash2 className="w-4 h-4" /> Remove
                </button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
