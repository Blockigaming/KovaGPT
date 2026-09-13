import { useEffect, useState } from "react";
import { Check, MessageSquareDashed, ShieldCheck, Sparkles } from "lucide-react";
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

export function TemporaryChatBanner({
  tempChatContext,
  canSave,
  isStreaming,
  onSave,
  onTurnOff,
}: {
  tempChatContext: TemporaryChatContext;
  canSave: boolean;
  isStreaming: boolean;
  onSave: () => void;
  onTurnOff: () => void;
}) {
  return (
    <div className="mx-auto mt-3 flex w-[calc(100%-2rem)] max-w-3xl items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm shadow-sm">
      <div className="flex min-w-0 items-center gap-2">
        <MessageSquareDashed className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span>
          {tempChatContext === "personalized"
            ? "Temporary chat is on with existing context. It is not saved to history and will not create new saved memories."
            : "Temporary chat is on. It is not saved to history and does not use or update saved memory, profile details, custom instructions, personality settings, or connected apps."}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {canSave ? (
          <button
            type="button"
            onClick={onSave}
            disabled={isStreaming}
            className="rounded-md px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save to history
          </button>
        ) : null}
        <button
          type="button"
          onClick={onTurnOff}
          className="rounded-md px-2.5 py-1 text-xs font-medium hover:bg-accent"
        >
          Turn off
        </button>
      </div>
    </div>
  );
}

export function TemporaryChatToggle({
  enabled,
  confirmed,
  onToggle,
}: {
  enabled: boolean;
  confirmed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={enabled ? "Turn off temporary chat" : "Start temporary chat"}
      aria-pressed={enabled}
      title={enabled ? "Temporary chat on" : "Start temporary chat"}
      className={`relative shrink-0 p-2 rounded-lg transition ${
        enabled ? "bg-primary/15 text-primary" : "hover:bg-accent text-foreground"
      }`}
    >
      <MessageSquareDashed className="w-5 h-5" />
      {confirmed && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Check className="w-4 h-4 text-primary drop-shadow" />
        </span>
      )}
    </button>
  );
}
