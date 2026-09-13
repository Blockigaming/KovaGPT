import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useUser, SignInButton } from "@/components/auth/ClerkSafe";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { pwaMessage, setPwaOwner } from "@/lib/pwa/client";
import {
  safeBrowserStorage,
  writePrincipalHandoff,
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
} from "@/lib/principal-browser-storage.mjs";
export const Route = createFileRoute("/share-inbox")({
  head: () => ({
    meta: [{ title: "Review shared text · KovaGPT" }, { name: "robots", content: "noindex" }],
  }),
  component: ShareInbox,
});
function ShareInbox() {
  const { isLoaded, isSignedIn, user } = useUser();
  const ownerId = isLoaded && isSignedIn ? (user?.id ?? null) : null;
  return (
    <AppShell>
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Review shared text</h1>
        {!isLoaded ? (
          <p>Loading your account…</p>
        ) : !ownerId ? (
          <p>
            Sign in to review this share. It expires after five minutes.{" "}
            <SignInButton>
              <button type="button" className="underline">
                Sign in
              </button>
            </SignInButton>
          </p>
        ) : (
          <OwnerShare key={ownerId} ownerId={ownerId} />
        )}
      </main>
    </AppShell>
  );
}
function OwnerShare({ ownerId }: { ownerId: string }) {
  const [value, setValue] = useState<{ title: string; text: string; url: string } | null>(null),
    [error, setError] = useState<string | null>(null);
  const active = useRef(true),
    busy = useRef(false);
  useEffect(() => {
    active.current = true;
    const controller = new AbortController(),
      ticket = new URL(window.location.href).searchParams.get("ticket");
    if (!ticket || !/^[a-f0-9-]{36}$/iu.test(ticket)) {
      setError("There is no pending share. Use Share from another app or paste text into chat.");
      return;
    }
    void setPwaOwner(ownerId)
      .then(() => {
        controller.signal.throwIfAborted();
        return pwaMessage({ type: "SHARE", ownerId, ticket }, controller.signal);
      })
      .then((result) => {
        if (!active.current || controller.signal.aborted) return;
        const item = result.value as { title: string; text: string; url: string };
        if (
          !item ||
          typeof item.title !== "string" ||
          typeof item.text !== "string" ||
          typeof item.url !== "string"
        )
          throw Error();
        setValue(item);
      })
      .catch(() => {
        if (active.current && !controller.signal.aborted)
          setError(
            "This share expired or is no longer available. Share it again from the original app.",
          );
      });
    const clear = (event: Event) => {
      if (isPrincipalBrowserStorageClearedEvent(event, ownerId)) {
        active.current = false;
        controller.abort();
        setValue(null);
        setError("The account changed. Share the text again when you are ready.");
      }
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, clear);
    return () => {
      active.current = false;
      controller.abort();
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, clear);
    };
  }, [ownerId]);
  const consume = () =>
    pwaMessage({
      type: "SHARE_CONSUME",
      ownerId,
      ticket: new URL(window.location.href).searchParams.get("ticket"),
    });
  const addToChat = async () => {
    if (!active.current || !value || busy.current) return;
    busy.current = true;
    try {
      await consume();
    } catch {
      setError("This share is no longer available. Share it again or copy the preview into chat.");
      busy.current = false;
      return;
    }
    if (!active.current) return;
    const prompt = [value.title, value.text, value.url].filter(Boolean).join("\n\n");
    const written = writePrincipalHandoff(
      safeBrowserStorage("sessionStorage"),
      "kova-prompt-launch",
      ownerId,
      { prompt },
    );
    if (!written.ok) {
      setError("The draft could not be saved. Copy the text and paste it into chat.");
      busy.current = false;
      return;
    }
    setValue(null);
    window.location.href = "/";
  };
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {!value && !error ? (
        <p>Loading the shared text…</p>
      ) : value ? (
        <>
          <p className="text-sm text-muted-foreground">
            Review this text before adding it to a chat. Nothing is sent to a model until you send
            the message.
          </p>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border p-4 text-sm">
            {[value.title, value.text, value.url].filter(Boolean).join("\n\n")}
          </pre>
          <div className="flex gap-2">
            <Button onClick={() => void addToChat()}>Use in chat</Button>
            <Button
              variant="outline"
              onClick={() => {
                void consume().catch(() => {});
                setValue(null);
                setError("Share discarded.");
              }}
            >
              Discard
            </Button>
          </div>
        </>
      ) : null}
    </>
  );
}
