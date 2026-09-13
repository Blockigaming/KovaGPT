import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { shareChat } from "@/lib/shared-chats.functions";
import type { Conversation } from "@/lib/chat-store";
import { useUser } from "@/components/auth/ClerkSafe";

export function ShareChatDialog({
  open,
  onOpenChange,
  conversation,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  conversation: Conversation | null;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const recipientEmailId = useId();
  const recipientHelpId = useId();
  const share = useServerFn(shareChat);
  const { user } = useUser();
  const myEmail = (user?.primaryEmailAddress?.emailAddress ?? "").trim().toLowerCase();

  const submit = async () => {
    if (!conversation) return;
    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error("Enter a valid email address.");
      return;
    }
    if (myEmail && trimmed === myEmail) {
      toast.error("You can't share a chat with yourself.");
      return;
    }

    setBusy(true);
    try {
      const messages = conversation.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content }));
      if (messages.length === 0) {
        toast.error("Nothing to share in this chat yet.");
        setBusy(false);
        return;
      }
      await share({
        data: {
          recipient_email: trimmed,
          title: conversation.title || "Shared chat",
          local_chat_reference: conversation.id,
          snapshot: { messages },
        },
      });
      toast.success("Chat shared. You can manage it in Library.");
      setEmail("");
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not share chat.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share chat</DialogTitle>
          <DialogDescription>
            Send a read-only snapshot of this conversation to another KovaGPT user.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="text-sm">
            <span className="text-muted-foreground">Chat:</span>{" "}
            <span className="font-medium">{conversation?.title ?? "Untitled"}</span>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={recipientEmailId} className="text-xs font-medium text-muted-foreground">
              Recipient email
            </label>
            <Input
              id={recipientEmailId}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="friend@example.com"
              autoFocus
              disabled={busy}
              aria-describedby={recipientHelpId}
            />
          </div>
          <p id={recipientHelpId} className="text-[11px] text-muted-foreground">
            The recipient needs a KovaGPT account using this email to view the chat. Sharing creates
            a view-only snapshot of the branch you are currently viewing — other branches are not
            included. Future replies in your chat won't update theirs. They can open the snapshot
            from Library.
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Sharing…" : "Share"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
