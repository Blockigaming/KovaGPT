import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUser } from "@/components/auth/ClerkSafe";
import { authFetch } from "@/lib/auth-fetch";
import { saveMessageVersion } from "@/lib/chat-workspace.functions";
import {
  applySelectionEdit,
  buildRewriteInstruction,
  describeRewriteFailure,
  MAX_EDIT_INSTRUCTION_CHARS,
  normalizeRewrite,
  selectionContext,
  validateSelectionRange,
} from "@/lib/selection-edit.mjs";
import { saveLocalVersion } from "@/lib/local-chat-workspace.mjs";
import { safeBrowserStorage } from "@/lib/principal-browser-storage.mjs";

export type SelectionTarget = {
  /** Full markdown source of the message being edited. */
  source: string;
  start: number;
  end: number;
};

/**
 * Rewrite one selected passage of an assistant answer.
 *
 * Truthfulness rules baked in here:
 *  - the prefix and suffix outside the selection are never touched;
 *  - a rewrite that would unbalance code fences is rejected, not applied;
 *  - "Saved to this chat" only appears after the server confirms the version;
 *    guests are told plainly that history stays on this device;
 *  - Temporary Chat never persists anything and says so.
 */
export function SelectionEditDialog({
  open,
  onOpenChange,
  target,
  chatId,
  messageId,
  temporary = false,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: SelectionTarget | null;
  chatId?: string | null;
  messageId?: string | null;
  temporary?: boolean;
  onApply: (nextContent: string) => void;
}) {
  const { isSignedIn } = useUser();
  const saveVersion = useServerFn(saveMessageVersion);
  const [instruction, setInstruction] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const range = useMemo(() => {
    if (!target) return null;
    try {
      return validateSelectionRange(target.source, target.start, target.end);
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "That selection is not valid.",
      } as const;
    }
  }, [target]);

  const invalid = range && "error" in range ? range.error : null;
  const selected = range && !("error" in range) ? range.selected : "";

  useEffect(() => {
    if (open) return;
    abortRef.current?.abort();
    abortRef.current = null;
    setInstruction("");
    setDraft(null);
    setBusy(false);
    setApplying(false);
    setError(null);
  }, [open]);

  const generate = useCallback(async () => {
    if (!target || invalid) return;
    if (!isSignedIn) {
      setError("Sign in to rewrite with Kova. You can still edit the passage by hand below.");
      return;
    }
    if (!instruction.trim()) {
      setError("Describe how the selected text should change.");
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setError(describeRewriteFailure(0));
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      const context = selectionContext(target.source, target.start, target.end);
      const response = await authFetch("/api/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: selected,
          action: "custom",
          instructions: buildRewriteInstruction(instruction, selected, context),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        let code: string | undefined;
        try {
          code = ((await response.json()) as { error?: string }).error;
        } catch {
          /* body may not be JSON */
        }
        setError(describeRewriteFailure(response.status, code));
        return;
      }
      const payload = (await response.json()) as { text?: string };
      const next = normalizeRewrite(payload.text ?? "", selected);
      if (!next) {
        setError("The rewrite came back empty, so nothing was changed.");
        return;
      }
      setDraft(next);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        err instanceof Error && err.name === "TypeError"
          ? describeRewriteFailure(0)
          : describeRewriteFailure(500),
      );
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  }, [instruction, invalid, isSignedIn, selected, target]);

  const accept = useCallback(async () => {
    if (!target || invalid || draft === null) return;
    let merged: string;
    try {
      merged = applySelectionEdit(target.source, target.start, target.end, draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That rewrite could not be applied.");
      return;
    }
    setApplying(true);
    setError(null);
    try {
      if (temporary) {
        onApply(merged);
        toast.message("Edit applied. Temporary chats keep no edit history.");
      } else if (isSignedIn && chatId && messageId) {
        await saveVersion({
          data: {
            chatId,
            messageId,
            source: "inline_edit",
            content: merged,
            originalContent: target.source,
            instruction: instruction.trim() || null,
            accepted: true,
          },
        });
        onApply(merged);
        toast.success("Edit saved to this chat");
      } else if (chatId && messageId) {
        saveLocalVersion(safeBrowserStorage("localStorage"), chatId, messageId, {
          content: merged,
          originalContent: target.source,
          instruction: instruction.trim() || null,
          source: "inline_edit",
        });
        onApply(merged);
        toast.message("Edit saved on this device only");
      } else {
        onApply(merged);
        toast.message("Edit applied to this response");
      }
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof Error && err.message ? err.message : "The edit could not be saved.";
      // Never close on failure: the user's rewrite must not silently vanish.
      setError(message);
    } finally {
      setApplying(false);
    }
  }, [
    chatId,
    draft,
    instruction,
    invalid,
    isSignedIn,
    messageId,
    onApply,
    onOpenChange,
    saveVersion,
    target,
    temporary,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Edit selection</DialogTitle>
          <DialogDescription>
            Only the selected passage changes. The rest of the response stays exactly as it is.
          </DialogDescription>
        </DialogHeader>

        {invalid ? (
          <p role="alert" className="text-sm text-destructive">
            {invalid}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Selected text</p>
              <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm font-sans">
                {selected}
              </pre>
            </div>

            <div>
              <label
                htmlFor="selection-edit-instruction"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                How should it change?
              </label>
              <textarea
                id="selection-edit-instruction"
                value={instruction}
                onChange={(event) =>
                  setInstruction(event.target.value.slice(0, MAX_EDIT_INSTRUCTION_CHARS))
                }
                rows={2}
                placeholder="Make it shorter and less formal"
                className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void generate()}
                disabled={busy || applying}
                aria-busy={busy}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {draft === null ? "Rewrite with Kova" : "Retry"}
              </button>
              {busy && (
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-medium hover:bg-accent"
                >
                  Stop
                </button>
              )}
              {draft !== null && !busy && (
                <button
                  type="button"
                  onClick={() => setDraft(null)}
                  className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-medium hover:bg-accent"
                >
                  Reject rewrite
                </button>
              )}
            </div>

            {draft !== null && (
              <div>
                <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Wand2 className="h-3.5 w-3.5" /> Replacement preview (editable)
                </p>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={Math.min(14, Math.max(4, draft.split("\n").length + 1))}
                  className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30"
                  aria-label="Replacement text"
                />
              </div>
            )}

            {draft === null && (
              <button
                type="button"
                onClick={() => setDraft(selected)}
                className="self-start text-xs font-medium text-muted-foreground underline hover:text-foreground"
              >
                Edit the passage by hand instead
              </button>
            )}

            <p className="text-xs text-muted-foreground">
              {temporary
                ? "Temporary chat: this edit applies to the visible response and is not saved to edit history."
                : isSignedIn
                  ? "Accepted edits are saved to this chat's version history."
                  : "Accepted edits are kept on this device only until you sign in."}
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-border px-4 text-sm font-medium hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void accept()}
            disabled={draft === null || applying || Boolean(invalid)}
            aria-busy={applying}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-foreground px-4 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50"
          >
            {applying && <Loader2 className="h-4 w-4 animate-spin" />}
            Accept edit
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
