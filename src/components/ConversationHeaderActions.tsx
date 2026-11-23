import { browserActivityIsFresh } from "@/lib/browser-activity-contract.mjs";
import { CloudBrowserTakeover } from "./CloudBrowserTakeover";
import { useLayout } from "@/hooks/use-mobile";
import { MobileBottomSheet } from "./MobileBottomSheet";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  Check,
  CircleAlert,
  FileText,
  Image,
  Share,
  Download,
  ChevronDown,
  ChevronRight,
  Plus,
  Plug,
  Paperclip,
  LibraryBig,
  PanelsTopLeft,
  Table2,
} from "lucide-react";
import { chatOutputTypes, type ChatOutputFormat } from "@/lib/chat-output-templates";
import { ChatActivityPlugins } from "./ChatActivityPlugins";
import { Link } from "@tanstack/react-router";
import { type Conversation } from "@/lib/chat-store";
import { conversationOutputs, type ConversationOutput } from "@/lib/conversation-outputs";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MemorySourcesDialog } from "./MemorySourcesDialog";
import type { MemorySources } from "@/lib/memory-sources.mjs";
import { conversationSources, type ConversationBrowserSource } from "@/lib/conversation-sources";
import { useUser } from "@/components/auth/ClerkSafe";
import { ConversationSourcesPanel } from "./ConversationSourcesPanel";
import { ConversationInputRows } from "./ConversationSourcesView";
import {
  conversationWithLiveBrowserActivity,
  getLiveBrowserActivity,
  subscribeToLiveBrowserActivity,
} from "@/lib/message-activity-list.mjs";
import "./conversation-header.css";

const stepStatusLabels = {
  done: "Completed",
  running: "In progress",
  failed: "Failed",
  canceled: "Canceled",
  interrupted: "Interrupted",
  queued: "Queued",
  paused: "Paused",
  skipped: "Skipped",
  partial: "Partly completed",
};

function OutputsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.55"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="7" r="2.8" />
      <circle cx="6" cy="17" r="2.8" />
      <path d="M13 7h7M13 17h7" />
    </svg>
  );
}

