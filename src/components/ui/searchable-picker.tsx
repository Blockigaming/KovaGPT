import { useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { Check, ChevronDown } from "./reference-icons";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "./command";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
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
            className="min-h-8 [@media(pointer:coarse)]:min-h-11"
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
  /** Radix placement for short lists; searchable lists use their existing popover. */
  position?: ComponentPropsWithoutRef<typeof SelectContent>["position"];
};

/** A themed select for short lists; add in-menu search above seven real choices. */
export function SearchablePicker({
  options,
  value,
  onValueChange,
  placeholder,
  searchLabel,
  emptyText,
  restoreFocusOnSelect = true,
  position = "popper",
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
      <Select
        dir={dir === "ltr" || dir === "rtl" ? dir : undefined}
        value={`option:${value}`}
        disabled={disabled}
        onOpenChange={(next) => {
          if (next) selectedOnClose.current = false;
        }}
        onValueChange={(next) => {
          const choice = choices.find((option) => `option:${option.value}` === next);
          if (!disabled && choice && !choice.disabled) {
            selectedOnClose.current = true;
            onValueChange(choice.value);
          }
        }}
      >
        <SelectTrigger {...fieldProps} dir={dir} className={className}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent
          dir={dir}
          position={position}
          onCloseAutoFocus={(event) => {
            if (selectedOnClose.current && !restoreFocusOnSelect) event.preventDefault();
          }}
        >
          {choices.map((option) => (
            <SelectItem
              key={option.value}
              value={`option:${option.value}`}
              disabled={option.disabled}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
          data-slot="select-trigger"
          data-ui-reference="chatgpt.select-control.searchable"
          {...fieldProps}
          dir={dir}
          type="button"
          disabled={disabled}
          className={cn(
            "font-[family-name:var(--font-ui)] flex h-9 min-w-0 items-center justify-between gap-2 rounded-[8px] border border-input bg-transparent px-3 text-left text-base font-medium md:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:min-h-11",
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
