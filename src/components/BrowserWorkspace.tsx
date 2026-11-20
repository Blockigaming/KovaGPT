import * as Dialog from "@radix-ui/react-dialog";
import { useLayoutEffect, type ReactNode } from "react";
import { X } from "@/components/ui/reference-icons";
import "./browser-workspace.css";

export function BrowserWorkspace({
  title,
  description,
  actions,
  overlayHeader = false,
  children,
  onClose,
  onCloseAutoFocus,
  onEscapeKeyDown,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  overlayHeader?: boolean;
  children: ReactNode;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
}) {
  const host =
    typeof document === "undefined" ? null : document.getElementById("kova-browser-workspace");
  useLayoutEffect(() => {
    const workspace = host?.parentElement;
    if (!workspace) return;
    const background = Array.from(workspace.children).filter(
      (node): node is HTMLElement =>
        node instanceof HTMLElement &&
        node !== host &&
        !node.inert &&
        !node.matches('[data-ui-reference="chatgpt-mobile-topbar"]'),
    );
    for (const node of background) node.inert = true;
    return () => {
      for (const node of background) node.inert = false;
    };
  }, [host]);
  if (!host) return null;
  return (
    <Dialog.Root
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal container={host}>
        <Dialog.Content
          className="kova-browser-workspace"
          data-overlay-header={overlayHeader || undefined}
          {...(!description ? { "aria-describedby": undefined } : {})}
          onInteractOutside={(event) => event.preventDefault()}
          onCloseAutoFocus={onCloseAutoFocus}
          onEscapeKeyDown={onEscapeKeyDown}
        >
          <header
            className="kova-browser-workspace-header"
            data-overlay={overlayHeader || undefined}
          >
            <div className="kova-browser-workspace-title min-w-0">
              <Dialog.Title>{title}</Dialog.Title>
              {description && <Dialog.Description>{description}</Dialog.Description>}
            </div>
            <div className="kova-browser-workspace-actions">
              {actions}
              <Dialog.Close
                type="button"
                className="kova-browser-workspace-close"
                aria-label="Close browser workspace"
              >
                <X aria-hidden="true" />
              </Dialog.Close>
            </div>
          </header>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
