import { useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "./command";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { cn } from "@/lib/utils";

export type PickerOption = {
  value: string;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
};

/** Shared searchable list: ids stay distinct even when visible labels repeat. */
export function SearchablePickerList({
  options,
  value,
  onValueChange,
  searchLabel,
  emptyText = "No options found.",
  disabled = false,
}: {
  options: PickerOption[];
  value: string;
  onValueChange: (value: string) => void;
  searchLabel: string;
  emptyText?: string;
  disabled?: boolean;
}) {
  return (
    <Command
      className="spec400-searchable-picker"
      label={searchLabel}
      defaultValue={`option:${value}`}
      loop
      filter={(_value, search, keywords) =>
        keywords?.some((label) =>
          label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
        )
          ? 1
          : 0
      }
    >
      <CommandInput placeholder={searchLabel} aria-label={searchLabel} autoFocus />
      <CommandList>
        <CommandEmpty>{emptyText}</CommandEmpty>
        {options.map((option) => (
          <CommandItem
            key={option.value}
            value={`option:${option.value}`}
            keywords={[option.label]}
            disabled={disabled || option.disabled}
            onSelect={() => {
              if (!disabled && !option.disabled) onValueChange(option.value);
            }}
            className="min-h-11"
          >
            <span className="min-w-0 flex-1">
              <span className="block break-words">{option.label}</span>
              {option.description && (
                <span className="block text-xs text-muted-foreground">{option.description}</span>
              )}
            </span>
            {option.value === value && (
              <>
                <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="sr-only">Selected</span>
              </>
            )}
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );
}

type PickerProps = Pick<
  ComponentPropsWithoutRef<"select">,
  | "id"
  | "aria-label"
  | "aria-labelledby"
  | "aria-describedby"
  | "aria-invalid"
  | "disabled"
  | "dir"
  | "className"
> & {
  options: PickerOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchLabel: string;
  emptyText?: string;
  /** Settings moves focus to its new section; Escape still returns to the trigger. */
  restoreFocusOnSelect?: boolean;
};

/** Keep short native selectors intact; add in-menu search above seven real choices. */
export function SearchablePicker({
  options,
  value,
  onValueChange,
  placeholder,
  searchLabel,
  emptyText,
  restoreFocusOnSelect = true,
  className,
  disabled,
  dir,
  ...fieldProps
}: PickerProps) {
  const [open, setOpen] = useState(false);
  const selectedOnClose = useRef(false);
  const choices =
    placeholder === undefined ? options : [{ value: "", label: placeholder }, ...options];
  if (options.length <= 7) {
    return (
      <select
        {...fieldProps}
        dir={dir}
        className={className}
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {choices.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  const selectedLabel =
    choices.find((option) => option.value === value)?.label ?? placeholder ?? "";
  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(next) => {
        if (next) selectedOnClose.current = false;
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          {...fieldProps}
          dir={dir}
          type="button"
          disabled={disabled}
          className={cn(
            "flex min-w-0 items-center justify-between gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
          <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        dir={dir}
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-56 p-0"
        onCloseAutoFocus={(event) => {
          if (selectedOnClose.current && !restoreFocusOnSelect) event.preventDefault();
        }}
      >
        <SearchablePickerList
          options={choices}
          value={value}
          searchLabel={searchLabel}
          emptyText={emptyText}
          disabled={disabled}
          onValueChange={(next) => {
            selectedOnClose.current = true;
            setOpen(false);
            onValueChange(next);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
