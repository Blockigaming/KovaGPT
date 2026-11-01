import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Copy, Download, ExternalLink, EyeOff, ImagePlus } from "lucide-react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";
import {
  chatImageFile,
  chatImageFingerprint,
  copyChatImage,
  downloadChatImage,
  openChatImage,
  type ChatImageAttachmentHandler,
} from "@/lib/chat-image-actions";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
  principalScopedStorageKey,
  safeBrowserStorage,
} from "@/lib/principal-browser-storage.mjs";

export type ChatImageActions = {
  ownerId: string | null;
  scope: string;
  temporary: boolean;
  prepareAdd: () => ChatImageAttachmentHandler;
};
const HIDDEN_CHANGED = "kova:hidden-chat-images-changed";
const HIDDEN_BASE = "kova-hidden-chat-images";
function hiddenMarkers(key: string | null): string[] {
  if (!key) return [];
  try {
    const parsed: unknown = JSON.parse(safeBrowserStorage("localStorage")?.getItem(key) ?? "[]");
    return Array.isArray(parsed)
      ? parsed
          .filter((value): value is string => typeof value === "string" && value.length <= 2048)
          .slice(-1000)
      : [];
  } catch {
    return [];
  }
}

/** The same five actions for a message upload, a response image and its full-size viewer. */
export function ChatImage({
  src,
  alt,
  actions,
  className,
  imageClassName,
  children,
  onHide,
}: {
  src: string;
  alt: string;
  actions?: ChatImageActions;
  className?: string;
  imageClassName?: string;
  children?: ReactNode;
  onHide?: () => void;
}) {
  const fingerprint = useMemo(() => chatImageFingerprint(src), [src]);
  const marker = `${chatImageFingerprint(JSON.stringify([actions?.ownerId, actions?.scope ?? "preview"]))}:${fingerprint}`;
  const key =
    actions?.ownerId && !actions.temporary
      ? principalScopedStorageKey(HIDDEN_BASE, actions.ownerId)
      : null;
  const [visibility, setVisibility] = useState({ marker, hidden: false });
  const [busy, setBusy] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const showRef = useRef<HTMLButtonElement>(null);
  const lifetime = useRef({ marker, generation: 0, mounted: true });
  if (lifetime.current.marker !== marker) {
    lifetime.current.marker = marker;
    lifetime.current.generation++;
  }
  useEffect(() => {
    const state = lifetime.current;
    state.mounted = true;
    return () => {
      state.mounted = false;
      state.generation++;
    };
  }, []);
  useEffect(() => {
    const refresh = () => {
      if (key) setVisibility({ marker, hidden: hiddenMarkers(key).includes(marker) });
    };
    setVisibility({ marker, hidden: hiddenMarkers(key).includes(marker) });
    setBusy(false);
    const reset = (event: Event) => {
      if (!isPrincipalBrowserStorageClearedEvent(event, actions?.ownerId ?? null)) return;
      lifetime.current.generation++;
      setVisibility({ marker, hidden: false });
      setBusy(false);
    };
    window.addEventListener("storage", refresh);
    window.addEventListener(HIDDEN_CHANGED, refresh);
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(HIDDEN_CHANGED, refresh);
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    };
  }, [key, marker, actions?.ownerId]);
  const hide = (hidden: boolean) => {
    setVisibility({ marker, hidden });
    setBusy(false);
    lifetime.current.generation++;
    if (key) {
      const next = hiddenMarkers(key).filter((value) => value !== marker);
      if (hidden) next.push(marker);
      try {
        const storage = safeBrowserStorage("localStorage");
        if (storage) {
          storage.setItem(key, JSON.stringify(next.slice(-1000)));
          window.dispatchEvent(new Event(HIDDEN_CHANGED));
        }
      } catch {
        // Hiding still works in this view when browser storage is full or disabled.
      }
    }
    if (hidden) onHide?.();
    const generation = lifetime.current.generation;
    window.requestAnimationFrame(() => {
      if (
        !lifetime.current.mounted ||
        lifetime.current.marker !== marker ||
        lifetime.current.generation !== generation
      )
        return;
      (hidden ? showRef.current : imageRef.current)?.focus({ preventScroll: true });
    });
  };
  const run = async (operation: (allowed: () => boolean) => Promise<void>) => {
    if (busy) return;
    const generation = lifetime.current.generation;
    const allowed = () =>
      lifetime.current.mounted &&
      lifetime.current.marker === marker &&
      lifetime.current.generation === generation;
    setBusy(true);
    try {
      await operation(allowed);
    } catch (error) {
      if (allowed())
        toast.error(
          error instanceof Error ? error.message : "Could not complete the image action.",
        );
    } finally {
      if (allowed()) setBusy(false);
    }
  };
  if (visibility.marker === marker && visibility.hidden)
    return (
      <span className="my-2 inline-flex max-w-full items-center gap-3 rounded-2xl border border-border/60 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <EyeOff className="h-4 w-4 shrink-0" aria-hidden="true" /> Image hidden
        <button
          ref={showRef}
          type="button"
          className="min-h-11 rounded-full px-3 font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => hide(false)}
        >
          Show image
        </button>
      </span>
    );
  return (
    <ContextMenu>
      <span
        className={`inline-block min-w-0 max-w-full ${className ?? ""}`}
        data-chat-image="true"
        aria-busy={busy || undefined}
      >
        <ContextMenuTrigger asChild>
          <img
            ref={imageRef}
            src={src}
            alt={alt}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            tabIndex={0}
            aria-haspopup="menu"
            className={imageClassName}
            onKeyDown={(event) => {
              if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
              event.preventDefault();
              const box = event.currentTarget.getBoundingClientRect();
              event.currentTarget.dispatchEvent(
                new MouseEvent("contextmenu", {
                  bubbles: true,
                  cancelable: true,
                  clientX: box.left + Math.min(box.width / 2, 40),
                  clientY: box.top + Math.min(box.height / 2, 40),
                }),
              );
            }}
          />
        </ContextMenuTrigger>
        {children}
      </span>
      <ContextMenuContent className="w-60" aria-label="Image actions">
        <ContextMenuItem
          disabled={busy}
          onSelect={() => void run((allowed) => downloadChatImage(src, allowed))}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Download a copy
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            try {
              openChatImage(src);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Could not open the image.");
            }
          }}
        >
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          Open image in new tab
        </ContextMenuItem>
        <ContextMenuItem
          disabled={busy}
          onSelect={() =>
            void run(async (allowed) => {
              await copyChatImage(src, allowed);
              if (allowed()) toast.success("Image copied");
            })
          }
        >
          <Copy className="h-4 w-4" aria-hidden="true" />
          Copy image
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={busy || !actions}
          onSelect={() =>
            void run(async (allowed) => {
              if (!actions || !allowed()) return;
              const add = actions.prepareAdd();
              const file = await chatImageFile(src, allowed);
              if (allowed()) await add(file, allowed);
            })
          }
        >
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
          Add to chat
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => hide(true)}>
          <EyeOff className="h-4 w-4" aria-hidden="true" />
          Hide from chat
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
