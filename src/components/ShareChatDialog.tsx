import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Copy, Check, Link2, Loader2, Mail, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useUser } from "@/components/auth/ClerkSafe";
import type { Conversation } from "@/lib/chat-store";
import { publicShareSnapshot, type PublicChatSnapshot } from "@/lib/public-chat-share-policy.mjs";
import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";
const EmailShare = lazy(() =>
  import("./EmailShareChatDialog").then((m) => ({ default: m.EmailShareChatDialog })),
);

export function ShareChatDialog({
  open,
  onOpenChange,
  conversation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: Conversation | null;
}) {
  const { user, isLoaded, isSignedIn } = useUser();
  const owner = isLoaded && isSignedIn ? user?.id : null;
  const identity = `${owner ?? ""}:${conversation?.id ?? ""}:${open}`;
  const lifetime = useRef({ identity, epoch: 0 });
  if (lifetime.current.identity !== identity)
    lifetime.current = { identity, epoch: lifetime.current.epoch + 1 };
  const scope = `${identity}:${lifetime.current.epoch}`;
  const current = useRef(scope);
  current.current = scope;
  const operation = useRef<AbortController | null>(null);
  const [readyScope, setReadyScope] = useState("");
  const [preview, setPreview] = useState<PublicChatSnapshot | null>(null);
  const [link, setLink] = useState<{ id: string; url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  const [emailOpen, setEmailOpen] = useState(false);
  useEffect(() => {
    setReadyScope(scope);
    operation.current?.abort();
    setPreview(null);
    setLink(null);
    setBusy(false);
    setCopied(false);
    setError("");
    setEmailOpen(false);
    if (open && owner && conversation) {
      try {
        setPreview(publicShareSnapshot(conversation));
      } catch (error) {
        setError(error instanceof Error ? error.message : "This chat cannot be shared.");
      }
    }
    return () => operation.current?.abort();
    // A snapshot stays fixed while this dialog is open, even if new messages arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  async function copyLink() {
    if (!preview || !owner || busy || readyScope !== scope) return;
    const expected = scope,
      controller = new AbortController();
    operation.current?.abort();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      let created = link;
      if (!created) {
        const response = await fetchWithTimeoutAuthenticated("/api/chat-share", {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json", "X-Kova-Owner": owner },
          body: JSON.stringify({ title: preview.title, messages: preview.snapshot.messages }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "The link could not be created.");
        if (
          typeof data.path !== "string" ||
          !/^\/share\/[0-9a-f]{64}$/u.test(data.path) ||
          typeof data.id !== "string"
        )
          throw new Error("The share service returned an invalid link.");
        created = {
          id: data.id,
          url: new URL(data.path, window.location.origin).href,
          expiresAt: data.expiresAt,
        };
        if (current.current !== expected || controller.signal.aborted) return;
        setLink(created);
      }
      if (current.current !== expected || controller.signal.aborted) return;
      await navigator.clipboard.writeText(created.url);
      if (current.current !== expected || controller.signal.aborted) return;
      setCopied(true);
      toast.success("Link copied to clipboard", {
        className: "kova-share-success",
        icon: <Check aria-hidden="true" />,
      });
    } catch (error) {
      if (current.current === expected && !controller.signal.aborted)
        setError(
          error instanceof Error ? error.message : "Copy failed. Select and copy the link below.",
        );
    } finally {
      if (
        current.current === expected &&
        operation.current === controller &&
        !controller.signal.aborted
      )
        setBusy(false);
    }
  }
  async function revoke() {
    if (!link || !owner || busy || readyScope !== scope) return;
    const expected = scope;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      const response = await fetchWithTimeoutAuthenticated("/api/chat-share", {
        method: "DELETE",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-Kova-Owner": owner },
        body: JSON.stringify({ id: link.id }),
      });
      if (!response.ok) throw new Error("This link could not be revoked. Try again.");
      if (current.current !== expected || controller.signal.aborted) return;
      setLink(null);
      setCopied(false);
      toast.success("Share link removed");
    } catch (error) {
      if (current.current === expected && !controller.signal.aborted)
        setError(error instanceof Error ? error.message : "Try again.");
    } finally {
      if (
        current.current === expected &&
        operation.current === controller &&
        !controller.signal.aborted
      )
        setBusy(false);
    }
  }
  return (
    <>
      <Dialog open={open && !emailOpen} onOpenChange={onOpenChange}>
        <DialogContent className="kova-share-dialog">
          <DialogHeader>
            <div className="kova-share-symbol">
              <Link2 aria-hidden="true" />
            </div>
            <DialogTitle>Share this conversation</DialogTitle>
            <DialogDescription>
              Anyone with the link can read this text snapshot. It expires after 30 days. Files,
              private tool details, and future messages are excluded.
            </DialogDescription>
          </DialogHeader>
          {preview && readyScope === scope ? (
            <div className="kova-share-preview">
              <strong>{preview.title}</strong>
              <span>{preview.snapshot.messages.length} messages</span>
              <details>
                <summary>Review what will be shared</summary>
                {preview.snapshot.messages.map((m, i) => (
                  <article key={i}>
                    <small>{m.role === "user" ? "You" : "KovaGPT"}</small>
                    <p>{m.content}</p>
                  </article>
                ))}
              </details>
            </div>
          ) : null}
          {link && readyScope === scope ? (
            <label className="kova-share-link">
              Share link
              <input
                aria-label="Share link"
                readOnly
                value={link.url}
                onFocus={(e) => e.currentTarget.select()}
              />
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button
            type="button"
            className="kova-share-copy"
            disabled={!preview || !owner || busy || readyScope !== scope}
            onClick={() => void copyLink()}
          >
            {busy ? (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            ) : copied ? (
              <Check aria-hidden />
            ) : (
              <Copy aria-hidden />
            )}
            {copied ? "Copy link again" : "Create & copy link"}
          </Button>
          <div className="kova-share-secondary">
            <button type="button" disabled={busy || !owner} onClick={() => setEmailOpen(true)}>
              <Mail aria-hidden />
              Invite by email
            </button>
            {link ? (
              <button type="button" disabled={busy} onClick={() => void revoke()}>
                <Trash2 aria-hidden />
                Remove link
              </button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      {open && emailOpen && readyScope === scope ? (
        <Suspense fallback={null}>
          <EmailShare
            open
            onOpenChange={(next) => {
              setEmailOpen(next);
              if (!next) onOpenChange(false);
            }}
            conversation={conversation}
          />
        </Suspense>
      ) : null}
    </>
  );
}
