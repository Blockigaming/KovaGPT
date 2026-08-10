import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { authFetch } from "@/lib/auth-fetch";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUp,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Loader2,
  PanelLeft,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sidebar } from "@/components/Sidebar";
import { SettingsDialog } from "@/components/SettingsDialog";
import { LoginRequiredModal } from "@/components/LoginRequiredModal";
import { UsageLimitModal } from "@/components/UsageLimitModal";
import { useUser, SignInButton, SignUpButton, UserButton } from "@/components/auth/ClerkSafe";
import { toast } from "sonner";
import { useNovaSettings } from "@/hooks/useNovaSettings";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useServerFn } from "@tanstack/react-start";
import { saveToLibrary } from "@/lib/server/library-server-fns";

import cinematicImg from "@/assets/presets/cinematic.jpg";
import watercolorImg from "@/assets/presets/watercolor.jpg";
import cyberpunkImg from "@/assets/presets/cyberpunk.jpg";
import oilPaintingImg from "@/assets/presets/oil-painting.jpg";
import animeImg from "@/assets/presets/anime.jpg";
import filmNoirImg from "@/assets/presets/film-noir.jpg";
import pixelArtImg from "@/assets/presets/pixel-art.jpg";
import claymationImg from "@/assets/presets/claymation.jpg";
import origamiImg from "@/assets/presets/origami.jpg";
import comicBookImg from "@/assets/presets/comic-book.jpg";
import isometricImg from "@/assets/presets/isometric.jpg";
import lowPolyImg from "@/assets/presets/low-poly.jpg";
import ghibliImg from "@/assets/presets/ghibli.jpg";
import popArtImg from "@/assets/presets/pop-art.jpg";
import blueprintImg from "@/assets/presets/blueprint.jpg";

export const Route = createFileRoute("/images")({ component: ImagesPage });

type Preset = { label: string; prompt: string; seed: string; image: string };

