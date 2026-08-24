import { useState } from "react";
import { GitBranch, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useLayout } from "@/hooks/use-mobile";
import { MobileBottomSheet } from "@/components/MobileBottomSheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  onActivate: (branchId: string) => Promise<unknown>;
  onRetry?: () => void;
  /** Shown when branches are device-only (guest) rather than account-backed. */
  durableHint?: string;
}) {
  const { isMobile } = useLayout();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!loading && !error && branches.length === 0) return null;

  const label = activeBranch
    ? branchName(activeBranch, branches.indexOf(activeBranch))
    : "Original";

  const activate = async (branchId: string) => {
    setBusy(true);
    try {
      await onActivate(branchId);
      toast.success("Switched branch");
      setSheetOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That branch could not be activated.");
    } finally {
      setBusy(false);
    }
  };

  const rows = (
    <ul className="flex flex-col py-1" role="listbox" aria-label="Chat branches">
      {branches.map((branch, index) => (
        <li key={branch.id}>
          <button
            type="button"
            role="option"
            aria-selected={branch.active}
            disabled={busy || branch.active}
            onClick={() => void activate(branch.id)}
            className="flex min-h-11 w-full flex-col items-start justify-center rounded-xl px-3 text-left hover:bg-accent disabled:opacity-60"
          >
            <span className="text-sm font-medium">
              {branchName(branch, index)}
              {branch.active ? " · active" : ""}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(branch.createdAt).toLocaleString()}
              {branch.durable ? "" : " · this device only"}
            </span>
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
            {rows}
            {durableHint && (
              <p className="px-3 pb-2 text-xs text-muted-foreground">{durableHint}</p>
            )}
          </MobileBottomSheet>
        </>
      ) : (
        <DropdownMenu>
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
            {branches.map((branch, index) => (
              <DropdownMenuItem
                key={branch.id}
                disabled={busy || branch.active}
                onClick={() => void activate(branch.id)}
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
              </DropdownMenuItem>
            ))}
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
