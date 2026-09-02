import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Bookmark,
  ChevronDown,
  Copy,
  Download,
  Loader2,
  PanelLeft,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { LimitReachedDialog } from "@/components/LimitReachedDialog";
import { LoginPromptDialog } from "@/components/LoginPromptDialog";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Sidebar } from "@/components/Sidebar";
import { SignInButton, SignUpButton, UserButton, useClerkSafe, useUser } from "@/components/auth/ClerkSafe";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { authFetch } from "@/lib/auth-fetch";
import { getUsage } from "@/lib/limits";
import { saveToLibrary } from "@/lib/library.functions";
import { useNovaSettings } from "@/lib/use-nova-settings";

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

type Preset = { label: string; prompt: string; seed: string; image: string };

const PRESETS: readonly Preset[] = [
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
    label: "Action shot",
    prompt: "A dynamic action shot mid-motion, dramatic lighting, sports photography, sharp focus",
    seed: "action-shot",
    image: actionShotImg,
  },
  {
    label: "Interior design",
    prompt:
      "A modern interior of my described room, warm wood, natural light, magazine photography",
    seed: "interior-design",
    image: interiorDesignImg,
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
    label: "3D render",
    prompt: "A glossy 3D render of my subject, soft studio lighting, detailed materials",
    seed: "3d-render",
    image: threeDRenderImg,
  },
  {
    label: "Bobblehead",
    prompt:
      "A miniature bobblehead figurine on a stadium field, oversized head, detailed uniform, studio lighting",
    seed: "bobblehead",
    image: bobbleheadImg,
  },
  {
    label: "Handwritten",
    prompt:
      "A candid family moment illustrated in a warm handwritten storybook style, pastel palette",
    seed: "handwritten",
    image: handwrittenImg,
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
    label: "Oil painting",
    prompt:
      "A classical oil painting portrait of my subject, rich textured brush strokes, dramatic lighting",
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
    label: "Cyberpunk",
    prompt:
      "My subject in a neon cyberpunk city street at night, rain reflections, vivid lights, cinematic",
    seed: "cyberpunk",
    image: cyberpunkImg,
  },
  {
    label: "Vintage poster",
    prompt: "A vintage travel poster of my subject, bold flat colors, mid-century composition",
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
    prompt: "A low poly geometric render of my subject, flat shaded triangles, minimal background",
    seed: "low-poly",
    image: lowPolyImg,
  },
  {
    label: "Storybook",
    prompt: "A hand-painted storybook scene of my subject, lush environment, nostalgic warm light",
    seed: "ghibli",
    image: ghibliImg,
  },
  {
    label: "Pop art",
    prompt: "A bold pop-art portrait of my subject, flat color blocks, screen-print texture",
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

const CURATED_STYLES = PRESETS.slice(0, 8);
const MORE_STYLES = PRESETS.slice(8);

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
    /* ignore */
  }
}

