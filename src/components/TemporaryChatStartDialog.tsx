import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import { useEffect, useRef, useState } from "react";
import { Check, MessageCircleOff, ShieldCheck, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { TemporaryChatContext } from "@/lib/chat-store";

export function TemporaryChatStartDialog({
  open,
  onOpenChange,
  onStart,
  returnFocusTarget,
  returnFocusUrl,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (context: TemporaryChatContext) => void;
  returnFocusTarget?: HTMLElement | null;
  returnFocusUrl?: string;
}) {
  const startedRef = useRef(false);
  const [context, setContext] = useState<TemporaryChatContext>("clean");

  useEffect(() => {
    if (open) {
      setContext("clean");
      startedRef.current = false;
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-ui-reference="chatgpt.temporary-chat.dialogcontent"
        className="sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreDialogFocus(returnFocusTarget, returnFocusUrl, startedRef.current);
        }}
      >
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-muted p-2.5">
            <MessageCircleOff className="h-5 w-5" aria-hidden="true" />
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
          data-ui-reference="chatgpt.temporary-chat.radiogroup"
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
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
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
                <BookOpen className="h-5 w-5" aria-hidden="true" />
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
          Temporary mode and context stay fixed after your first message. Start a new chat to change
          them.
        </p>

        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            data-ui-reference="chatgpt.temporary-chat.action"
            className="kova-workspace-action"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            data-ui-reference="chatgpt.temporary-chat.action"
            className="kova-workspace-action"
            onClick={() => {
              startedRef.current = true;
              onStart(context);
            }}
          >
            Start temporary chat
          </Button>
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
    <div className="kova-temporary-banner mx-auto mt-3 flex w-[calc(100%-2rem)] max-w-3xl items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm shadow-sm">
      <details>
        <summary>Temporary chat · not saved to history</summary>
        <p>
          {tempChatContext === "personalized"
            ? "Temporary chat is on with existing context. It is not saved to history and will not create new saved memories."
            : "Temporary chat is on. It is not saved to history and does not use or update saved memory, profile details, custom instructions, personality settings, or connected apps."}
        </p>
        <p>
          You can change this setting before your first message. After that, start a new chat to
          change it.
        </p>
      </details>
      <div className="flex shrink-0 items-center gap-1">
        {canSave ? (
          <Button
            data-ui-reference="chatgpt.temporary-chat.action"
            variant="ghost"
            type="button"
            onClick={onSave}
            disabled={isStreaming}
            className=" px-2.5  text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save to history
          </Button>
        ) : null}
        <Button
          data-ui-reference="chatgpt.temporary-chat.action"
          variant="ghost"
          type="button"
          onClick={onTurnOff}
          className=" px-2.5  text-xs font-medium hover:bg-accent"
        >
          Turn off
        </Button>
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
  onToggle: (trigger: HTMLButtonElement) => void;
}) {
  return (
    <Button
      size="icon"
      data-ui-reference="chatgpt.temporary-chat.action"
      variant="ghost"
      type="button"
      onClick={(event) => onToggle(event.currentTarget)}
      aria-label={enabled ? "Turn off temporary chat" : "Start temporary chat"}
      aria-pressed={enabled}
      title={enabled ? "Temporary chat on" : "Start temporary chat"}
      className={`relative   shrink-0   transition ${
        enabled ? "bg-primary/15 text-primary" : "hover:bg-accent text-foreground"
      }`}
    >
      <MessageCircleOff className="w-5 h-5" aria-hidden="true" />
      {confirmed && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Check className="w-4 h-4 text-primary drop-shadow" />
        </span>
      )}
    </Button>
  );
}
