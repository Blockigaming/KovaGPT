import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export function BrowserInteractionCard({
  interaction,
  disabled,
  onAllow,
  onDeny,
}: {
  interaction: { kind: "popup" | "dialog"; origin: string; message: string; prompt?: boolean };
  disabled: boolean;
  onAllow: (text?: string) => void;
  onDeny: () => void;
}) {
  const [text, setText] = useState("");
  const inputId = useId();
  return (
    <form
      className="overflow-hidden rounded-3xl border bg-muted/40"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled) return;
        const response = text;
        setText("");
        onAllow(interaction.prompt ? response : undefined);
      }}
    >
      <div className="space-y-3 p-5">
        <p className="break-all text-sm text-muted-foreground">{interaction.origin}</p>
        <h4 className="text-lg font-medium">
          {interaction.kind === "popup" ? "Allow this popup?" : "This website needs your response"}
        </h4>
        <p className="whitespace-pre-wrap break-words text-sm">{interaction.message}</p>
        <p className="text-xs text-muted-foreground">
          This request comes from the website. Check it before continuing. Approval applies once.
        </p>
        {interaction.prompt && (
          <>
            <label className="block text-sm" htmlFor={inputId}>
              Private response
            </label>
            <Input
              id={inputId}
              type="password"
              autoComplete="off"
              maxLength={4000}
              disabled={disabled}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Your response goes to this website, outside the conversation.
            </p>
          </>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t p-4">
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          onClick={() => {
            setText("");
            onDeny();
          }}
        >
          Not now
        </Button>
        <Button type="submit" className="rounded-full" disabled={disabled}>
          {interaction.kind === "popup" ? "Open popup once" : "Continue once"}
        </Button>
      </div>
    </form>
  );
}
