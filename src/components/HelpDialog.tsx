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
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Bug, Mail, MessageSquareText } from "lucide-react";
import { NovaLogo } from "@/components/NovaLogo";

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
      toast.success("Message sent. We'll reply by email shortly.");
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
      <DialogContent className="max-w-lg p-0 overflow-hidden">
        <div className="bg-gradient-to-br from-foreground/[0.04] to-transparent px-6 pt-6 pb-4 border-b border-border">
          <DialogHeader className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-foreground text-background flex items-center justify-center overflow-hidden">
                {isBug ? <Bug className="w-5 h-5" /> : <NovaLogo className="w-7 h-7" />}
              </div>
              <div className="flex-1">
                <DialogTitle className="text-lg">
                  {isBug ? "Report a bug" : "Help & contact"}
                </DialogTitle>
                <DialogDescription className="text-sm mt-0.5">
                  {isBug
                    ? "Tell us what went wrong and we'll take a look."
                    : "We read every message. Usually a reply within one business day."}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <form onSubmit={submit} className="px-6 py-5 space-y-4 text-sm">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="help-name" className="flex items-center justify-between text-xs font-medium">
                <span>Your name</span>
                <span className="text-muted-foreground font-normal">Optional</span>
              </Label>
              <Input
                id="help-name"
                placeholder="Jamie"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="help-email" className="text-xs font-medium">
                Email <span className="text-muted-foreground font-normal">(required)</span>
              </Label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  id="help-email"
                  type="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={254}
                  className="pl-8"
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="help-topic" className="text-xs font-medium">
              {isBug ? "Short summary" : "What's this about?"}
            </Label>
            <Input
              id="help-topic"
              placeholder={isBug ? "Voice mode keeps cutting out on iPad" : "Billing question, feedback, feature request..."}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="help-message" className="text-xs font-medium flex items-center gap-1.5">
              <MessageSquareText className="w-3.5 h-3.5" />
              {isBug ? "What happened?" : "Your message"}
            </Label>
            <Textarea
              id="help-message"
              required
              placeholder={
                isBug
                  ? "Steps to reproduce, what you expected, what actually happened. Screenshots welcome - paste a link."
                  : "Tell us as much or as little as you'd like."
              }
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={4000}
              className="resize-none"
            />
            <p className="text-[11px] text-muted-foreground">
              {message.length}/4000 characters
            </p>
          </div>

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

          <div className="flex items-center justify-between pt-1">
            <p className="text-[11px] text-muted-foreground">
              By sending, you agree to our reply at the email above.
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send message
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