function downloadOutput(output: ConversationOutput) {
  if (
    output.kind === "office" ||
    output.kind === "library" ||
    (output.kind === "image" && !output.source)
  )
    return;
  const local = output.kind !== "image";
  const url = local
    ? URL.createObjectURL(new Blob([output.content], { type: "text/plain;charset=utf-8" }))
    : output.source!;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = output.downloadName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  if (local) window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ConversationHeaderActions({
  conversation: savedConversation,
  signedIn,
  compact = false,
  navigationBlocked = false,
  isStreaming = false,
  streamingMessageId,
  onShare,
  onCreateOutput,
  onAddFiles,
  onOpenLibrary,
  onSelectPlugin,
  browserPresentation,
}: {
  browserPresentation?: {
    active?: boolean;
    thumbnail: ReactNode;
    tabCount?: number;
    renderDialog: (props: {
      activity: ConversationBrowserSource;
      onClose: () => void;
      onCloseAutoFocus: (event: Event) => void;
    }) => ReactNode;
  };
  conversation: Conversation;
  signedIn: boolean;
  userTier?: "free" | "plus" | "pro";
  compact?: boolean;
  navigationBlocked?: boolean;
  isStreaming?: boolean;
  streamingMessageId?: string;
  onShare: (trigger: HTMLButtonElement | null) => void;
  onCreateOutput: (format: ChatOutputFormat) => void;
  onAddFiles: (trigger: HTMLElement | null) => void;
  onOpenLibrary: (trigger: HTMLElement | null) => void;
  onSelectPlugin?: (plugin: { id: string; label: string }) => void;
}) {
  const { user, isLoaded, isSignedIn } = useUser();
  const { isDesktop } = useLayout();
  const ownerId = isLoaded && isSignedIn ? (user?.id ?? null) : null;
  const liveBrowserActivity = useSyncExternalStore(
    subscribeToLiveBrowserActivity,
    getLiveBrowserActivity,
    () => null,
  );
  const conversation = useMemo(
    () => conversationWithLiveBrowserActivity(savedConversation, liveBrowserActivity, ownerId),
    [savedConversation, liveBrowserActivity, ownerId],
  );
  const sourceInventory = useMemo(
    () => conversationSources(conversation, ownerId),
    [conversation, ownerId],
  );
  const [selectedBrowser, setSelectedBrowser] = useState<ConversationBrowserSource | null>(null);
  const [selectedMemory, setSelectedMemory] = useState<MemorySources | null>(null);
  const activityId = useId();
  const [inputsCollapsed, setInputsCollapsed] = useState(false);
  const [outputsOpen, setOutputsOpen] = useState(false);
  const [outputsCollapsed, setOutputsCollapsed] = useState(false);
  const [sourcesCollapsed, setSourcesCollapsed] = useState(false);
  const [progressCollapsed, setProgressCollapsed] = useState(false);
  const [menu, setMenu] = useState<"outputs" | "sources" | "plugins" | null>(null);
  const [downloadError, setDownloadError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    if (!outputsOpen) setMenu(null);
  }, [outputsOpen]);
  const [dialog, setDialog] = useState<"share-restricted" | null>(null);
  const [selectedOutput, setSelectedOutput] = useState<ConversationOutput | null>(null);
  useEffect(() => {
    setDownloadError(false);
    setDownloading(false);
  }, [selectedOutput]);
  const outputsRef = useRef<HTMLButtonElement>(null);
  const outputsButtonRef = useRef<HTMLButtonElement>(null);
  const sourcesButtonRef = useRef<HTMLButtonElement>(null);
  const pluginsButtonRef = useRef<HTMLButtonElement>(null);
  const shareRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const returnUrlRef = useRef<string | undefined>(undefined);
  const dialogOpeningRef = useRef(false);
  const outputs = useMemo(() => conversationOutputs(conversation), [conversation]);
  const generatedOutputs = useMemo(
    () =>
      outputs.filter((output) =>
        conversation.messages.some(
          (message) => message.id === output.messageId && message.role === "assistant",
        ),
      ),
    [outputs, conversation],
  );
  const rememberFocus = (target: HTMLElement | null) => {
    returnFocusRef.current = target;
    returnUrlRef.current = window.location.href;
    dialogOpeningRef.current = true;
  };
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    restoreDialogFocus(returnFocusRef.current, returnUrlRef.current);
  };
  const restrictedTemporary = Boolean(conversation.temporary);
  const steps = useMemo(() => {
    const rows = conversation.messages.flatMap((message) =>
      (message.activities ?? [])
        .filter((step) => step.tool !== "scheduled_task")
        .map((step, index) => ({
          key: `${message.id}:${step.activityId ?? index}`,
          label: step.label,
          status:
            step.status === "running" && message.id !== streamingMessageId
              ? ("interrupted" as const)
              : step.status,
        })),
    );
    if (streamingMessageId && !rows.some((step) => step.status === "running")) {
      rows.push({ key: streamingMessageId, label: "Generating a response", status: "running" });
    }
    return rows;
  }, [conversation.messages, streamingMessageId]);
  const hasSources = Boolean(
    sourceInventory.web.length ||
    sourceInventory.memory.length ||
    sourceInventory.providers?.length ||
    (signedIn && sourceInventory.browser.length),
  );
  const openAttachment = (outputId: string) => {
    const output = outputs.find((item) => item.id === outputId);
    if (!output) return;
    rememberFocus(outputsRef.current);
    setSelectedOutput(output);
    setOutputsOpen(false);
  };
  const formatIcons = { docx: FileText, pptx: PanelsTopLeft, xlsx: Table2 };
  const handOff = (action: () => void, opensDialog = false) => {
    dialogOpeningRef.current = opensDialog;
    setOutputsOpen(false);
    action();
  };
  const renderMenu = ({
    open,
    label,
    anchor,
    children,
    close,
    side = "bottom",
  }: {
    open: boolean;
    label: string;
    anchor: ReactNode;
    children: ReactNode;
    close: () => void;
    side?: "bottom" | "left";
  }) => {
    if (!isDesktop)
      return (
        <>
          {anchor}
          {open && (
            <div className="kova-activity-submenu" aria-label={label}>
              {children}
            </div>
          )}
        </>
      );
    return (
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <PopoverAnchor asChild>{anchor}</PopoverAnchor>
        {open && (
          <PopoverContent
            aria-label={label}
            className="kova-activity-submenu kova-activity-floating"
            align={side === "left" ? "start" : "end"}
            side={side}
            sideOffset={6}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (!outputsOpen || dialogOpeningRef.current) return;
              const trigger =
                side === "left"
                  ? pluginsButtonRef.current
                  : label === "Output types"
                    ? outputsButtonRef.current
                    : sourcesButtonRef.current;
              if (event.target && document.activeElement === document.body)
                trigger?.focus({ preventScroll: true });
            }}
          >
            {children}
          </PopoverContent>
        )}
      </Popover>
    );
  };
  const activityContent = (
    <>
      <section className="kova-activity-inventory" aria-label="Progress">
        <button
          type="button"
          className="kova-activity-section-toggle"
          aria-expanded={!progressCollapsed}
          aria-controls={`${activityId}-progress`}
          onClick={() => setProgressCollapsed(!progressCollapsed)}
        >
          <span>Progress</span>
          <ChevronDown
            className={`kova-activity-chevron${progressCollapsed ? " is-collapsed" : ""}`}
            aria-hidden="true"
          />
        </button>
        <div id={`${activityId}-progress`} hidden={progressCollapsed} aria-live="polite">
          {steps.length ? (
            <ol className="kova-activity-progress">
              {steps.map((step) => (
                <li key={step.key} data-status={step.status}>
                  {step.status === "done" && (
                    <Check className="kova-activity-step-icon" aria-hidden="true" />
                  )}
                  {step.status !== "done" && step.status !== "running" && (
                    <CircleAlert className="kova-activity-step-icon" aria-hidden="true" />
                  )}
                  <span>{step.label}</span>
                  <span
                    className={
                      step.status === "done" || step.status === "running"
                        ? "sr-only"
                        : "kova-activity-step-status"
                    }
                  >
                    {stepStatusLabels[step.status]}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="kova-activity-progress-empty">No steps recorded</p>
          )}
        </div>
      </section>
      <section className="kova-activity-inventory" aria-label="Outputs">
        {renderMenu({
          open: menu === "outputs",
          label: "Output types",
          anchor: (
            <div className="kova-activity-inventory-heading">
              <button
                type="button"
                className="kova-activity-section-toggle"
                aria-expanded={!outputsCollapsed}
                aria-controls={`${activityId}-outputs`}
                onClick={() => {
                  setOutputsCollapsed(!outputsCollapsed);
                  setMenu(null);
                }}
              >
                <span>Outputs</span>
                <ChevronDown
                  className={`kova-activity-chevron${outputsCollapsed ? " is-collapsed" : ""}`}
                  aria-hidden="true"
                />
              </button>
              <button
                type="button"
                ref={outputsButtonRef}
                className="kova-activity-add"
                aria-label="Create an output"
                title="Create an output"
                aria-expanded={menu === "outputs"}
                disabled={isStreaming}
                onClick={() => setMenu(menu === "outputs" ? null : "outputs")}
              >
                <Plus aria-hidden="true" />
              </button>
            </div>
          ),
          close: () => setMenu(null),
          children: (
            <>
              {(Object.keys(chatOutputTypes) as ChatOutputFormat[]).map((format) => {
                const Icon = formatIcons[format];
                return (
                  <button
                    key={format}
                    type="button"
                    disabled={isStreaming}
                    onClick={() => handOff(() => onCreateOutput(format))}
                  >
                    <Icon aria-hidden="true" /> Create {chatOutputTypes[format].label}
                  </button>
                );
              })}
            </>
          ),
        })}
        <div id={`${activityId}-outputs`} hidden={outputsCollapsed}>
          {generatedOutputs.length ? (
            <div className="kova-output-list">
              {generatedOutputs.map((output) => (
                <button
                  key={output.id}
                  type="button"
                  className="kova-output-row"
                  title={output.name}
                  onClick={() => {
                    rememberFocus(outputsRef.current);
                    setSelectedOutput(output);
                    setOutputsOpen(false);
                  }}
                >
                  {output.kind === "image" ? (
                    <Image aria-hidden="true" />
                  ) : (
                    <FileText aria-hidden="true" />
                  )}
                  <span className="kova-output-name">{output.name}</span>
                  <span className="kova-output-label">{output.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              className="kova-activity-placeholder"
              disabled={isStreaming}
              onClick={() => setMenu(menu === "outputs" ? null : "outputs")}
            >
              Create an output
            </button>
          )}
        </div>
      </section>
      <section className="kova-activity-inventory" aria-label="Inputs">
        <button
          type="button"
          className="kova-activity-section-toggle"
          aria-expanded={!inputsCollapsed}
          aria-controls={`${activityId}-inputs`}
          onClick={() => setInputsCollapsed(!inputsCollapsed)}
        >
          <span>Inputs</span>
          <ChevronDown
            className={`kova-activity-chevron${inputsCollapsed ? " is-collapsed" : ""}`}
            aria-hidden="true"
          />
        </button>
        <div id={`${activityId}-inputs`} hidden={inputsCollapsed}>
          {sourceInventory.attachments.length ? (
            <ConversationInputRows
              attachments={sourceInventory.attachments}
              onOpenAttachment={openAttachment}
            />
          ) : (
            <p className="kova-activity-progress-empty">No files attached</p>
          )}
        </div>
      </section>
      <section className="kova-activity-inventory" aria-label="Sources">
        {renderMenu({
          open: menu === "sources" || menu === "plugins",
          label: "Add source options",
          anchor: (
            <div className="kova-activity-inventory-heading">
              <button
                type="button"
                className="kova-activity-section-toggle"
                aria-expanded={!sourcesCollapsed}
                aria-controls={`${activityId}-sources`}
                onClick={() => {
                  setSourcesCollapsed(!sourcesCollapsed);
                  setMenu(null);
                }}
              >
                <span>Sources</span>
                <ChevronDown
                  className={`kova-activity-chevron${sourcesCollapsed ? " is-collapsed" : ""}`}
                  aria-hidden="true"
                />
              </button>
              <button
                type="button"
                ref={sourcesButtonRef}
                className="kova-activity-add"
                aria-label="Add source"
                title="Add source"
                aria-expanded={menu === "sources" || menu === "plugins"}
                disabled={isStreaming}
                onClick={() => setMenu(menu === "sources" || menu === "plugins" ? null : "sources")}
              >
                <Plus aria-hidden="true" />
              </button>
            </div>
          ),
          close: () => setMenu(null),
          children: (
            <>
              {renderMenu({
                open: menu === "plugins",
                label: "Connect plugins",
                side: "left",
                anchor: (
                  <button
                    type="button"
                    ref={pluginsButtonRef}
                    aria-expanded={menu === "plugins"}
                    onClick={() => setMenu(menu === "plugins" ? "sources" : "plugins")}
                  >
                    <Plug aria-hidden="true" /> Connect plugins{" "}
                    <ChevronRight className="ml-auto" aria-hidden="true" />
                  </button>
                ),
                close: () => setMenu("sources"),
                children: menu === "plugins" && (
                  <ChatActivityPlugins
                    conversation={conversation}
                    navigationBlocked={navigationBlocked}
                    onSelect={onSelectPlugin && ((plugin) => handOff(() => onSelectPlugin(plugin)))}
                    onNavigate={() => setOutputsOpen(false)}
                  />
                ),
              })}
              <button
                type="button"
                disabled={isStreaming}
                onClick={() => handOff(() => onAddFiles(outputsRef.current), !signedIn)}
              >
                <Paperclip aria-hidden="true" /> Add photos &amp; files
              </button>
              <button
                type="button"
                disabled={isStreaming}
                onClick={() => handOff(() => onOpenLibrary(outputsRef.current), true)}
              >
                <LibraryBig aria-hidden="true" /> Add from Library
              </button>
            </>
          ),
        })}
        <div id={`${activityId}-sources`} hidden={sourcesCollapsed}>
          {hasSources ? (
            <ConversationSourcesPanel
              hideBrowser={!signedIn}
              compactBrowser
              hideSourcesHeading
              hideAttachments
              showActivity={false}
              conversation={conversation}
              browserTabCount={
                browserPresentation?.active ? browserPresentation.tabCount : undefined
              }
              browserPreview={
                browserPresentation?.active ? browserPresentation.thumbnail : undefined
              }
              onOpenBrowser={(activity) => {
                rememberFocus(outputsRef.current);
                setOutputsOpen(false);
                setSelectedBrowser(activity);
              }}
              onOpenMemory={(sources) => {
                rememberFocus(outputsRef.current);
                setOutputsOpen(false);
                setSelectedMemory(sources);
              }}
              onOpenAttachment={openAttachment}
            />
          ) : (
            <button
              type="button"
              className="kova-activity-placeholder"
              disabled={isStreaming}
              onClick={() => setMenu(menu === "sources" || menu === "plugins" ? null : "sources")}
            >
              Attach files or connect apps
            </button>
          )}
        </div>
      </section>
    </>
  );
  return (
    <>
      <div
        className={`kova-conversation-actions${compact ? " kova-conversation-actions-compact" : ""}`}
        aria-label="Conversation actions"
      >
        <button
          ref={shareRef}
          type="button"
          className="kova-conversation-share"
          aria-label="Share chat"
          title="Share chat"
          onClick={() => {
            if (restrictedTemporary || !signedIn) {
              rememberFocus(shareRef.current);
              dialogOpeningRef.current = false;
              setDialog("share-restricted");
            } else onShare(shareRef.current);
          }}
        >
          <Share aria-hidden="true" />
        </button>
        {!isDesktop ? (
          <>
            <button
              ref={outputsRef}
              type="button"
              className="kova-conversation-icon"
              aria-label="Activity"
              title="Activity"
              aria-haspopup="dialog"
              aria-expanded={outputsOpen}
              onClick={() => {
                dialogOpeningRef.current = false;
                setOutputsOpen(true);
              }}
            >
              <OutputsIcon />
            </button>
            <MobileBottomSheet
              open={outputsOpen}
              onOpenChange={setOutputsOpen}
              title="Activity"
              restoreFocus={!dialogOpeningRef.current}
            >
              <div className="kova-conversation-outputs kova-conversation-outputs-touch">
                {activityContent}
              </div>
            </MobileBottomSheet>
          </>
        ) : (
          <Popover
            open={outputsOpen}
            onOpenChange={(open) => {
              if (open) dialogOpeningRef.current = false;
              setOutputsOpen(open);
            }}
          >
            <PopoverTrigger asChild>
              <button
                ref={outputsRef}
                type="button"
                className="kova-conversation-icon"
                aria-label="Activity"
                title="Activity"
              >
                <OutputsIcon />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={10}
              className="kova-conversation-outputs"
              aria-label="Activity"
              onCloseAutoFocus={(event) => {
                if (!dialogOpeningRef.current) return;
                event.preventDefault();
                dialogOpeningRef.current = false;
              }}
            >
              {activityContent}
            </PopoverContent>
          </Popover>
        )}
      </div>
      <Dialog
        open={dialog === "share-restricted"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent className="sm:max-w-md" onCloseAutoFocus={restoreFocus}>
          <DialogTitle>Sharing unavailable</DialogTitle>
          <DialogDescription>
            {restrictedTemporary
              ? "Temporary chats cannot be shared. Start a regular chat to share a conversation."
              : "Sign in to share this conversation."}
          </DialogDescription>
          <Button variant="outline" onClick={() => setDialog(null)}>
            Close
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={selectedOutput !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedOutput(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl" onCloseAutoFocus={restoreFocus}>
          <DialogTitle className="break-words pr-8">{selectedOutput?.name}</DialogTitle>
          <DialogDescription>
            {selectedOutput?.kind === "library"
              ? "This chat keeps a Library reference. Open Library to access the original file."
              : selectedOutput?.kind === "text" && selectedOutput.extracted
                ? "Extracted text from the attachment. The original file is not stored in this chat."
                : selectedOutput?.kind === "artifact" || selectedOutput?.kind === "office"
                  ? "Generated content from this conversation."
                  : "Attachment in this conversation."}
          </DialogDescription>
          {selectedOutput?.kind === "image" ? (
            selectedOutput.source ? (
              <img
                className="kova-header-image-preview"
                src={selectedOutput.source}
                alt={selectedOutput.name}
              />
            ) : (
              <p className="kova-header-note">
                This image is unavailable or has an unsupported format.
              </p>
            )
          ) : selectedOutput && selectedOutput.kind !== "library" ? (
            <pre className="kova-header-text-preview">
              {selectedOutput.content || "No extracted text is available."}
            </pre>
          ) : null}
          {selectedOutput?.kind === "library" ? (
            <>
              {navigationBlocked ? (
                <p className="kova-header-note">
                  Send or clear your current message and attachments before opening Library.
                </p>
              ) : null}
              <Button asChild variant="outline">
                <Link
                  to="/library"
                  preload={false}
                  aria-disabled={navigationBlocked}
                  onClick={(event) => {
                    if (navigationBlocked) event.preventDefault();
                  }}
                >
                  Open Library
                </Link>
              </Button>
            </>
          ) : selectedOutput ? (
            <Button
              variant="outline"
              className="min-h-11"
              disabled={downloading || (selectedOutput.kind === "image" && !selectedOutput.source)}
              onClick={async () => {
                if (selectedOutput.kind !== "office") {
                  downloadOutput(selectedOutput);
                  return;
                }
                setDownloadError(false);
                setDownloading(true);
                try {
                  const { downloadDocument } = await import("@/lib/writing-export/export");
                  await downloadDocument(
                    selectedOutput.format,
                    selectedOutput.name,
                    selectedOutput.content,
                  );
                } catch {
                  setDownloadError(true);
                } finally {
                  setDownloading(false);
                }
              }}
            >
              <Download className="mr-2 h-4 w-4" />
              {selectedOutput.kind === "office"
                ? `Download ${selectedOutput.label}`
                : selectedOutput.kind === "text" && selectedOutput.extracted
                  ? "Download extracted text"
                  : "Download"}
            </Button>
          ) : null}
          {downloadError && (
            <p role="alert" className="text-sm text-destructive">
              Could not export this file. Try downloading again.
            </p>
          )}
        </DialogContent>
      </Dialog>
      {selectedBrowser &&
        (browserPresentation?.active && signedIn && selectedBrowser.status === "active" ? (
          browserPresentation.renderDialog({
            activity: selectedBrowser,
            onClose: () => setSelectedBrowser(null),
            onCloseAutoFocus: restoreFocus,
          })
        ) : signedIn &&
          user?.id &&
          selectedBrowser.status === "active" &&
          selectedBrowser.browser?.previewPath &&
          browserActivityIsFresh(selectedBrowser.browser) ? (
          <CloudBrowserTakeover
            key={selectedBrowser.browser.sessionId}
            browser={selectedBrowser.browser}
            ownerId={user.id}
            description={selectedBrowser.label}
            onClose={() => setSelectedBrowser(null)}
            onCloseAutoFocus={restoreFocus}
          />
        ) : (
          <Dialog
            open={Boolean(selectedBrowser)}
            onOpenChange={(open) => {
              if (!open) setSelectedBrowser(null);
            }}
          >
            <DialogContent onCloseAutoFocus={restoreFocus} className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Browser activity</DialogTitle>
                <DialogDescription>{selectedBrowser?.label}</DialogDescription>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                This is a recorded browser event. No live session is connected. A live preview
                appears here when a verified browser session is active.
              </p>
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => setSelectedBrowser(null)}
              >
                Close
              </Button>
            </DialogContent>
          </Dialog>
        ))}
      {selectedMemory && (
        <MemorySourcesDialog
          sources={selectedMemory}
          onClose={() => setSelectedMemory(null)}
          onCloseAutoFocus={restoreFocus}
        />
      )}
    </>
  );
}
