import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useRef, useState } from "react";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
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
  resolvePinnedContext,
  saveChatCustomRules,
  unpinChatFile,
  type ChatPinnedFileDto,
  type PinnedContextDto,
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
type WorkspaceProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatId: string | null;
  temporary?: boolean;
  onRulesActiveChange?: (active: boolean) => void;
  returnFocusTarget?: HTMLElement | null;
  returnFocusUrl?: string;
};

type FocusReturn = { target: HTMLElement | null; url: string };
type WorkspaceScope = { key: string; active: boolean };
type ReadFocus = {
  trigger: HTMLElement;
  target: "pins" | "inspection" | "library";
  lifetime: object;
  url: string;
  cleanup: () => void;
};

export function ChatWorkspaceDialog(props: WorkspaceProps) {
  const { isSignedIn, isLoaded, user } = useUser();
  // A new principal/chat/open lifetime gets fresh state before it can render.
  // Old callbacks retain their old lifetime and cannot populate this one.
  const scopeKey = JSON.stringify([
    user?.id ?? null,
    Boolean(isLoaded),
    Boolean(isSignedIn),
    props.chatId,
    Boolean(props.temporary),
    props.open,
  ]);
  const scopeRef = useRef<WorkspaceScope>({ key: scopeKey, active: true });
  if (scopeRef.current.key !== scopeKey) {
    scopeRef.current.active = false;
    scopeRef.current = { key: scopeKey, active: true };
  }
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        data-ui-reference="claude.project-instructions.dialogcontent"
        className="sm:max-w-[640px]"
        onCloseAutoFocus={(event) => {
          if (props.returnFocusUrl === undefined) return;
          event.preventDefault();
          restoreDialogFocus(props.returnFocusTarget, props.returnFocusUrl);
        }}
      >
        <ChatWorkspaceContents
          key={scopeKey}
          {...props}
          scope={scopeRef.current}
          signedIn={Boolean(isLoaded && isSignedIn && user?.id)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ChatWorkspaceContents({
  open,
  chatId,
  temporary = false,
  onRulesActiveChange,
  signedIn: isSignedIn,
  scope,
}: WorkspaceProps & { signedIn: boolean; scope: WorkspaceScope }) {
  const [tab, setTab] = useState<Tab>("rules");

  const getRules = useServerFn(getChatCustomRules);
  const saveRules = useServerFn(saveChatCustomRules);
  const resetRules = useServerFn(resetChatCustomRules);
  const listPins = useServerFn(listChatPinnedFiles);
  const pinFile = useServerFn(pinChatFile);
  const unpinFile = useServerFn(unpinChatFile);
  const listLibrary = useServerFn(listMyLibrary);
  const resolveContext = useServerFn(resolvePinnedContext);

  const [instructions, setInstructions] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pins, setPins] = useState<ChatPinnedFileDto[]>([]);
  const [context, setContext] = useState<PinnedContextDto | null>(null);
  const [pinsLoading, setPinsLoading] = useState(false);
  const [library, setLibrary] = useState<LibraryChoice[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinActionError, setPinActionError] = useState<string | null>(null);
  const [inspectedPinId, setInspectedPinId] = useState<string | null>(null);
  const lifetimeRef = useRef<object | null>(null);
  const pinsRequestRef = useRef(0);
  const libraryRequestRef = useRef(0);
  const pinBusyRef = useRef(false);
  const inspectedPinRef = useRef<string | null>(null);
  const inspectButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const unpinButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const libraryButtonRef = useRef<HTMLButtonElement>(null);
  const filesTabRef = useRef<HTMLButtonElement>(null);
  const inspectionReturnRef = useRef<FocusReturn | null>(null);
  const pendingFocusRef = useRef<FocusReturn | null>(null);
  const pinsResultsRef = useRef<HTMLDivElement>(null);
  const libraryResultsRef = useRef<HTMLDivElement>(null);
  const inspectionResultsRef = useRef<HTMLDivElement>(null);
  const readFocusRef = useRef<ReadFocus | null>(null);

  const clearReadFocus = useCallback(() => {
    readFocusRef.current?.cleanup();
    readFocusRef.current = null;
  }, []);
  const captureReadFocus = useCallback(
    (trigger: HTMLElement | undefined, target: ReadFocus["target"]) => {
      clearReadFocus();
      const lifetime = lifetimeRef.current;
      if (!trigger || !scope.active || !lifetime || document.activeElement !== trigger) return;
      const moved = (event: Event) => {
        if (event.target !== trigger && event.target !== document.body) clearReadFocus();
      };
      document.addEventListener("focusin", moved);
      document.addEventListener("pointerdown", clearReadFocus);
      document.addEventListener("keydown", clearReadFocus);
      const navigationEvents = ["popstate", "hashchange", "pagehide", "blur"] as const;
      for (const event of navigationEvents) window.addEventListener(event, clearReadFocus);
      readFocusRef.current = {
        trigger,
        target,
        lifetime,
        url: window.location.href,
        cleanup: () => {
          document.removeEventListener("focusin", moved);
          document.removeEventListener("pointerdown", clearReadFocus);
          document.removeEventListener("keydown", clearReadFocus);
          for (const event of navigationEvents) window.removeEventListener(event, clearReadFocus);
        },
      };
    },
    [clearReadFocus, scope],
  );

  useEffect(() => {
    const lifetime = {};
    lifetimeRef.current = lifetime;
    return () => {
      if (lifetimeRef.current === lifetime) lifetimeRef.current = null;
      clearReadFocus();
    };
  }, [clearReadFocus]);

  const load = useCallback(async () => {
    const lifetime = lifetimeRef.current;
    if (!scope.active || !lifetime || !open || !chatId) return;
    setLoading(true);
    setError(null);
    try {
      const rules =
        isSignedIn && !temporary
          ? await getRules({ data: { chatId } })
          : temporary
            ? null
            : localRules(safeBrowserStorage("localStorage"), chatId);
      if (!scope.active || lifetimeRef.current !== lifetime) return;
      setInstructions(rules?.instructions ?? "");
      setEnabled(rules?.enabled ?? true);
      onRulesActiveChange?.(Boolean(rules?.instructions?.trim() && rules.enabled));
    } catch (err) {
      if (!scope.active || lifetimeRef.current !== lifetime) return;
      setError(err instanceof Error ? err.message : "Chat rules could not be loaded.");
    } finally {
      if (scope.active && lifetimeRef.current === lifetime) setLoading(false);
    }
  }, [chatId, getRules, isSignedIn, onRulesActiveChange, open, scope, temporary]);

  const loadPins = useCallback(
    async (trigger?: HTMLButtonElement, inspection = false) => {
      const lifetime = lifetimeRef.current;
      if (!scope.active || !lifetime || !open || !chatId || !isSignedIn || temporary) return;
      captureReadFocus(trigger, inspection ? "inspection" : "pins");
      const request = ++pinsRequestRef.current;
      const isCurrent = () =>
        scope.active && lifetimeRef.current === lifetime && pinsRequestRef.current === request;
      setPinsLoading(true);
      setPinError(null);
      try {
        // The resolver applies the existing visibility and prompt-budget rules,
        // including its documented correction of stale pin statuses.
        const [rows, resolved] = await Promise.all([
          listPins({ data: { chatId } }),
          resolveContext({ data: { chatId } }),
        ]);
        if (!isCurrent()) return;
        setPins(rows);
        setContext(resolved);
      } catch (err) {
        if (!isCurrent()) return;
        setPinError(err instanceof Error ? err.message : "Pinned files could not be loaded.");
      } finally {
        if (isCurrent()) setPinsLoading(false);
      }
    },
    [captureReadFocus, chatId, isSignedIn, listPins, open, resolveContext, scope, temporary],
  );

  const loadLibrary = useCallback(
    async (trigger?: HTMLButtonElement) => {
      const lifetime = lifetimeRef.current;
      if (!scope.active || !lifetime || !open || !chatId || !isSignedIn || temporary) return;
      captureReadFocus(trigger, "library");
      const request = ++libraryRequestRef.current;
      const isCurrent = () =>
        scope.active && lifetimeRef.current === lifetime && libraryRequestRef.current === request;
      setLibraryOpen(true);
      setLibraryLoading(true);
      setLibraryError(null);
      try {
        // Only the explicit chooser action loads Library choices. Pin names and
        // inspection never depend on this first page of recent Library items.
        const items = await listLibrary();
        if (!isCurrent()) return;
        setLibrary(items.slice(0, 50).map((item) => ({ id: item.id, title: item.title })));
      } catch (err) {
        if (!isCurrent()) return;
        setLibraryError(
          err instanceof Error ? err.message : "Library choices could not be loaded.",
        );
      } finally {
        if (isCurrent()) setLibraryLoading(false);
      }
    },
    [captureReadFocus, chatId, isSignedIn, listLibrary, open, scope, temporary],
  );

  useEffect(() => {
    if (open) void load();
  }, [load, open]);
  useEffect(() => {
    if (open && tab === "files") void loadPins();
  }, [loadPins, open, tab]);
  useEffect(() => {
    const focus = readFocusRef.current;
    if (!focus) return;
    clearReadFocus();
    if (
      !scope.active ||
      lifetimeRef.current !== focus.lifetime ||
      !open ||
      tab !== "files" ||
      (document.activeElement !== focus.trigger && document.activeElement !== document.body)
    )
      return;
    const target =
      focus.target === "library"
        ? libraryResultsRef.current
        : focus.target === "inspection"
          ? inspectionResultsRef.current
          : pinsResultsRef.current;
    // Move once, as the explicit action starts. This region survives loading,
    // errors and success; a late result never moves focus after a later action.
    restoreDialogFocus(target, focus.url);
  }, [clearReadFocus, libraryLoading, libraryOpen, open, pinsLoading, scope, tab]);
  useEffect(() => {
    if (pinBusy || !pendingFocusRef.current) return;
    const target = pendingFocusRef.current;
    pendingFocusRef.current = null;
    if (scope.active && lifetimeRef.current) restoreDialogFocus(target.target, target.url);
  }, [pinBusy, pins, scope]);

  const pinListFocusTarget = () =>
    libraryButtonRef.current?.isConnected && !libraryButtonRef.current.disabled
      ? libraryButtonRef.current
      : filesTabRef.current;

  const closeInspection = () => {
    inspectedPinRef.current = null;
    setInspectedPinId(null);
  };

  const removePin = async (
    pin: ChatPinnedFileDto,
    trigger: HTMLButtonElement,
    fromInspection = false,
  ) => {
    const lifetime = lifetimeRef.current;
    if (
      !scope.active ||
      !lifetime ||
      !open ||
      !chatId ||
      !isSignedIn ||
      temporary ||
      pinBusyRef.current
    )
      return;
    pinBusyRef.current = true;
    ++pinsRequestRef.current;
    setPinsLoading(false);
    setPinBusy(pin.id);
    setPinActionError(null);
    const url = window.location.href;
    try {
      await unpinFile({ data: { chatId, pinId: pin.id } });
      if (!scope.active || lifetimeRef.current !== lifetime) return;
      const active = document.activeElement;
      const shouldRestore =
        active === trigger ||
        active === document.body ||
        (fromInspection && active === inspectionReturnRef.current?.target);
      const index = pins.findIndex((item) => item.id === pin.id);
      const successor = pins[index + 1] ?? pins[index - 1];
      const buttons = fromInspection ? inspectButtonsRef.current : unpinButtonsRef.current;
      const focus = {
        target: (successor && buttons.get(successor.id)) || pinListFocusTarget(),
        url,
      };
      if (inspectedPinRef.current === pin.id) {
        inspectionReturnRef.current = shouldRestore ? focus : null;
        closeInspection();
      } else if (shouldRestore) {
        pendingFocusRef.current = focus;
      }
      setPins((previous) => previous.filter((item) => item.id !== pin.id));
      setContext((previous) =>
        previous
          ? {
              ...previous,
              items: previous.items.filter((item) => item.pinId !== pin.id),
            }
          : null,
      );
      void loadPins();
    } catch (err) {
      if (!scope.active || lifetimeRef.current !== lifetime) return;
      setPinActionError(err instanceof Error ? err.message : "That pin could not be removed.");
    } finally {
      if (scope.active && lifetimeRef.current === lifetime) {
        pinBusyRef.current = false;
        setPinBusy(null);
      }
    }
  };

  const addPin = async (item: LibraryChoice) => {
    const lifetime = lifetimeRef.current;
    if (
      !scope.active ||
      !lifetime ||
      !open ||
      !chatId ||
      !isSignedIn ||
      temporary ||
      pinBusyRef.current
    )
      return;
    pinBusyRef.current = true;
    ++pinsRequestRef.current;
    setPinsLoading(false);
    setPinBusy(item.id);
    setPinActionError(null);
    try {
      const pin = await pinFile({ data: { chatId, sourceType: "library", sourceId: item.id } });
      if (!scope.active || lifetimeRef.current !== lifetime) return;
      setPins((previous) => [...previous.filter((existing) => existing.id !== pin.id), pin]);
      toast.success("File pinned to this chat");
      void loadPins();
    } catch (err) {
      if (!scope.active || lifetimeRef.current !== lifetime) return;
      setPinActionError(err instanceof Error ? err.message : "That file could not be pinned.");
    } finally {
      if (scope.active && lifetimeRef.current === lifetime) {
        pinBusyRef.current = false;
        setPinBusy(null);
      }
    }
  };

  const persistRules = useCallback(
    async (nextEnabled = enabled) => {
      const lifetime = lifetimeRef.current;
      if (!scope.active || !lifetime || !open || !chatId) return;
      if (temporary) {
        toast.message("Temporary chat: rules are not saved.");
        return;
      }
      setSaving(true);
      setError(null);
      try {
        if (isSignedIn) {
          await saveRules({ data: { chatId, instructions, enabled: nextEnabled } });
          if (!scope.active || lifetimeRef.current !== lifetime) return;
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
        if (!scope.active || lifetimeRef.current !== lifetime) return;
        setError(err instanceof Error ? err.message : "Chat rules could not be saved.");
      } finally {
        if (scope.active && lifetimeRef.current === lifetime) setSaving(false);
      }
    },
    [
      chatId,
      enabled,
      instructions,
      isSignedIn,
      onRulesActiveChange,
      open,
      saveRules,
      scope,
      temporary,
    ],
  );

  const reset = useCallback(async () => {
    const lifetime = lifetimeRef.current;
    if (!scope.active || !lifetime || !open || !chatId || temporary) return;
    setSaving(true);
    setError(null);
    try {
      if (isSignedIn && !temporary) await resetRules({ data: { chatId } });
      else clearLocalRules(safeBrowserStorage("localStorage"), chatId);
      if (!scope.active || lifetimeRef.current !== lifetime) return;
      setInstructions("");
      setEnabled(true);
      onRulesActiveChange?.(false);
      toast.success("Chat rules cleared");
    } catch (err) {
      if (!scope.active || lifetimeRef.current !== lifetime) return;
      setError(err instanceof Error ? err.message : "Chat rules could not be cleared.");
    } finally {
      if (scope.active && lifetimeRef.current === lifetime) setSaving(false);
    }
  }, [chatId, isSignedIn, onRulesActiveChange, open, resetRules, scope, temporary]);

  const pinnedIds = new Set(
    pins.filter((pin) => pin.sourceType === "library").map((pin) => pin.sourceId),
  );
  const inspectedPin = pins.find((pin) => pin.id === inspectedPinId);
  const inspectedItem = context?.items.find((item) => item.pinId === inspectedPinId);
  const pinName = (pin: ChatPinnedFileDto) =>
    context?.items.find((item) => item.pinId === pin.id)?.name ??
    (pin.sourceType === "library" ? "Pinned Library item" : "Pinned project file");

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Sliders className="h-4 w-4" /> Chat settings
        </DialogTitle>
        <DialogDescription>
          Rules and pinned files apply to this chat only and are added to the prompt on the server.
        </DialogDescription>
      </DialogHeader>

      <div
        role="tablist"
        aria-label="Chat settings sections"
        className="flex gap-1 rounded-full bg-muted/50 p-1"
      >
        {(["rules", "files"] as Tab[]).map((value) => (
          <Button
            data-ui-reference="claude.project-instructions.control"
            variant="ghost"
            key={value}
            ref={value === "files" ? filesTabRef : undefined}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={` flex-1   text-sm font-medium transition ${
              tab === value ? "bg-background shadow-sm" : "text-muted-foreground"
            }`}
          >
            {value === "rules" ? "Rules" : "Pinned files"}
          </Button>
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
              <Textarea
                data-ui-reference="claude.project-instructions.textarea"
                id="chat-rules"
                value={instructions}
                onChange={(event) => setInstructions(event.target.value.slice(0, MAX_RULES_LENGTH))}
                rows={6}
                placeholder="Always answer in British English and keep responses under 150 words."
                className="w-full resize-y  border border-border bg-background   text-sm outline-none focus:border-foreground/30"
              />
              <p className="text-xs text-muted-foreground">
                {instructions.length.toLocaleString()} / {MAX_RULES_LENGTH.toLocaleString()}{" "}
                characters. Applied after your global custom instructions and any project
                instructions.
              </p>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <Checkbox
                  data-ui-reference="chatgpt.checkbox"

                  checked={enabled}
                  onCheckedChange={(checked) => {
                    setEnabled(checked === true);
                    void persistRules(checked === true);
                  }}
                  className="h-4 w-4"
                />
                Use these rules for new messages
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  data-ui-reference="claude.project-instructions.control"
                  variant="default"
                  type="button"
                  onClick={() => void persistRules()}
                  disabled={saving || !chatId}
                  aria-busy={saving}
                  className="inline-flex  items-center gap-2  bg-foreground  text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save rules
                </Button>
                <Button
                  data-ui-reference="claude.project-instructions.control"
                  variant="outline"
                  type="button"
                  onClick={() => void reset()}
                  disabled={saving || (!instructions && !enabled)}
                  className="inline-flex  items-center  border border-border  text-sm font-medium hover:bg-accent disabled:opacity-50"
                >
                  Clear
                </Button>
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
        <div
          ref={pinsResultsRef}
          role="region"
          aria-label="Pinned context results"
          aria-busy={pinsLoading}
          tabIndex={-1}
          className="flex flex-col gap-3"
        >
          {!isSignedIn || temporary ? (
            <p className="text-sm text-muted-foreground">
              {temporary
                ? "Temporary chats cannot pin files."
                : "Sign in to pin library or project files to a chat."}
            </p>
          ) : (
            <>
              {pinsLoading && (
                <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading pinned context…
                </p>
              )}
              {!pinsLoading && !pinError && pins.length === 0 && (
                <p className="text-sm text-muted-foreground">No files pinned to this chat yet.</p>
              )}
              {pins.length > 0 && (
                <ul className="flex flex-col gap-2" aria-label="Pinned files">
                  {pins.map((pin) => {
                    const resolved = context?.items.find((item) => item.pinId === pin.id);
                    return (
                      <li
                        key={pin.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2"
                      >
                        <div className="min-w-0 flex-1 basis-40">
                          <p className="break-words text-sm font-medium">{pinName(pin)}</p>
                          <p className="text-xs text-muted-foreground">
                            {pin.sourceType === "library" ? "Library" : "Project files"} ·{" "}
                            {resolved?.statusLabel ?? describePinStatus(pin.status)}
                          </p>
                          {resolved?.truncated && (
                            <p className="text-xs text-muted-foreground">Truncated context</p>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <Button
                            data-ui-reference="claude.project-instructions.control"
                            variant="outline"
                            ref={(element) => {
                              if (element) inspectButtonsRef.current.set(pin.id, element);
                              else inspectButtonsRef.current.delete(pin.id);
                            }}
                            type="button"
                            onClick={(event) => {
                              inspectionReturnRef.current = {
                                target: event.currentTarget,
                                url: window.location.href,
                              };
                              inspectedPinRef.current = pin.id;
                              setInspectedPinId(pin.id);
                              setPinActionError(null);
                              void loadPins();
                            }}
                            aria-label={`Inspect ${pinName(pin)}`}
                            className="inline-flex  items-center  border border-border  text-sm font-medium hover:bg-accent"
                          >
                            Inspect
                          </Button>
                          <Button
                            data-ui-reference="claude.project-instructions.control"
                            variant="outline"
                            ref={(element) => {
                              if (element) unpinButtonsRef.current.set(pin.id, element);
                              else unpinButtonsRef.current.delete(pin.id);
                            }}
                            type="button"
                            onClick={(event) => void removePin(pin, event.currentTarget)}
                            disabled={pinBusy !== null}
                            aria-busy={pinBusy === pin.id}
                            className="inline-flex  items-center gap-1.5  border border-border  text-sm font-medium hover:bg-accent disabled:opacity-50"
                            aria-label={`Unpin ${pinName(pin)}`}
                          >
                            {pinBusy === pin.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <PinOff className="h-3.5 w-3.5" />
                            )}
                            Unpin
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {context && !pinsLoading && !pinError && (
                <p className="text-xs text-muted-foreground">
                  {context.usedChars.toLocaleString()} of {context.totalBudget.toLocaleString()}{" "}
                  context characters used.
                  {context.truncatedCount > 0 &&
                    ` ${context.truncatedCount} pinned item(s) truncated.`}
                  {context.skippedCount > 0 &&
                    ` ${context.skippedCount} pinned item(s) omitted by the context budget; their details are not available in this preview.`}
                </p>
              )}
              <Button
                data-ui-reference="claude.project-instructions.control"
                variant="outline"
                ref={libraryButtonRef}
                type="button"
                onClick={(event) => void loadLibrary(event.currentTarget)}
                disabled={libraryLoading}
                className="inline-flex  items-center justify-center gap-2  border border-border  text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                <Pin className="h-4 w-4" />{" "}
                {libraryOpen ? "Refresh Library choices" : "Choose a Library item to pin"}
              </Button>
              {libraryOpen && (
                <div
                  ref={libraryResultsRef}
                  role="region"
                  aria-label="Library choice results"
                  aria-busy={libraryLoading}
                  tabIndex={-1}
                  className="flex flex-col gap-2"
                >
                  {libraryLoading ? (
                    <p role="status" className="text-sm text-muted-foreground">
                      Loading Library choices…
                    </p>
                  ) : libraryError ? (
                    <div role="alert" className="text-sm text-destructive">
                      <p>{libraryError}</p>
                      <Button
                        data-ui-reference="claude.project-instructions.control"
                        variant="link"
                        type="button"
                        onClick={(event) => void loadLibrary(event.currentTarget)}
                        className=" underline"
                      >
                        Retry Library choices
                      </Button>
                    </div>
                  ) : library.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Your Library is empty. Save a file or response first.
                    </p>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Showing up to 50 recent Library items. Already pinned items are excluded.
                      </p>
                      <ul
                        className="flex max-h-56 flex-col gap-1 overflow-y-auto"
                        aria-label="Library choices"
                      >
                        {library
                          .filter((item) => !pinnedIds.has(item.id))
                          .map((item) => (
                            <li key={item.id}>
                              <Button
                                data-ui-reference="claude.project-instructions.control"
                                variant="ghost"
                                type="button"
                                onClick={() => void addPin(item)}
                                disabled={pinBusy !== null}
                                aria-busy={pinBusy === item.id}
                                className="h-auto min-h-9 whitespace-normal rounded-[var(--kova-radius-compact)] py-2.5 flex  w-full items-center gap-2   text-left text-sm hover:bg-accent disabled:opacity-50"
                              >
                                {pinBusy === item.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Pin className="h-3.5 w-3.5" />
                                )}
                                <span className="truncate">{item.title}</span>
                              </Button>
                            </li>
                          ))}
                      </ul>
                      {library.every((item) => pinnedIds.has(item.id)) && (
                        <p className="text-sm text-muted-foreground">
                          All shown items are already pinned.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                This preview contains bounded extracted text. Pinned content is checked again when
                you send a message; files and access can change.
              </p>
            </>
          )}
          {pinError && (
            <div role="alert" className="text-sm text-destructive">
              <p>{pinError}</p>
              <Button
                data-ui-reference="claude.project-instructions.control"
                variant="link"
                type="button"
                onClick={(event) => void loadPins(event.currentTarget)}
                disabled={pinsLoading}
                className=" underline"
              >
                Retry pinned context
              </Button>
            </div>
          )}
          {pinActionError && (
            <p role="alert" className="text-sm text-destructive">
              {pinActionError}
            </p>
          )}
        </div>
      )}
      <Dialog
        open={inspectedPinId !== null}
        onOpenChange={(next) => {
          if (!next) closeInspection();
        }}
      >
        <DialogContent
          data-ui-reference="claude.project-instructions.dialogcontent"
          closeLabel="Close pinned context"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const focus = inspectionReturnRef.current;
            if (scope.active && lifetimeRef.current && focus) {
              restoreDialogFocus(
                focus.target?.isConnected ? focus.target : pinListFocusTarget(),
                focus.url,
              );
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {pinsLoading || pinError
                ? "Pinned context"
                : (inspectedItem?.name ?? "Pinned context")}
            </DialogTitle>
            <DialogDescription>
              Inspect the extracted text available within this chat’s pinned-context budget.
            </DialogDescription>
          </DialogHeader>
          <div
            ref={inspectionResultsRef}
            role="region"
            aria-label="Pinned inspection results"
            aria-busy={pinsLoading}
            tabIndex={-1}
            className="flex flex-col gap-3"
          >
            {pinsLoading ? (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading pinned context…
              </p>
            ) : pinError ? (
              <div role="alert" className="text-sm text-destructive">
                <p>{pinError}</p>
                <Button
                  data-ui-reference="claude.project-instructions.control"
                  variant="link"
                  type="button"
                  onClick={(event) => void loadPins(event.currentTarget, true)}
                  className=" underline"
                >
                  Retry inspection
                </Button>
              </div>
            ) : inspectedItem ? (
              <>
                <dl className="grid gap-2 text-sm">
                  <div>
                    <dt className="font-medium">Origin</dt>
                    <dd>{inspectedItem.sourceType === "library" ? "Library" : "Project files"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium">Readiness</dt>
                    <dd>{inspectedItem.statusLabel}</dd>
                  </div>
                </dl>
                {inspectedItem.truncated && (
                  <p role="status" className="rounded-xl border border-border p-3 text-sm">
                    Truncated: only {inspectedItem.includedChars.toLocaleString()} characters fit
                    within the pinned-context budget. This is not the full file.
                  </p>
                )}
                {inspectedItem.status === "active" && inspectedItem.content ? (
                  <>
                    <p className="text-xs font-medium text-muted-foreground">
                      Bounded extracted text · {inspectedItem.includedChars.toLocaleString()}{" "}
                      characters
                    </p>
                    <div className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-border p-3 text-sm">
                      {inspectedItem.content}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No readable text is included for this pin. It is {inspectedItem.statusLabel}.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {inspectedPin
                  ? "This pin is not included in the resolved context preview. The shared text budget may be exhausted; its name and content are unavailable here."
                  : "This file is no longer pinned to this chat."}
              </p>
            )}
            {pinActionError && (
              <p role="alert" className="text-sm text-destructive">
                {pinActionError}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              data-ui-reference="claude.project-instructions.control"
              variant="outline"
              type="button"
              onClick={closeInspection}
              className="  border border-border  text-sm font-medium hover:bg-accent"
            >
              Close inspection
            </Button>
            <Button
              data-ui-reference="claude.project-instructions.control"
              variant="outline"
              type="button"
              onClick={(event) => void loadPins(event.currentTarget, true)}
              disabled={pinsLoading || pinBusy !== null}
              className="  border border-border  text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              Refresh context
            </Button>
            {inspectedPin && (
              <Button
                data-ui-reference="claude.project-instructions.control"
                variant="outline"
                type="button"
                onClick={(event) => void removePin(inspectedPin, event.currentTarget, true)}
                disabled={pinBusy !== null}
                aria-busy={pinBusy === inspectedPin.id}
                className="inline-flex  items-center gap-2  border border-border  text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                {pinBusy === inspectedPin.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PinOff className="h-4 w-4" />
                )}{" "}
                Unpin from this chat
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
