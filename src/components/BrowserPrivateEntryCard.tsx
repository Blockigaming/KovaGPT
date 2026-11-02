import { useId, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
export function BrowserPrivateEntryCard({
  origin,
  label,
  disabled,
  onFill,
  onCancel,
}: {
  origin: string;
  label: string;
  disabled: boolean;
  onFill: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const inputId = useId();
  return (
    <form
      className="overflow-hidden rounded-3xl border bg-muted/40"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && value) {
          const entry = value;
          setValue("");
          onFill(entry);
        }
      }}
    >
      <div className="space-y-3 p-5">
        <p className="flex items-center gap-2 break-all text-sm text-muted-foreground">
          <LockKeyhole className="size-4 shrink-0" />
          {origin}
        </p>
        <h4 className="text-lg font-medium">Sign in privately</h4>
        <p className="text-sm text-muted-foreground">
          You have control. Enter your password for this website. It is sent to the private browser,
          outside the conversation.
        </p>
        <label htmlFor={inputId} className="block text-sm">
          {label || "Password"}
        </label>
        <Input
          id={inputId}
          type="password"
          autoComplete="off"
          value={value}
          maxLength={4000}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t p-4">
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          onClick={() => {
            setValue("");
            onCancel();
          }}
        >
          Not now
        </Button>
        <Button type="submit" className="rounded-full" disabled={disabled || !value}>
          Fill password
        </Button>
      </div>
    </form>
  );
}
