import { useEffect, useState, type MouseEventHandler } from "react";
import { SignInButton } from "@/components/auth/ClerkSafe";
import { Button } from "@/components/ui/button";
import type { NextPrompt } from "@/lib/chat-send-next";
import { fetchForPrincipal } from "@/lib/chat-summary-snapshot.mjs";

export function ContinueChatPanel({
  ownerId,
  chatId,
  canUseMemory,
  draftProtected,
  onContinue,
  onDismiss,
}: {
  ownerId: string;
  chatId: string;
  canUseMemory: boolean;
  draftProtected: boolean;
  onContinue: (draft: string) => boolean;
  onDismiss: () => void;
}) {
  const [summary, setSummary] = useState("");
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    setSummary("");
    setBlocked(false);
    if (!canUseMemory) return;
    const request = new AbortController();
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
    void (async () => {
      try {
        const response = await fetchForPrincipal(
          ownerId,
          `/api/memory?continuationChatId=${encodeURIComponent(chatId)}`,
          { signal },
        );
        if (!response.ok || signal.aborted) return;
        const result = await response.json();
        if (!signal.aborted && typeof result?.summary === "string")
          setSummary(result.summary.trim().slice(0, 2000));
      } catch {
        // A saved summary is optional. The conversation limit still stands.
      }
    })();
    return () => request.abort();
  }, [ownerId, chatId, canUseMemory]);

  const available = canUseMemory && Boolean(summary);
  return (
    <section
      aria-label="Conversation limit"
      className="mx-3 mb-3 flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
      data-kova-notice-id={available ? "conversation_continue" : "conversation_full"}
    >
      <p role="status" className="grow">
        {available
          ? "This conversation is full. Continue in a new chat with an editable summary."
          : "This conversation is full. Start a new chat to continue."}
      </p>
      {available && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={draftProtected}
          onClick={() => {
            setBlocked(!onContinue(`Continue from this saved conversation summary:\n\n${summary}`));
          }}
        >
          Continue with summary
        </Button>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
        Dismiss
      </Button>
      {available && (blocked || draftProtected) && (
        <p className="basis-full text-xs text-muted-foreground">
          Keep or clear your drafts before continuing.
        </p>
      )}
    </section>
  );
}

export function ChatRequestStatus({
  signedIn,
  draftProtected,
  canSignIn,
}: {
  signedIn: boolean;
  draftProtected: boolean;
  canSignIn: () => boolean;
}) {
  return (
    <section
      className="mx-3 mb-3 flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
      role="status"
      data-testid="chat-request-status"
    >
      <>
        <p>
          {signedIn
            ? "Your session could not be verified. Sign in again to continue."
            : "Sign in is required for this request."}{" "}
          Signing in does not resend a message. It may change the current account.
        </p>
        {draftProtected && (
          <p>
            Save or copy your current message and attachments, then clear them before signing in.
            Cancel or save any next message too. Drafts are not transferred between accounts.
          </p>
        )}
        <SignInButton mode="modal">
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={draftProtected}
            onClick={(event) => {
              if (!canSignIn()) event.preventDefault();
            }}
          >
            Sign in
          </Button>
        </SignInButton>
      </>
    </section>
  );
}

export function NextPromptPanel({
  prompt,
  inCurrentChat,
  canEdit,
  onCancel,
  onEdit,
  onOpenOriginal,
}: {
  prompt: NextPrompt;
  inCurrentChat: boolean;
  canEdit: boolean;
  onCancel: MouseEventHandler<HTMLButtonElement>;
  onEdit: () => void;
  onOpenOriginal: () => void;
}) {
  return (
    <section
      aria-label="Next message"
      className="mx-3 mb-3 space-y-2 rounded-lg border p-3 text-sm"
      data-testid="next-prompt-panel"
    >
      <p role="status" className="font-medium">
        {prompt.status === "held" ? "Next message kept, not queued" : "Next message queued"}
      </p>
      <p className="whitespace-pre-wrap break-words max-h-32 overflow-auto">
        {prompt.text || "Attached material"}
      </p>
      {prompt.attachments.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {prompt.attachments.map((file) => file.name).join(", ")}
        </p>
      )}
      {prompt.tool && <p className="text-xs text-muted-foreground">Tool: {prompt.tool}</p>}
      <p className="text-xs text-muted-foreground">
        {prompt.reason ??
          "Only this version will be sent after the current response finishes. Later edits stay in your draft. Kept in this tab only."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          type="button"
          data-next-prompt-cancel
          onClick={onCancel}
        >
          Cancel next message
        </Button>
        {inCurrentChat ? (
          <Button variant="outline" size="sm" type="button" disabled={!canEdit} onClick={onEdit}>
            Edit next message
          </Button>
        ) : (
          <Button variant="outline" size="sm" type="button" onClick={onOpenOriginal}>
            Open original chat
          </Button>
        )}
      </div>
      {inCurrentChat && !canEdit && (
        <p className="text-xs text-muted-foreground">
          Keep or clear your newer draft before editing this saved version.
        </p>
      )}
    </section>
  );
}
