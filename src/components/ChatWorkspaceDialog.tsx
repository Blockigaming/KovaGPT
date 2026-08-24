import { useCallback, useEffect, useState } from "react";
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
import { listMyLibrary } from "@/lib/library.functions";
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
export function ChatWorkspaceDialog({
  open,
  onOpenChange,
  chatId,
  temporary = false,
  onRulesActiveChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatId: string | null;
  temporary?: boolean;
  onRulesActiveChange?: (active: boolean) => void;
}) {
  const { isSignedIn } = useUser();
  const [tab, setTab] = useState<Tab>("rules");

  const getRules = useServerFn(getChatCustomRules);
  const saveRules = useServerFn(saveChatCustomRules);
  const resetRules = useServerFn(resetChatCustomRules);
  const listPins = useServerFn(listChatPinnedFiles);
  const pinFile = useServerFn(pinChatFile);
  const unpinFile = useServerFn(unpinChatFile);
  const listLibrary = useServerFn(listMyLibrary);

  const [instructions, setInstructions] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pins, setPins] = useState<ChatPinnedFileDto[]>([]);
  const [library, setLibrary] = useState<LibraryChoice[]>([]);
  const [pinBusy, setPinBusy] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!chatId) return;
    setLoading(true);
    setError(null);
    try {
      if (isSignedIn && !temporary) {
        const rules = await getRules({ data: { chatId } });
        setInstructions(rules?.instructions ?? "");
        setEnabled(rules?.enabled ?? true);
        onRulesActiveChange?.(Boolean(rules?.instructions?.trim() && rules.enabled));
      } else {
        const local = temporary ? null : localRules(safeBrowserStorage("localStorage"), chatId);
        setInstructions(local?.instructions ?? "");
        setEnabled(local?.enabled ?? true);
        onRulesActiveChange?.(Boolean(local?.instructions?.trim() && local.enabled));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat rules could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [chatId, getRules, isSignedIn, onRulesActiveChange, temporary]);

  const loadPins = useCallback(async () => {
    if (!chatId || !isSignedIn || temporary) {
      setPins([]);
      return;
    }
    setPinError(null);
    try {
      const [rows, items] = await Promise.all([
        listPins({ data: { chatId } }),
        listLibrary().catch(() => []),
      ]);
      setPins(rows);
      setLibrary(
        (items as { id: string; title: string }[])
          .slice(0, 50)
          .map((item) => ({ id: item.id, title: item.title })),
      );
    } catch (err) {
      setPinError(err instanceof Error ? err.message : "Pinned files could not be loaded.");
    }
  }, [chatId, isSignedIn, listLibrary, listPins, temporary]);

  useEffect(() => {
    if (!open) return;
    void load();
    void loadPins();
  }, [load, loadPins, open]);

  const persistRules = useCallback(
    async (nextEnabled = enabled) => {
      if (!chatId) return;
      if (temporary) {
        toast.message("Temporary chat: rules are not saved.");
        return;
      }
      setSaving(true);
      setError(null);
      try {
        if (isSignedIn) {
          await saveRules({ data: { chatId, instructions, enabled: nextEnabled } });
          toast.success("Chat rules saved");
        } else {
          saveLocalRules(safeBrowserStorage("localStorage"), chatId, {
            instructions,
            enabled: nextEnabled,
          });
          toast.message("Chat rules saved on this device only");
        }
        onRulesActiveChange?.(Boolean(instructions.trim() && nextEnabled));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Chat rules could not be saved.");
      } finally {
        setSaving(false);
      }
    },
    [chatId, enabled, instructions, isSignedIn, onRulesActiveChange, saveRules, temporary],
  );

  const reset = useCallback(async () => {
    if (!chatId) return;
    setSaving(true);
    setError(null);
    try {
      if (isSignedIn && !temporary) await resetRules({ data: { chatId } });
      else clearLocalRules(safeBrowserStorage("localStorage"), chatId);
      setInstructions("");
      setEnabled(true);
      onRulesActiveChange?.(false);
      toast.success("Chat rules cleared");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat rules could not be cleared.");
    } finally {
      setSaving(false);
    }
  }, [chatId, isSignedIn, onRulesActiveChange, resetRules, temporary]);

  const pinnedIds = new Set(pins.map((pin) => pin.sourceId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
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
                    setInstructions(event.target.value.slice(0, MAX_RULES_LENGTH))
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
                    onChange={(event) => {
                      setEnabled(event.target.checked);
                      void persistRules(event.target.checked);
                    }}
                    className="h-4 w-4"
                  />
                  Use these rules for new messages
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void persistRules()}
                    disabled={saving || !chatId}
                    aria-busy={saving}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50"
                  >
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save rules
                  </button>
                  <button
                    type="button"
                    onClick={() => void reset()}
                    disabled={saving || (!instructions && !enabled)}
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
                {pins.length === 0 ? (
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
                            setPinBusy(pin.id);
                            setPinError(null);
                            try {
                              await unpinFile({ data: { chatId: chatId!, pinId: pin.id } });
                              setPins((prev) => prev.filter((item) => item.id !== pin.id));
                            } catch (err) {
                              setPinError(
                                err instanceof Error
                                  ? err.message
                                  : "That pin could not be removed.",
                              );
                            } finally {
                              setPinBusy(null);
                            }
                          }}
                          disabled={pinBusy === pin.id}
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

                <p className="text-xs font-medium text-muted-foreground">Pin from your library</p>
                {library.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Your library is empty. Save a file or response first.
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
                                setPins((prev) => [
                                  ...prev.filter((existing) => existing.id !== pin.id),
                                  pin,
                                ]);
                                toast.success("File pinned to this chat");
                              } catch (err) {
                                setPinError(
                                  err instanceof Error
                                    ? err.message
                                    : "That file could not be pinned.",
                                );
                              } finally {
                                setPinBusy(null);
                              }
                            }}
                            disabled={pinBusy === item.id}
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
                <p className="text-xs text-muted-foreground">
                  Pinned text is added to the prompt with a bounded budget; long files are truncated
                  and the response says so.
                </p>
              </>
            )}
            {pinError && (
              <p role="alert" className="text-sm text-destructive">
                {pinError}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
