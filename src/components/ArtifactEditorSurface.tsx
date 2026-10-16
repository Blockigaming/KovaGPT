import { useRef, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";

/** The editor state stays in its session; only dialog presentation leaves message containment. */
export function ArtifactEditorSurface({
  presentation,
  label,
  onRequestClose,
  onEscape,
  children,
}: {
  presentation: "dialog" | "page";
  label: string;
  onRequestClose: () => void;
  onEscape?: () => void;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const invokerRef = useRef<HTMLElement | null>(null);
  const openedUrlRef = useRef<string | undefined>(undefined);

  if (presentation === "page") {
    return (
      <div className="flex h-[100dvh] w-full overflow-hidden">
        <div
          className="bg-background flex h-full w-full min-w-0 flex-col overflow-y-auto md:overflow-hidden"
          onClick={(event) => event.stopPropagation()}
          role="main"
          id="main-content"
          tabIndex={-1}
          aria-label={`${label} editor`}
        >
          {children}
        </div>
      </div>
    );
  }

  return (
    <DialogPrimitive.Root open modal onOpenChange={(next) => !next && onRequestClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          onClick={(event) => event.stopPropagation()}
          className="kova-artifact-overlay fixed inset-0 z-[100] flex items-stretch justify-center bg-black/50 p-0 sm:items-center sm:p-4"
        >
          <DialogPrimitive.Content
            ref={contentRef}
            className="kova-artifact-dialog bg-background flex h-full min-w-0 w-full flex-col overflow-y-auto border border-border shadow-xl sm:h-[90dvh] sm:max-w-6xl sm:rounded-xl md:overflow-hidden"
            aria-modal="true"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              invokerRef.current =
                document.activeElement instanceof HTMLElement ? document.activeElement : null;
              openedUrlRef.current = window.location.href;
              contentRef.current?.focus({ preventScroll: true });
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              restoreDialogFocus(invokerRef.current, openedUrlRef.current);
            }}
            onEscapeKeyDown={(event) => {
              event.preventDefault();
              (onEscape ?? onRequestClose)();
            }}
            onPointerDownOutside={(event) => {
              event.preventDefault();
              const pointer = event.detail.originalEvent;
              if (pointer.button === 0 && !pointer.ctrlKey) onRequestClose();
            }}
          >
            <DialogPrimitive.Title className="sr-only">{label} editor</DialogPrimitive.Title>
            {children}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
