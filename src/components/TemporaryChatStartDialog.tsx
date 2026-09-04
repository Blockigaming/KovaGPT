import { useEffect, useState } from "react";
import { MessageSquareDashed, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { TemporaryChatContext } from "@/lib/chat-store";

export function TemporaryChatStartDialog({
  open,
  onOpenChange,
  onStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (context: TemporaryChatContext) => void;
}) {
  const [context, setContext] = useState<TemporaryChatContext>("clean");

  useEffect(() => {
    if (open) setContext("clean");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-muted p-2.5">
            <MessageSquareDashed className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <DialogTitle>Start a temporary chat</DialogTitle>
            <DialogDescription className="mt-1.5">
              This chat will not appear in history or create new saved memories. Choose its context
              once before the first message.
            </DialogDescription>
          </div>
        </div>

        <RadioGroup
          value={context}
          onValueChange={(value) => setContext(value as TemporaryChatContext)}
          aria-label="Temporary chat context"
          className="mt-5 gap-3"
        >
          <label
            htmlFor="temporary-context-clean"
            className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4 hover:bg-accent"
          >
            <RadioGroupItem id="temporary-context-clean" value="clean" className="mt-0.5" />
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Start fresh
              </span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                Do not use saved memory, profile details, custom instructions, personality, or
                connected Google apps.
              </span>
            </span>
          </label>

          <label
            htmlFor="temporary-context-personalized"
            className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4 hover:bg-accent"
          >
            <RadioGroupItem
              id="temporary-context-personalized"
              value="personalized"
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Use my existing context
              </span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                Use enabled personalization, existing saved memory, and connected Google apps.
                Nothing from this temporary chat will be added to memory.
              </span>
            </span>
          </label>
        </RadioGroup>

        <p className="text-xs text-muted-foreground">
          You cannot change this choice after the chat starts. You can save the chat to history
          later and continue it as a regular chat.
        </p>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onStart(context)}>Start temporary chat</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
