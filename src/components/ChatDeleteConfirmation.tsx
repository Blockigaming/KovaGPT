import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
let pending = false;
/** Shared styled confirmation for menu-originated permanent chat removal. */
export function confirmPermanentChat(title: string, temporary: boolean): Promise<boolean> {
  if (pending || typeof document === "undefined") return Promise.resolve(false);
  pending = true;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  return new Promise((resolve) => {
    function Prompt() {
      const [open, setOpen] = useState(true);
      const cancelRef = useRef<HTMLButtonElement | null>(null);
      const accepted = useRef(false);
      return (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogContent
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              cancelRef.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (opener?.isConnected) opener.focus();
              queueMicrotask(() => {
                root.unmount();
                host.remove();
                pending = false;
                resolve(accepted.current);
              });
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Delete chat permanently?</AlertDialogTitle>
              <AlertDialogDescription>
                “{title || "Untitled chat"}” will be permanently deleted.{" "}
                {temporary
                  ? "Temporary chats are not saved in Trash."
                  : "Trash retention is set to Instantly."}{" "}
                This cannot be undone. Drafts are kept.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel ref={cancelRef}>Cancel</AlertDialogCancel>
              <Button
                variant="destructive"
                onClick={() => {
                  accepted.current = true;
                  setOpen(false);
                }}
              >
                Delete permanently
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      );
    }
    root.render(<Prompt />);
  });
}