const PRESETS: Preset[] = [
  {
    label: "Cinematic",
    prompt:
      "A cinematic still of my subject, dramatic lighting, shallow depth of field, anamorphic lens, 35mm film grain",
    seed: "cinematic",
    image: cinematicImg,
  },
  {
    label: "Watercolor",
    prompt:
      "A delicate watercolor painting of my subject on textured cotton paper, soft washes, visible brush strokes",
    seed: "watercolor",
    image: watercolorImg,
  },
  {
    label: "Cyberpunk",
    prompt:
      "A cyberpunk scene of my subject, neon city at night, rain-slicked streets, magenta and cyan glow",
    seed: "cyberpunk",
    image: cyberpunkImg,
  },
  {
    label: "Oil painting",
    prompt:
      "A classical oil painting of my subject, rich impasto texture, chiaroscuro lighting, museum quality",
    seed: "oil-painting",
    image: oilPaintingImg,
  },
  {
    label: "Anime",
    prompt:
      "An anime illustration of my subject, vibrant colors, expressive composition, clean cel shading, high detail",
    seed: "anime",
    image: animeImg,
  },
  {
    label: "Film noir",
    prompt:
      "A black and white film noir portrait of my subject, venetian-blind shadows, high contrast, 1940s detective atmosphere",
    seed: "film-noir",
    image: filmNoirImg,
  },
  {
    label: "Pixel art",
    prompt:
      "Pixel art of my subject, 16-bit game style, limited color palette, crisp edges, nostalgic arcade aesthetic",
    seed: "pixel-art",
    image: pixelArtImg,
  },
  {
    label: "Claymation",
    prompt:
      "A handcrafted claymation model of my subject, stop-motion studio lighting, visible clay texture, whimsical",
    seed: "claymation",
    image: claymationImg,
  },
  {
    label: "Origami",
    prompt:
      "An intricate origami sculpture of my subject, folded paper, soft studio shadows, clean minimal background",
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
  const saveImage = useServerFn(saveToLibrary);
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
      if (typeof data.imageUrl !== "string" || !/^https?:\/\//i.test(data.imageUrl)) {
        throw new Error("Image service returned an invalid image");
      }
      setResult(data.imageUrl);
      setResultPrompt(trimmed);
      addToHistory(trimmed, data.imageUrl);
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

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 flex items-center px-3 shrink-0">
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="p-2 rounded-lg hover:bg-accent transition mr-1"
              aria-label="Toggle sidebar"
            >
              <PanelLeft className="w-5 h-5" />
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {isSignedIn ? (
              <UserButton />
            ) : (
              <>
                <SignInButton mode="modal">
                  <button className="text-sm font-semibold px-4 py-1.5 rounded-full bg-foreground text-background hover:opacity-90 transition">
                    Log in
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="text-sm font-medium px-3 sm:px-4 py-1.5 rounded-full bg-muted text-foreground hover:bg-accent transition whitespace-nowrap">
                    Sign up for free
                  </button>
                </SignUpButton>
              </>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-2 pb-24">
            <h1 className="text-[34px] sm:text-[40px] font-semibold tracking-tight">Images</h1>

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
                  placeholder="Describe a new image"
                  spellCheck={false}
                  autoComplete="off"
                  className="min-w-0 flex-1 border-0 bg-transparent text-[16px] outline-none placeholder:text-muted-foreground focus:outline-none focus:ring-0"
                />
                <button
                  type="submit"
                  disabled={!prompt.trim() || loading}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition hover:opacity-90 disabled:opacity-30"
                  aria-label="Generate"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
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
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:bg-accent hover:text-foreground"
                    aria-label="Scroll styles left"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollPresets(1)}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:bg-accent hover:text-foreground"
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
                      className="group flex flex-col items-start w-[160px] shrink-0 focus:outline-none"
                    >
                      <div className="relative w-[160px] h-[160px] rounded-2xl overflow-hidden ring-1 ring-border/60 bg-muted">
                        <img
                          src={p.image}
                          alt={p.label}
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
                  <div className="max-w-md mx-auto aspect-square rounded-2xl overflow-hidden relative ring-1 ring-border bg-gradient-to-br from-fuchsia-500/20 via-violet-500/20 to-cyan-500/20">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,hsl(280_90%_60%/0.35),transparent_55%),radial-gradient(circle_at_70%_80%,hsl(190_90%_55%/0.35),transparent_55%),radial-gradient(circle_at_50%_50%,hsl(320_90%_60%/0.25),transparent_60%)] animate-[imgAura_6s_ease-in-out_infinite]" />
                    <div
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent animate-[shimmer_1.8s_infinite]"
                      style={{ backgroundSize: "200% 100%" }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center text-sm text-muted-foreground">
                        Creating your image…
                      </div>
                    </div>
                  </div>
                )}

                {error && (
                  <div
                    className="max-w-md mx-auto p-4 rounded-xl bg-destructive/10 text-destructive text-sm"
                    role="alert"
                  >
                    {error}
                  </div>
                )}

                {result && (
                  <div className="max-w-md mx-auto">
                    <div className="relative aspect-square rounded-2xl overflow-hidden ring-1 ring-border bg-muted">
                      <img
                        src={result}
                        alt={resultPrompt || "Generated image"}
                        width={1024}
                        height={1024}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          saveGeneratedImage({ prompt: resultPrompt, imageUrl: result })
                        }
                        disabled={savingImage}
                        className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
                      >
                        {savingImage ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Bookmark className="h-4 w-4" />
                        )}
                        Save to Library
                      </button>
                      <button
                        type="button"
                        onClick={() => copyGeneratedImage(result)}
                        className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent"
                      >
                        <Copy className="h-4 w-4" />
                        Copy
                      </button>
                      <a
                        href={result}
                        download
                        className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent"
                      >
                        <ArrowDownToLine className="h-4 w-4" />
                        Download
                      </a>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* History */}
            {history.length > 0 && (
              <section className="mt-12">
                <div className="mb-3 flex items-center gap-2">
                  <Clock3 className="h-5 w-5 text-muted-foreground" />
                  <h2 className="text-[22px] font-semibold tracking-tight">History</h2>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {history.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        lightboxReturnFocusRef.current =
                          document.activeElement instanceof HTMLElement
                            ? document.activeElement
                            : null;
                        setLightbox(item);
                      }}
                      className="group relative aspect-square overflow-hidden rounded-2xl bg-muted ring-1 ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <img
                        src={item.imageUrl}
                        alt={item.prompt}
                        loading="lazy"
                        width={1024}
                        height={1024}
                        className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                      />
                      <span className="absolute inset-x-0 bottom-0 line-clamp-2 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-10 text-left text-xs text-white">
                        {item.prompt}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </main>

      {settingsOpen && (
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          settings={settings}
          onSettingsChange={setSettings}
          initialTab={settingsTab}
          returnFocusRef={settingsReturnFocusRef}
        />
      )}

      {loginOpen && <LoginRequiredModal open={loginOpen} onOpenChange={setLoginOpen} />}
      {limitOpen && (
        <UsageLimitModal open={limitOpen} onOpenChange={setLimitOpen} message={limitMessage} />
      )}

      {lightbox && (
        <ImageLightbox
          item={lightbox}
          onClose={() => setLightbox(null)}
          onRemove={() => {
            removeFromHistory(lightbox.id);
            setLightbox(null);
          }}
          onReuse={() => {
            setPrompt(lightbox.prompt);
            lightboxReturnToPromptRef.current = true;
            setLightbox(null);
          }}
          onSave={() => saveGeneratedImage(lightbox)}
          onCopy={() => copyGeneratedImage(lightbox.imageUrl)}
          saving={savingImage}
          initialFocusRef={lightboxInitialFocusRef}
          returnFocusRef={lightboxReturnFocusRef}
          returnToPromptRef={lightboxReturnToPromptRef}
          promptRef={inputRef}
        />
      )}
    </div>
  );
}

