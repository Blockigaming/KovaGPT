import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useState } from "react";

const SUPPORT_EMAIL = "zacharylblock@gmail.com";

export function HelpDialog({
  open,
  onOpenChange,
  variant = "help",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  variant?: "help" | "bug";
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState("");
  const [message, setMessage] = useState("");
  const isBug = variant === "bug";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    const subjectPrefix = isBug ? "KovaGPT bug report" : "KovaGPT help";
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const url = typeof window !== "undefined" ? window.location.href : "";
    const body = [
      `Name: ${name}`,
      `Email: ${email}`,
      `Topic: ${topic}`,
      "",
      isBug ? "Bug description:" : "Message:",
      message,
      "",
      `URL: ${url}`,
      `User agent: ${ua}`,
    ].join("\n");
    const href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
      `${subjectPrefix}: ${topic || "general"}`,
    )}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isBug ? "Report a bug" : "Help & contact"}</DialogTitle>
          <DialogDescription>
            {isBug
              ? "Tell us what went wrong. We'll include your browser info automatically."
              : "Send us a quick note and we'll reply by email."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3 text-sm">
          <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            type="email"
            required
            placeholder="Email address (required, so we can reply)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            placeholder={isBug ? "Short summary (e.g. page reloads on iPad)" : "What do you need help with?"}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
          <Textarea
            required
            placeholder={isBug ? "Steps to reproduce, what you expected, what actually happened" : "Describe the issue or question"}
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Send</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
