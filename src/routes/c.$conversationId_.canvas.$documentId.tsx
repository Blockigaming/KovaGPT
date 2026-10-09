import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArtifactEditor } from "@/components/ArtifactEditor";
import { type ArtifactKind } from "@/components/artifact-utils";
import { SignInButton, useUser } from "@/components/auth/ClerkSafe";
import {
  collaborationRequest,
  parseCanvasSnapshot,
  type CanvasSnapshot,
} from "@/lib/collaboration";
import { CollaborationError } from "@/lib/collaboration-client.mjs";

export const Route = createFileRoute("/c/$conversationId_/canvas/$documentId")({
  component: CanvasPage,
  validateSearch: (search: Record<string, unknown>): { kind: ArtifactKind } => ({
    kind: search.kind === "website" || search.kind === "code" ? search.kind : "writing",
  }),
  head: () => ({ meta: [{ title: "Canvas · KovaGPT" }, { name: "robots", content: "noindex" }] }),
});

function CanvasPage() {
  const { conversationId, documentId } = Route.useParams();
  const { kind } = Route.useSearch();
  const navigate = useNavigate();
  const { isLoaded, isSignedIn, user } = useUser();
  const actor = user?.id ?? null;
  const key = JSON.stringify([actor, conversationId, documentId]);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    snapshot?: CanvasSnapshot;
    error?: boolean;
  } | null>(null);
  useEffect(() => {
    setResult(null);
    if (!isLoaded || !isSignedIn || !actor) return;
    const controller = new AbortController();
    void collaborationRequest(actor, "get", { documentId }, controller.signal)
      .then((value) => {
        const snapshot = parseCanvasSnapshot(value, actor);
        if (snapshot.document.id !== documentId || snapshot.document.chat_id !== conversationId)
          throw new CollaborationError("42501");
        if (!controller.signal.aborted) setResult({ key, snapshot });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({
            key,
            error: !(error instanceof CollaborationError && error.code === "42501"),
          });
      });
    return () => controller.abort();
  }, [key, actor, isLoaded, isSignedIn, conversationId, documentId, retry]);
  const visible = result?.key === key ? result : null;
  if (isLoaded && isSignedIn && visible?.snapshot) {
    const document = visible.snapshot.document;
    return (
      <ArtifactEditor
        open
        presentation="page"
        documentId={documentId}
        initialContent={document.content}
        kind={kind}
        chatId={document.chat_id}
        messageId={document.message_id}
        onClose={() => {
          void navigate({ to: "/c/$conversationId", params: { conversationId } });
        }}
      />
    );
  }
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto flex min-h-[100dvh] max-w-xl flex-col justify-center px-6 py-12"
    >
      {!isLoaded ? (
        <p role="status">Loading account…</p>
      ) : !isSignedIn || !actor ? (
        <>
          <h1 className="text-2xl font-semibold">Sign in to open Canvas</h1>
          <SignInButton mode="modal">
            <button
              type="button"
              className="mt-6 min-h-11 self-start rounded-xl bg-foreground px-5 text-background"
            >
              Sign in
            </button>
          </SignInButton>
        </>
      ) : !visible ? (
        <p role="status">Loading Canvas…</p>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">
            {visible.error ? "Canvas couldn't load" : "Canvas unavailable"}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {visible.error
              ? "Check your connection and retry."
              : "This document may have been removed, or this account may not have access."}
          </p>
          {visible.error && (
            <button
              type="button"
              onClick={() => setRetry((n) => n + 1)}
              className="mt-5 min-h-11 self-start rounded-xl border px-5"
            >
              Retry
            </button>
          )}
        </>
      )}
      <Link
        to="/c/$conversationId"
        params={{ conversationId }}
        className="mt-6 inline-flex min-h-11 items-center text-sm underline"
      >
        Back to chat
      </Link>
    </main>
  );
}
