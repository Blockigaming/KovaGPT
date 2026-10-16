import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import type { ChatRuleDraft } from "@/lib/use-chat-rule-drafts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Pin, PinOff, Sliders } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUser } from "@/components/auth/ClerkSafe";
import {
  getChatCustomRules,
  listChatPinnedFiles,
  pinChatFile,
  resetChatCustomRules,
  saveChatCustomRules,
  unpinChatFile,
  type ChatPinnedFileDto,
} from "@/lib/chat-workspace.functions";
import { listLibraryPage } from "@/lib/library-items-client";
import { clearLocalRules, localRules, saveLocalRules } from "@/lib/local-chat-workspace.mjs";
import { safeBrowserStorage } from "@/lib/principal-browser-storage.mjs";
import { describePinStatus, MAX_RULES_LENGTH } from "@/lib/chat-workspace-contract.mjs";

type Tab = "rules" | "files";

type LibraryChoice = { id: string; title: string };

/**
 * Per-chat rules and pinned files.
 *
 * Rules are applied server-side during prompt assembly (global custom
 * instructions -> project instructions -> these rules, highest priority), so
 * nothing here is a client-only illusion. Guests get a bounded on-device
 * fallback for rules and are told pins need an account. Temporary Chat never
 * persists either.
 */
type ChatWorkspaceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatId: string | null;
  temporary?: boolean;
  onRulesActiveChange?: (active: boolean) => void;
  returnFocusTarget?: HTMLElement | null;
  returnFocusUrl?: string;
  initialRulesDraft?: ChatRuleDraft | null;
  onRulesDraftChange?: (draft: ChatRuleDraft | null) => void;
};
export function ChatWorkspaceDialog(props: ChatWorkspaceDialogProps) {
  const { user, isSignedIn } = useUser();
  return (
    <ChatWorkspaceDialogContent
      key={`${user?.id ?? (isSignedIn ? "pending" : "guest")}:${props.chatId}:${Boolean(props.temporary)}:${props.open}`}
      {...props}
    />
  );
}
function ChatWorkspaceDialogContent({
  open,
  onOpenChange,
  chatId,
  temporary = false,
  onRulesActiveChange,
  returnFocusTarget,
  returnFocusUrl,
  initialRulesDraft = null,
  onRulesDraftChange,
}: ChatWorkspaceDialogProps) {
  const active = useRef(true);
  const rulesActiveCallback = useRef(onRulesActiveChange);
  rulesActiveCallback.current = onRulesActiveChange;
  const draftCallback = useRef(onRulesDraftChange);
  draftCallback.current = onRulesDraftChange;
  const draftRef = useRef<ChatRuleDraft | null>(temporary ? null : initialRulesDraft);
  const editRevision = useRef(0);
  const rulesPending = useRef(false);
  const rulesReadPending = useRef(false);
  const rulesRevision = useRef<string | null | undefined>(undefined);
  const [rulesKnown, setRulesKnown] = useState(false);
  const [reviewedRules, setReviewedRules] = useState<ChatRuleDraft | null>(null);
  const pinPending = useRef(false);
  const pinsReadPending = useRef(false);
  const pinsReadSequence = useRef(0);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const { isSignedIn, user } = useUser();
  const [tab, setTab] = useState<Tab>("rules");

  const getRules = useServerFn(getChatCustomRules);
  const saveRules = useServerFn(saveChatCustomRules);
  const resetRules = useServerFn(resetChatCustomRules);
  const listPins = useServerFn(listChatPinnedFiles);
  const pinFile = useServerFn(pinChatFile);
  const unpinFile = useServerFn(unpinChatFile);
  const libraryRead = useRef(0);
  const libraryAbort = useRef<AbortController | null>(null);

  const [instructions, setInstructions] = useState(draftRef.current?.instructions ?? "");
  const [enabled, setEnabled] = useState(draftRef.current?.enabled ?? true);
  const [hasDraft, setHasDraft] = useState(Boolean(draftRef.current));
  const rememberDraft = (value: ChatRuleDraft) => {
    editRevision.current += 1;
    setInstructions(value.instructions);
    setEnabled(value.enabled);
    if (!temporary) {
      draftRef.current = value;
      setHasDraft(true);
      draftCallback.current?.(value);
    }
  };
  const adoptSaved = useCallback((value: ChatRuleDraft) => {
    const draft = draftRef.current;
    if (draft && (draft.instructions !== value.instructions || draft.enabled !== value.enabled))
      return;
    draftRef.current = null;
    setHasDraft(false);
    draftCallback.current?.(null);
    setInstructions(value.instructions);
    setEnabled(value.enabled);
  }, []);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pins, setPins] = useState<ChatPinnedFileDto[]>([]);
  const [library, setLibrary] = useState<LibraryChoice[]>([]);
  const [pinBusy, setPinBusy] = useState<string | null>(null);
  const [libraryCursor, setLibraryCursor] = useState<Record<string, unknown> | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [pinsKnown, setPinsKnown] = useState(false);
  const [pinsLoading, setPinsLoading] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!chatId || rulesPending.current || rulesReadPending.current) return;
    rulesReadPending.current = true;
    setLoading(true);
    setError(null);
    try {
      if (isSignedIn && !temporary) {
        const rules = await getRules({ data: { chatId } });
        if (!active.current) return;
        rulesRevision.current = rules?.updatedAt ?? null;
        setRulesKnown(true);
        const saved = { instructions: rules?.instructions ?? "", enabled: rules?.enabled ?? true };
        setReviewedRules(draftRef.current ? saved : null);
        adoptSaved(saved);
        rulesActiveCallback.current?.(Boolean(rules?.instructions?.trim() && rules.enabled));
      } else {
        setRulesKnown(true);
        const local = temporary ? null : localRules(safeBrowserStorage("localStorage"), chatId);
        adoptSaved({ instructions: local?.instructions ?? "", enabled: local?.enabled ?? true });
        rulesActiveCallback.current?.(Boolean(local?.instructions?.trim() && local.enabled));
      }
    } catch (err) {
      if (active.current)
        setError(err instanceof Error ? err.message : "Chat rules could not be loaded.");
    } finally {
      if (active.current) {
        rulesReadPending.current = false;
        setLoading(false);
      }
    }
  }, [adoptSaved, chatId, getRules, isSignedIn, temporary]);

  const loadPins = useCallback(async () => {
    if (!chatId || !isSignedIn || temporary) {
      setPins([]);
      return;
    }
    if (pinPending.current) return;
    const sequence = ++pinsReadSequence.current;
    pinsReadPending.current = true;
    setPinError(null);
    setPinsLoading(true);
    try {
      const rows = await listPins({ data: { chatId } });
      if (!active.current || sequence !== pinsReadSequence.current) return;
      setPins(rows);
      setPinsKnown(true);
    } catch {
      if (active.current && sequence === pinsReadSequence.current) {
        setPinsKnown(false);
        setPinError("Pinned files could not be loaded.");
      }
    } finally {
      if (active.current && sequence === pinsReadSequence.current) {
        pinsReadPending.current = false;
        setPinsLoading(false);
      }
    }
  }, [chatId, isSignedIn, listPins, temporary]);

  const loadChoices = useCallback(
    async (cursor: Record<string, unknown> | null = null) => {
      if (!user?.id || temporary || !open) return;
      const sequence = ++libraryRead.current;
      libraryAbort.current?.abort();
      const controller = new AbortController();
      libraryAbort.current = controller;
      setLibraryLoading(true);
      setLibraryError(null);
      if (!cursor) {
        setLibrary([]);
        setLibraryCursor(null);
      }
      try {
        const page = await listLibraryPage(
          user.id,
          {
            query: libraryQuery,
            sort: "newest",
            filter: "all",
            folder: "all",
            favorites: "",
            cursor,
          },
          controller.signal,
        );
        if (!active.current || sequence !== libraryRead.current) return;
        const choices = page.items.map((item) => ({ id: item.id, title: item.title }));
        setLibrary((previous) =>
          cursor
            ? [
                ...previous,
                ...choices.filter((item) => !previous.some((prior) => prior.id === item.id)),
              ]
            : choices,
        );
        setLibraryCursor(page.cursor);
      } catch {
        if (active.current && sequence === libraryRead.current)
          setLibraryError("Library choices could not be loaded. Retry to choose a file.");
      } finally {
        if (active.current && sequence === libraryRead.current) setLibraryLoading(false);
      }
    },
    [user?.id, temporary, open, libraryQuery],
  );
  useEffect(() => {
    void loadChoices();
    return () => {
      libraryRead.current += 1;
      libraryAbort.current?.abort();
    };
  }, [loadChoices]);

  useEffect(() => {
    if (!open) return;
    void load();
    void loadPins();
  }, [load, loadPins, open]);

  const persistRules = useCallback(
    async (nextEnabled = enabled) => {
      if (
        !chatId ||
        !active.current ||
        rulesPending.current ||
        rulesReadPending.current ||
        (isSignedIn && rulesRevision.current === undefined)
      )
        return;
      if (temporary) {
        toast.message("Temporary chat: rules are not saved.");
        return;
      }
      rulesPending.current = true;
      setSaving(true);
      setError(null);
      try {
        if (isSignedIn) {
          const saved = await saveRules({
            data: {
              chatId,
              instructions,
              enabled: nextEnabled,
              expectedUpdatedAt: rulesRevision.current ?? null,
            },
          });
          if (!active.current) return;
          rulesRevision.current = saved.updatedAt;
          setReviewedRules(null);
          toast.success("Chat rules saved");
        } else {
          saveLocalRules(safeBrowserStorage("localStorage"), chatId, {
            instructions,
            enabled: nextEnabled,
          });
          toast.message("Chat rules saved on this device only");
        }
        adoptSaved({ instructions, enabled: nextEnabled });
        rulesActiveCallback.current?.(Boolean(instructions.trim() && nextEnabled));
      } catch (err) {
        if (active.current) {
          if (isSignedIn) {
            rulesRevision.current = undefined;
            setRulesKnown(false);
          }
          setError(err instanceof Error ? err.message : "Chat rules could not be saved.");
        }
      } finally {
        if (active.current) {
          rulesPending.current = false;
          setSaving(false);
        }
      }
    },
    [adoptSaved, chatId, enabled, instructions, isSignedIn, saveRules, temporary],
  );

  const reset = useCallback(async () => {
    if (
      !chatId ||
      !active.current ||
      rulesPending.current ||
      rulesReadPending.current ||
      (isSignedIn && rulesRevision.current === undefined)
    )
      return;
    const resetRevision = editRevision.current;
    rulesPending.current = true;
    setSaving(true);
    setError(null);
    try {
      if (isSignedIn && !temporary) {
        const saved = await resetRules({
          data: { chatId, expectedUpdatedAt: rulesRevision.current ?? null },
        });
        if (!active.current) return;
        rulesRevision.current = saved.updatedAt;
        setReviewedRules(null);
      } else clearLocalRules(safeBrowserStorage("localStorage"), chatId);
      if (!active.current) return;
      if (editRevision.current === resetRevision) {
        draftRef.current = null;
        adoptSaved({ instructions: "", enabled: true });
      }
      rulesActiveCallback.current?.(false);
      toast.success("Chat rules cleared");
    } catch (err) {
      if (active.current) {
        if (isSignedIn) {
          rulesRevision.current = undefined;
          setRulesKnown(false);
        }
        setError(err instanceof Error ? err.message : "Chat rules could not be cleared.");
      }
    } finally {
      if (active.current) {
        rulesPending.current = false;
        setSaving(false);
      }
    }
  }, [adoptSaved, chatId, isSignedIn, resetRules, temporary]);

  const pinnedIds = new Set(pins.map((pin) => pin.sourceId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[640px]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreDialogFocus(returnFocusTarget, returnFocusUrl);
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sliders className="h-4 w-4" /> Chat settings
          </DialogTitle>
          <DialogDescription>
            Rules and pinned files apply to this chat only and are added to the prompt on the
            server.
          </DialogDescription>
        </DialogHeader>

        <div
          role="tablist"
          aria-label="Chat settings sections"
          className="flex gap-1 rounded-full bg-muted/50 p-1"
        >
          {(["rules", "files"] as Tab[]).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`min-h-11 flex-1 rounded-full px-3 text-sm font-medium transition ${
                tab === value ? "bg-background shadow-sm" : "text-muted-foreground"
              }`}
            >
              {value === "rules" ? "Rules" : "Pinned files"}
            </button>
          ))}
        </div>

        {temporary && (
          <p className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Temporary chat is on. Rules and pins are not saved, and nothing here is remembered after
            you close the chat.
          </p>
        )}

        {tab === "rules" ? (
          <div className="flex flex-col gap-3">
            {loading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading rules…
              </p>
            ) : (
              <>
                <label htmlFor="chat-rules" className="text-xs font-medium text-muted-foreground">
                  Rules for this chat (highest priority)
                </label>
                <textarea
                  id="chat-rules"
                  value={instructions}
                  onChange={(event) =>
                    rememberDraft({
                      instructions: event.target.value.slice(0, MAX_RULES_LENGTH),
                      enabled,
                    })
                  }
                  rows={6}
                  placeholder="Always answer in British English and keep responses under 150 words."
                  className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30"
                />
                <p className="text-xs text-muted-foreground">
                  {instructions.length.toLocaleString()} / {MAX_RULES_LENGTH.toLocaleString()}{" "}
                  characters. Applied after your global custom instructions and any project
                  instructions.
                </p>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={enabled}
                    disabled={saving || temporary || !rulesKnown}
                    onChange={(event) => {
                      rememberDraft({ instructions, enabled: event.target.checked });
                      void persistRules(event.target.checked);
                    }}
                    className="h-4 w-4"
                  />
                  Use these rules for new messages
                </label>
                {reviewedRules && (
                  <div className="rounded-lg border p-3 text-xs">
                    Latest saved rules ({reviewedRules.enabled ? "enabled" : "disabled"}):
                    <pre className="whitespace-pre-wrap">
                      {reviewedRules.instructions || "No saved instructions."}
                    </pre>
                    Your draft remains in the editor. Saving replaces this reviewed version.
                  </div>
                )}
                {!rulesKnown && isSignedIn && (
                  <button
                    type="button"
                    onClick={() => void load()}
                    className="min-h-10 rounded-lg border px-3"
                  >
                    Review saved rules
                  </button>
                )}
                {hasDraft && (
                  <p role="status" className="text-xs text-muted-foreground">
                    Unsaved rules. This draft stays while this chat workspace is open, including
                    when you close this dialog.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void persistRules()}
                    disabled={saving || !chatId || !rulesKnown}
                    aria-busy={saving}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50"
                  >
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save rules
                  </button>
                  <button
                    type="button"
                    onClick={() => void reset()}
                    disabled={saving || !rulesKnown || (!instructions && !enabled)}
                    className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"
                  >
                    Clear
                  </button>
                </div>
                {!isSignedIn && !temporary && (
                  <p className="text-xs text-muted-foreground">
                    You are not signed in, so these rules stay on this device.
                  </p>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {!isSignedIn || temporary ? (
              <p className="text-sm text-muted-foreground">
                {temporary
                  ? "Temporary chats cannot pin files."
                  : "Sign in to pin library or project files to a chat."}
              </p>
            ) : (
              <>
                {pinsLoading ? (
                  <p role="status">Loading pinned files…</p>
                ) : !pinsKnown ? (
                  <p>Pinned files are unavailable.</p>
                ) : pins.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No files pinned to this chat yet.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {pins.map((pin) => (
                      <li
                        key={pin.id}
                        className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {library.find((item) => item.id === pin.sourceId)?.title ??
                              (pin.sourceType === "library" ? "Library item" : "Project file")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {describePinStatus(pin.status)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            if (
                              !active.current ||
                              pinPending.current ||
                              pinsReadPending.current ||
                              !pinsKnown
                            )
                              return;
                            pinPending.current = true;
                            setPinBusy(pin.id);
                            setPinError(null);
                            try {
                              await unpinFile({ data: { chatId: chatId!, pinId: pin.id } });
                              if (!active.current) return;
                              setPins((prev) => prev.filter((item) => item.id !== pin.id));
                            } catch (err) {
                              if (!active.current) return;
                              setPinError(
                                err instanceof Error
                                  ? err.message
                                  : "That pin could not be removed.",
                              );
                            } finally {
                              if (active.current) {
                                pinPending.current = false;
                                setPinBusy(null);
                              }
                            }
                          }}
                          disabled={pinBusy !== null || pinsLoading || !pinsKnown}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
                          aria-label="Unpin file"
                        >
                          {pinBusy === pin.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <PinOff className="h-3.5 w-3.5" />
                          )}
                          Unpin
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <label
                  htmlFor="chat-library-query"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Pin from your library
                </label>
                <input
                  id="chat-library-query"
                  type="search"
                  value={libraryQuery}
                  onChange={(event) => setLibraryQuery(event.target.value)}
                  placeholder="Search Library"
                  className="min-h-11 rounded-lg border bg-background px-3 text-sm"
                />
                {libraryError ? (
                  <p role="alert">
                    {libraryError}{" "}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => void loadChoices(libraryCursor)}
                    >
                      Retry
                    </button>
                  </p>
                ) : libraryLoading && library.length === 0 ? (
                  <p role="status">Loading Library choices…</p>
                ) : library.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No Library items match this search. Save a file or response, or try another
                    search.
                  </p>
                ) : (
                  <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
                    {library
                      .filter((item) => !pinnedIds.has(item.id))
                      .map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={async () => {
                              if (
                                !active.current ||
                                pinPending.current ||
                                pinsReadPending.current ||
                                !pinsKnown
                              )
                                return;
                              pinPending.current = true;
                              setPinBusy(item.id);
                              setPinError(null);
                              try {
                                const pin = await pinFile({
                                  data: {
                                    chatId: chatId!,
                                    sourceType: "library",
                                    sourceId: item.id,
                                  },
                                });
                                if (!active.current) return;
                                setPins((prev) => [
                                  ...prev.filter((existing) => existing.id !== pin.id),
                                  pin,
                                ]);
                                toast.success("File pinned to this chat");
                              } catch (err) {
                                if (!active.current) return;
                                setPinError(
                                  err instanceof Error
                                    ? err.message
                                    : "That file could not be pinned.",
                                );
                              } finally {
                                if (active.current) {
                                  pinPending.current = false;
                                  setPinBusy(null);
                                }
                              }
                            }}
                            disabled={pinBusy !== null || pinsLoading || !pinsKnown}
                            className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm hover:bg-accent disabled:opacity-50"
                          >
                            {pinBusy === item.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Pin className="h-3.5 w-3.5" />
                            )}
                            <span className="truncate">{item.title}</span>
                          </button>
                        </li>
                      ))}
                  </ul>
                )}
                {libraryCursor && (
                  <button
                    type="button"
                    disabled={libraryLoading}
                    onClick={() => void loadChoices(libraryCursor)}
                    className="min-h-11 rounded-lg border px-3 text-sm"
                  >
                    {libraryLoading ? "Loading…" : "Load more Library items"}
                  </button>
                )}
                <p className="text-xs text-muted-foreground">
                  Pinned text is added to the prompt with a bounded budget; long files are truncated
                  and the response says so.
                </p>
              </>
            )}
            {pinError && (
              <p role="alert" className="text-sm text-destructive">
                {pinError}{" "}
                <button
                  type="button"
                  className="underline"
                  disabled={pinsLoading || pinBusy !== null}
                  onClick={() => void loadPins()}
                >
                  Reload pinned files
                </button>
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
