import { useEffect, useRef, useState } from "react";
import { Check, GitBranch, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useLayout } from "@/hooks/use-mobile";
import { MobileBottomSheet } from "@/components/MobileBottomSheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchablePickerList } from "@/components/ui/searchable-picker";
import type { BranchView } from "@/hooks/useChatBranches";

function branchName(branch: BranchView, index: number) {
  if (branch.label) return branch.label;
  if (branch.branchFromMessageIndex !== null) {
    return `Branch at message ${branch.branchFromMessageIndex + 1}`;
  }
  return `Branch ${index + 1}`;
}

/**
 * Active-branch control for a chat. Desktop uses a dropdown, phones and touch
 * tablets get a bottom sheet. Only branches that actually exist are listed; the
 * original path is always the implicit first entry and is never deleted by
 * branching.
 */
export function ChatBranchBar({
  branches,
  activeBranch,
  loading,
  error,
  onActivate,
  onRetry,
  durableHint,
}: {
  branches: BranchView[];
  activeBranch: BranchView | null;
  loading?: boolean;
  error?: string | null;
  onActivate: (branchId: string) => Promise<boolean>;
  onRetry?: () => void;
  /** Shown when branches are device-only (guest) rather than account-backed. */
  durableHint?: string;
}) {
  const { isMobile } = useLayout();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const [menuOpen, setMenuOpen] = useState(false);

  if (!loading && !error && branches.length === 0) return null;

  const label = activeBranch
    ? branchName(
        activeBranch,
        branches.findIndex((branch) => branch.id === activeBranch.id),
      )
    : "Original";

  const activate = async (branchId: string) => {
    if (busyRef.current || !branches.some((branch) => branch.id === branchId && !branch.active))
      return;
    busyRef.current = true;
    setBusy(true);
    try {
      const activated = await onActivate(branchId);
      if (!activated) return;
      // A successful activation may have unmounted this picker by navigating.
      toast.success("Switched branch");
      if (mountedRef.current) setSheetOpen(false);
    } catch (err) {
      if (!mountedRef.current) return;
      toast.error(err instanceof Error ? err.message : "That branch could not be activated.");
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  };

  const branchOptions = branches.map((branch, index) => ({
    value: branch.id,
    label: branchName(branch, index),
    disabled: branch.active,
    description: `${new Date(branch.createdAt).toLocaleString()}${branch.durable ? "" : " · this device only"}`,
  }));
  const selectedId = branches.find((branch) => branch.active)?.id ?? "";
  const searchable = branches.length > 7;
  const searchableRows = (onValueChange: (value: string) => void) => (
    <SearchablePickerList
      options={branchOptions}
      value={selectedId}
      disabled={busy}
      onValueChange={onValueChange}
      searchLabel="Search branches"
      emptyText="No branches found."
    />
  );
  const rows = (
    <ul
      className="spec400-branch-options flex flex-col py-1"
      role="listbox"
      aria-label="Chat branches"
      onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const choices = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            'button[role="option"]:not(:disabled)',
          ),
        );
        if (!choices.length) return;
        const current = choices.indexOf(event.target as HTMLButtonElement);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? choices.length - 1
              : (current + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length;
        event.preventDefault();
        choices[next]?.focus();
      }}
    >
      {branches.map((branch, index) => (
        <li key={branch.id}>
          <button
            type="button"
            role="option"
            aria-selected={branch.active}
            disabled={busy || branch.active}
            onClick={() => void activate(branch.id)}
            className="relative flex min-h-11 w-full flex-col items-start justify-center rounded-xl px-3 pr-9 text-left hover:bg-accent disabled:opacity-60"
          >
            <span className="text-sm font-medium">
              {branchName(branch, index)}
              {branch.active ? " · active" : ""}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(branch.createdAt).toLocaleString()}
              {branch.durable ? "" : " · this device only"}
            </span>
            {branch.active && <Check className="absolute right-3 h-4 w-4" aria-hidden="true" />}
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="mx-auto flex w-full max-w-[48rem] items-center gap-2 px-3 pt-2 lg:px-0">
      {isMobile ? (
        <>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-3 text-sm font-medium hover:bg-accent"
            aria-label={`Chat branch: ${label}. Change branch`}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <GitBranch className="h-3.5 w-3.5" />
            )}
            <span className="max-w-40 truncate">{label}</span>
          </button>
          <MobileBottomSheet open={sheetOpen} onOpenChange={setSheetOpen} title="Chat branches">
            {searchable ? searchableRows((id) => void activate(id)) : rows}
            {durableHint && (
              <p className="px-3 pb-2 text-xs text-muted-foreground">{durableHint}</p>
            )}
          </MobileBottomSheet>
        </>
      ) : searchable ? (
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-full border border-border px-3 text-sm font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Chat branch: ${label}. Change branch`}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <GitBranch className="h-3.5 w-3.5" />
              )}
              <span className="max-w-48 truncate">{label}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0">
            <p className="px-3 py-2 text-xs font-medium text-muted-foreground">
              Branches in this chat
            </p>
            {searchableRows((id) => {
              setMenuOpen(false);
              void activate(id);
            })}
            {durableHint && (
              <p className="border-t px-3 py-2 text-xs text-muted-foreground">{durableHint}</p>
            )}
          </PopoverContent>
        </Popover>
      ) : (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-full border border-border px-3 text-sm font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Chat branch: ${label}. Change branch`}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <GitBranch className="h-3.5 w-3.5" />
              )}
              <span className="max-w-48 truncate">{label}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel>Branches in this chat</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={selectedId} onValueChange={(id) => void activate(id)}>
              {branches.map((branch, index) => (
                <DropdownMenuRadioItem
                  key={branch.id}
                  value={branch.id}
                  disabled={busy || branch.active}
                  className="flex flex-col items-start gap-0.5"
                >
                  <span className="text-sm font-medium">
                    {branchName(branch, index)}
                    {branch.active ? " · active" : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(branch.createdAt).toLocaleString()}
                    {branch.durable ? "" : " · this device only"}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {durableHint && (
              <>
                <DropdownMenuSeparator />
                <p className="px-2 py-1.5 text-xs text-muted-foreground">{durableHint}</p>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {error && (
        <div className="flex items-center gap-2">
          <span role="alert" className="text-xs text-destructive">
            {error}
          </span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="text-xs font-medium underline hover:text-foreground"
            >
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}
