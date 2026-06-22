import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Link } from "@tanstack/react-router";
import { Keyboard, MessageCircleQuestion, Sparkles, ShieldCheck, Mic, Image as ImageIcon, Globe2 } from "lucide-react";

export function HelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Help & tips</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 text-sm">
          <Section icon={<Sparkles className="w-4 h-4" />} title="Getting started">
            Ask anything in the message box. NovaGPT can write, brainstorm, code,
            translate, explain, and more. Switch <strong>Mode</strong> to "Reason"
            for harder problems.
          </Section>

          <Section icon={<ImageIcon className="w-4 h-4" />} title="Generate images">
            Say "generate an image of…", "draw…", "create a picture of…" and
            NovaGPT will produce an image instead of text.
          </Section>

          <Section icon={<Mic className="w-4 h-4" />} title="Voice mode">
            Tap the <strong>Voice</strong> button in the header. Just talk  - 
            NovaGPT replies out loud. Start speaking again to interrupt.
          </Section>

          <Section icon={<Globe2 className="w-4 h-4" />} title="Live web search">
            Turn on <strong>Live web search</strong> in Settings → General to
            have NovaGPT fetch fresh results from the web before answering
            time-sensitive questions.
          </Section>

          <Section icon={<ShieldCheck className="w-4 h-4" />} title="Privacy & security">
            Manage password, 2FA, and active sessions in Settings → Security.
            You can clear all conversations from Settings → General.
          </Section>

          <Section icon={<Keyboard className="w-4 h-4" />} title="Keyboard shortcuts">
            <ul className="mt-1 space-y-1 text-muted-foreground">
              <li><kbd className="px-1.5 py-0.5 rounded border text-xs">Enter</kbd>  -  send message</li>
              <li><kbd className="px-1.5 py-0.5 rounded border text-xs">Shift</kbd> + <kbd className="px-1.5 py-0.5 rounded border text-xs">Enter</kbd>  -  new line</li>
              <li><kbd className="px-1.5 py-0.5 rounded border text-xs">Esc</kbd>  -  close dialogs</li>
            </ul>
          </Section>

          <Section icon={<MessageCircleQuestion className="w-4 h-4" />} title="Plans & billing">
            See plans and upgrade on the{" "}
            <Link to="/pricing" className="underline" onClick={() => onOpenChange(false)}>
              pricing page
            </Link>
            . Manage payment methods and billing address in Settings → Billing.
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 font-medium mb-1">
        {icon}
        {title}
      </div>
      <div className="text-muted-foreground text-sm">{children}</div>
    </div>
  );
}
