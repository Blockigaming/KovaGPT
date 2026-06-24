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
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

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
  const [website, setWebsite] = useState(""); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const isBug = variant === "bug";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !message.trim()) {
      toast.error("Please add your email and a short message.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/public/help-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          topic,
          message,
          variant,
          website,
          url: typeof window !== "undefined" ? window.location.href : "",
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error || "Something went wrong. Please try again.");
        return;
      }
      toast.success("Message sent! We'll be in touch by email shortly.");
      setName("");
      setEmail("");
      setTopic("");
      setMessage("");
      onOpenChange(false);
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isBug ? "Report a bug" : "Help & contact"}</DialogTitle>
          <DialogDescription>
            {isBug
              ? "Tell us what went wrong. We'll include your browser info automatically and reply by email."
              : "Send us a quick note and we'll reply by email - usually within one business day."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3 text-sm">
          <Input
            placeholder="Your name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
          />
          <Input
            type="email"
            required
            placeholder="Email address (required, so we can reply)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
          />
          <Input
            placeholder={isBug ? "Short summary (e.g. page reloads on iPad)" : "What do you need help with?"}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            maxLength={200}
          />
          <Textarea
            required
            placeholder={isBug ? "Steps to reproduce, what you expected, what actually happened" : "Describe the issue or question"}
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={4000}
          />
          {/* Honeypot field - hidden from humans */}
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
            aria-hidden="true"
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