function ImageLightbox({
  item,
  onClose,
  onRemove,
  onReuse,
  onSave,
  onCopy,
  saving,
  initialFocusRef,
  returnFocusRef,
  returnToPromptRef,
  promptRef,
}: {
  item: HistoryItem;
  onClose: () => void;
  onRemove: () => void;
  onReuse: () => void;
  onSave: () => void;
  onCopy: () => void;
  saving: boolean;
  initialFocusRef: React.RefObject<HTMLButtonElement | null>;
  returnFocusRef: React.MutableRefObject<HTMLElement | null>;
  returnToPromptRef: React.MutableRefObject<boolean>;
  promptRef: React.RefObject<HTMLInputElement | null>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true, initialFocusRef, () => {
    if (returnToPromptRef.current) {
      returnToPromptRef.current = false;
      promptRef.current?.focus();
      return;
    }
    returnFocusRef.current?.focus();
  });

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Generated image"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="relative max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-background p-3 shadow-2xl"
      >
        <div className="relative overflow-hidden rounded-xl bg-muted">
          <img
            src={item.imageUrl}
            alt={item.prompt}
            width={1024}
            height={1024}
            className="max-h-[70dvh] w-full object-contain"
          />
          <button
            ref={initialFocusRef}
            type="button"
            onClick={onClose}
            className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
            aria-label="Close image"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{item.prompt}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onReuse}
            className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent"
          >
            <ArrowUp className="h-4 w-4" />
            Reuse prompt
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Bookmark className="h-4 w-4" />
            )}
            Save to Library
          </button>
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent"
          >
            <Copy className="h-4 w-4" />
            Copy
          </button>
          <a
            href={item.imageUrl}
            download
            className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium transition hover:bg-accent"
          >
            <ArrowDownToLine className="h-4 w-4" />
            Download
          </a>
          <button
            type="button"
            onClick={onRemove}
            className={cn(
              "ml-auto inline-flex items-center gap-2 rounded-full border border-destructive/40 px-4 py-2 text-sm font-medium text-destructive transition hover:bg-destructive/10",
            )}
          >
            <Trash2 className="h-4 w-4" />
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
