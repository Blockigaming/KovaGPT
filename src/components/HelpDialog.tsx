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
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState("");
  const [message, setMessage] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    const body = [
      `Name: ${name}`,
      `Email: ${email}`,
      `Topic: ${topic}`,
      "",
      "Message:",
      message,
    ].join("\n");
    const href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
      `NovaGPT help: ${topic || "general"}`,
    )}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Help & contact</DialogTitle>
          <DialogDescription>
            Send us a quick note and we'll reply by email.
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
            placeholder="What do you need help with?"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
          <Textarea
            required
            placeholder="Describe the issue or question"
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