function ImagesPage() {
  const navigate = useNavigate();
  const { isLoaded, isSignedIn, user } = useUser();
  const { openSignIn } = useClerkSafe();
  const userKey = user?.id ?? null;
  const [settings, setSettings] = useNovaSettings(userKey, isLoaded);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined);
  const settingsReturnFocusRef = useRef<HTMLElement | null>(null);

  const openSettings = (tab?: string) => {
    if (isLoaded && !isSignedIn) {
      openSignIn();
      return;
    }
    settingsReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSettingsTab(tab);
    setSettingsOpen(true);
  };

  useEffect(() => {
    const handleOpenSettings = (event: Event) =>
      openSettings((event as CustomEvent<{ tab?: string }>).detail?.tab);
    window.addEventListener("kova-open-settings", handleOpenSettings);
    return () => window.removeEventListener("kova-open-settings", handleOpenSettings);
  });

  const openHelp = () => navigate({ to: "/help" as never });
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [resultPrompt, setResultPrompt] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);
  const [limitMessage, setLimitMessage] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [lightbox, setLightbox] = useState<HistoryItem | null>(null);
  const [savingImage, setSavingImage] = useState(false);
  const saveImage = useServerFn(saveToLibrary);
  const submittingRef = useRef(false);
  const generationRef = useRef(0);
  const generationControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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

  function addToHistory(nextPrompt: string, imageUrl: string) {
    if (!isSignedIn || !userKey) return;
    const item: HistoryItem = {
      id: crypto.randomUUID(),
      prompt: nextPrompt,
      imageUrl,
      createdAt: Date.now(),
    };
    setHistory((previous) => {
      const next = [item, ...previous].slice(0, HISTORY_LIMIT);
      saveHistory(userKey, next);
      return next;
    });
  }

  function removeFromHistory(id: string) {
    setHistory((previous) => {
      const next = previous.filter((item) => item.id !== id);
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
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "Could not save image");
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
    } catch (copyError) {
      toast.error(copyError instanceof Error ? copyError.message : "Could not copy image");
    }
  }

  async function generate(nextPrompt: string) {
    const trimmed = nextPrompt.trim();
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
      const response = await authFetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("application/json")) {
        throw new Error("Image service returned an invalid response");
      }
      const data = (await response.json()) as { error?: unknown; imageUrl?: unknown };
      if (generation !== generationRef.current || controller.signal.aborted) return;
      if (!response.ok) {
        const message = typeof data.error === "string" ? data.error : "Failed to generate image";
        if (response.status === 429 && /limit/i.test(message)) {
          setLimitMessage(message);
          setLimitOpen(true);
        }
        throw new Error(message);
      }
      if (typeof data.imageUrl !== "string" || !/^https?:\/\//i.test(data.imageUrl)) {
        throw new Error("Image service returned an invalid image");
      }
      setResult(data.imageUrl);
      setResultPrompt(trimmed);
      addToHistory(trimmed, data.imageUrl);
      setPrompt("");
    } catch (generationError) {
      if (controller.signal.aborted || generation !== generationRef.current) return;
      setError(
        generationError instanceof Error ? generationError.message : "Failed to generate image",
      );
    } finally {
      if (generation === generationRef.current) {
        setLoading(false);
        submittingRef.current = false;
        generationControllerRef.current = null;
      }
    }
  }

  const applyPreset = (preset: Preset) => {
    setPrompt(preset.prompt);
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
        onToggle={() => setSidebarOpen((value) => !value)}
        onOpenSettings={openSettings}
        onOpenHelp={openHelp}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center border-b border-border/40 px-3">
          {!sidebarOpen ? (
            <button
              onClick={() => setSidebarOpen(true)}
              className="mr-1 rounded-lg p-2 transition hover:bg-accent"
              aria-label="Toggle sidebar"
            >
              <PanelLeft className="h-5 w-5" />
            </button>
          ) : null}
          <span className="text-sm font-semibold tracking-tight">Images</span>
          <div className="ml-auto flex items-center gap-2">
            {isSignedIn ? (
              <UserButton />
            ) : (
              <>
                <SignInButton mode="modal">
                  <button className="min-h-10 rounded-full bg-foreground px-4 text-sm font-semibold text-background transition hover:opacity-90">
                    Log in
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="hidden min-h-10 rounded-full bg-muted px-4 text-sm font-medium transition hover:bg-accent sm:inline-flex sm:items-center">
                    Sign up
                  </button>
                </SignUpButton>
              </>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-8 sm:px-6 sm:pt-10">
            <section className="mx-auto max-w-3xl text-center">
              <div className="mx-auto mb-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/35 px-3 py-1 text-xs font-medium text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5" /> Kova Images
              </div>
              <h1 className="text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
                What do you want to create?
              </h1>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
                Describe the image in your own words or start from a style below. You stay in control
                of the final prompt.
              </p>
            </section>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void generate(prompt);
              }}
              className="mx-auto mt-7 max-w-3xl"
            >
              <div className="kova-composer rounded-2xl border border-border bg-card p-3 shadow-[0_18px_60px_-46px_hsl(var(--foreground)/0.55)] focus-within:border-foreground/40">
                <textarea
                  ref={inputRef}
                  value={prompt}
                  aria-label="Describe the image to generate"
                  maxLength={2000}
                  rows={3}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      void generate(prompt);
                    }
                  }}
                  placeholder="Describe a cinematic scene, product concept, logo, illustration…"
                  spellCheck={false}
                  className="min-h-24 w-full resize-none border-0 bg-transparent px-1 py-1 text-[16px] leading-6 outline-none placeholder:text-muted-foreground focus:outline-none focus:ring-0"
                />
                <div className="mt-2 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
                  <span className="text-xs text-muted-foreground">
                    Enter to create · Shift+Enter for a new line
                  </span>
                  <button
                    type="submit"
                    disabled={!prompt.trim() || loading}
                    className="inline-flex min-h-10 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-semibold text-background transition hover:opacity-90 disabled:opacity-35"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                    {loading ? "Creating" : "Create"}
                  </button>
                </div>
              </div>
              {!isSignedIn && isLoaded ? (
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  Sign in when you create. Image generation is available when the configured image
                  service is online and you have usage remaining.
                </p>
              ) : null}
            </form>

            {(loading || result || error) ? (
              <section className="mx-auto mt-8 max-w-3xl" aria-live="polite">
                {loading && !result ? (
                  <div className="mx-auto grid aspect-square max-w-md place-items-center rounded-2xl border border-border bg-muted/35">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <div className="grid h-12 w-12 place-items-center rounded-full bg-background shadow-sm">
                        <Loader2 className="h-5 w-5 animate-spin" />
                      </div>
                      <p className="text-sm font-medium">Creating your image…</p>
                    </div>
                  </div>
                ) : null}

                {result ? (
                  <div className="mx-auto max-w-md">
                    <img
                      src={result}
                      alt={resultPrompt || "Generated image"}
                      decoding="async"
                      className="w-full rounded-2xl ring-1 ring-border"
                    />
                    <div className="mt-3 flex flex-wrap justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => void saveGeneratedImage({ prompt: resultPrompt, imageUrl: result })}
                        disabled={savingImage}
                        className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
                      >
                        <Bookmark className="h-4 w-4" />
                        {savingImage ? "Saving…" : "Save to Library"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void generate(resultPrompt)}
                        disabled={loading}
                        className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
                      >
                        <RefreshCw className="h-4 w-4" /> Generate again
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyGeneratedImage(result)}
                        className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium transition hover:bg-accent"
                      >
                        <Copy className="h-4 w-4" /> Copy
                      </button>
                      <a
                        href={result}
                        download="kovagpt-image.png"
                        className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium transition hover:bg-accent"
                      >
                        <Download className="h-4 w-4" /> Download
                      </a>
                    </div>
                  </div>
                ) : null}

                {error ? (
                  <div className="mx-auto max-w-xl rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-center text-sm text-destructive">
                    {error}
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="mt-12" aria-labelledby="image-styles">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    Start faster
                  </p>
                  <h2 id="image-styles" className="mt-1 text-2xl font-semibold tracking-tight">
                    Curated styles
                  </h2>
                </div>
                <p className="hidden max-w-sm text-right text-sm text-muted-foreground md:block">
                  Choosing a style fills the prompt. Edit it before creating anything.
                </p>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {CURATED_STYLES.map((preset) => (
                  <StyleCard key={preset.seed} preset={preset} onSelect={applyPreset} />
                ))}
              </div>

              <details className="group mt-4 rounded-xl border border-border/70 bg-card/35">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-medium">
                  Explore {MORE_STYLES.length} more styles
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                </summary>
                <div className="grid grid-cols-2 gap-3 border-t border-border/70 p-3 sm:grid-cols-4 lg:grid-cols-6">
                  {MORE_STYLES.map((preset) => (
                    <StyleCard key={preset.seed} preset={preset} onSelect={applyPreset} compact />
                  ))}
                </div>
              </details>
            </section>

            <section className="mt-12" aria-labelledby="image-gallery">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Your work
                </p>
                <h2 id="image-gallery" className="mt-1 text-2xl font-semibold tracking-tight">
                  Gallery
                </h2>
              </div>

              {history.length === 0 ? (
                <div className="mt-5 rounded-2xl border border-dashed border-border bg-muted/15 px-6 py-12 text-center">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-background shadow-sm ring-1 ring-border/70">
                    <Sparkles className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <h3 className="mt-4 font-semibold">Your gallery starts here</h3>
                  <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">
                    {isSignedIn
                      ? "Create your first image or start with a style. Recent generations on this device will appear here."
                      : "Sign in to create images. Your recent generations on this device will appear here after you start creating."}
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    {isSignedIn ? (
                      <>
                        <button
                          type="button"
                          onClick={() => applyPreset(CURATED_STYLES[0])}
                          className="min-h-10 rounded-full bg-foreground px-4 text-sm font-semibold text-background"
                        >
                          Try Portrait mode
                        </button>
                        <button
                          type="button"
                          onClick={() => applyPreset(CURATED_STYLES[5])}
                          className="min-h-10 rounded-full border border-border bg-background px-4 text-sm font-medium hover:bg-accent"
                        >
                          Try Logo mark
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setLoginOpen(true)}
                        className="min-h-10 rounded-full bg-foreground px-4 text-sm font-semibold text-background"
                      >
                        Sign in to create
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                  {history.map((item) => (
                    <article
                      key={item.id}
                      className="group relative aspect-square overflow-hidden rounded-2xl bg-muted ring-1 ring-border"
                    >
                      <button
                        type="button"
                        onClick={(event) => {
                          lightboxReturnFocusRef.current = event.currentTarget;
                          setLightbox(item);
                        }}
                        className="absolute inset-0 w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/60"
                        aria-label={`Open image: ${item.prompt}`}
                      >
                        <img
                          src={item.imageUrl}
                          alt={item.prompt}
                          loading="lazy"
                          decoding="async"
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      </button>
                      <div className="pointer-events-none absolute inset-0 flex flex-col justify-end gap-1.5 bg-gradient-to-t from-black/85 via-black/25 to-transparent p-2 opacity-100 transition md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                        <p className="line-clamp-2 text-[11px] text-white" title={item.prompt}>
                          {item.prompt}
                        </p>
                        <div className="pointer-events-auto relative z-10 flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setPrompt(item.prompt);
                              inputRef.current?.focus();
                            }}
                            className="min-h-11 flex-1 rounded-full bg-white px-2 text-[11px] font-medium text-black hover:opacity-90"
                          >
                            Reuse
                          </button>
                          <a
                            href={item.imageUrl}
                            download={`kovagpt-${item.id}.png`}
                            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
                            aria-label="Download"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </a>
                          <button
                            type="button"
                            onClick={() => removeFromHistory(item.id)}
                            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white hover:bg-destructive"
                            aria-label="Remove"
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

      {settingsOpen && isSignedIn ? (
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
      ) : null}

      <LoginPromptDialog
        open={loginOpen}
        onOpenChange={setLoginOpen}
        title="Log in to create"
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
        {lightbox ? (
          <DialogContent
            constrainToViewport={false}
            data-image-lightbox
            className="image-lightbox bottom-0 left-0 right-0 top-0 h-dvh w-screen max-h-none max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-none border-0 bg-black/85 p-4 pb-4 text-white shadow-none sm:inset-0 sm:h-dvh sm:w-screen sm:max-h-none sm:max-w-none sm:translate-x-0 sm:translate-y-0 sm:rounded-none sm:border-0 sm:p-8 sm:pb-8"
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
                className="max-h-[75dvh] w-auto max-w-full rounded-2xl object-contain shadow-lg"
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
                  className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-black transition hover:opacity-90"
                >
                  <Sparkles className="h-4 w-4" /> Reuse prompt
                </button>
                <button
                  onClick={() => {
                    const item = lightbox;
                    setLightbox(null);
                    void generate(item.prompt);
                  }}
                  className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white/10 px-4 text-sm text-white transition hover:bg-white/20"
                >
                  <RefreshCw className="h-4 w-4" /> Generate again
                </button>
                <button
                  onClick={() => void saveGeneratedImage(lightbox)}
                  disabled={savingImage}
                  className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white/10 px-4 text-sm text-white transition hover:bg-white/20 disabled:opacity-50"
                >
                  <Bookmark className="h-4 w-4" /> Save
                </button>
                <button
                  onClick={() => void copyGeneratedImage(lightbox.imageUrl)}
                  className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white/10 px-4 text-sm text-white transition hover:bg-white/20"
                >
                  <Copy className="h-4 w-4" /> Copy
                </button>
                <a
                  href={lightbox.imageUrl}
                  download={`kovagpt-${lightbox.id}.png`}
                  className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white/10 px-4 text-sm text-white transition hover:bg-white/20"
                >
                  <Download className="h-4 w-4" /> Download
                </a>
                <button
                  onClick={() => {
                    removeFromHistory(lightbox.id);
                    setLightbox(null);
                  }}
                  className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white/10 px-4 text-sm text-white transition hover:bg-destructive"
                >
                  <Trash2 className="h-4 w-4" /> Remove
                </button>
              </div>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function StyleCard({
  preset,
  onSelect,
  compact = false,
}: {
  preset: Preset;
  onSelect: (preset: Preset) => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(preset)}
      className="group min-w-0 text-left focus:outline-none"
      aria-label={`Use ${preset.label} style`}
    >
      <div
        className={`relative overflow-hidden rounded-2xl bg-muted ring-1 ring-border/60 ${
          compact ? "aspect-square" : "aspect-[4/3]"
        }`}
      >
        <img
          src={preset.image}
          alt=""
          loading="lazy"
          width={512}
          height={512}
          className="absolute inset-0 h-full w-full object-cover transition duration-200 group-hover:scale-[1.025]"
        />
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-3 pb-2.5 pt-10 text-sm font-medium text-white">
          {preset.label}
        </span>
      </div>
    </button>
  );
}
