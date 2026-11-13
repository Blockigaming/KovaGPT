import { useLayout } from "@/hooks/use-mobile";
import { MobileBottomSheet } from "./MobileBottomSheet";
import { MessageActivityList } from "./MessageActivityList";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { NovaLogo } from "./NovaLogo";
import {
  X,
  File,
  FileText,
  Image,
  Share,
  Download,
  SlidersHorizontal,
  ChevronDown,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { type Conversation } from "@/lib/chat-store";
import { conversationOutputs, type ConversationOutput } from "@/lib/conversation-outputs";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import "./conversation-header.css";

function OutputsIcon() {
  return <SlidersHorizontal aria-hidden="true" />;
}

function downloadOutput(output: ConversationOutput) {
  if (output.kind === "library" || (output.kind === "image" && !output.source)) return;
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
  conversation,
  signedIn,
  userTier = "free",
  compact = false,
  sidebarOpen = true,
  activityDock,
  navigationBlocked = false,
  isStreaming = false,
  onShare,
  onOpenContext,
  browserPresentation,
}: {
  browserPresentation?: {
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
  sidebarOpen?: boolean;
  activityDock?: HTMLDivElement | null;
  navigationBlocked?: boolean;
  isStreaming?: boolean;
  onShare: (trigger: HTMLButtonElement | null) => void;
  onRename: (title: string) => void;
  onTogglePin: () => void;
  onDelete: () => void | Promise<void>;
  onManagePlugins: (trigger: HTMLButtonElement | null) => void;
  onOpenContext?: (trigger: HTMLButtonElement) => void;
}) {
  const { user, isLoaded, isSignedIn } = useUser();
  const { isDesktop } = useLayout();
  const sourceInventory = useMemo(
    () => conversationSources(conversation, isLoaded && isSignedIn ? (user?.id ?? null) : null),
    [conversation, isLoaded, isSignedIn, user?.id],
  );
  const [selectedBrowser, setSelectedBrowser] = useState<ConversationBrowserSource | null>(null);
  const [selectedMemory, setSelectedMemory] = useState<MemorySources | null>(null);
  const [outputsOpen, setOutputsOpen] = useState(false);
  const [outputsCollapsed, setOutputsCollapsed] = useState(false);
  const [stepsCollapsed, setStepsCollapsed] = useState(false);
  const inlineActivity = isDesktop && !compact && !sidebarOpen;
  const [inlineOpen, setInlineOpen] = useState(true);
  useEffect(() => {
    if (!inlineActivity) setInlineOpen(true);
    setOutputsOpen(false);
  }, [inlineActivity]);
  const [dialog, setDialog] = useState<"share-restricted" | null>(null);
  const [selectedOutput, setSelectedOutput] = useState<ConversationOutput | null>(null);
  const outputsRef = useRef<HTMLButtonElement>(null);
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
  const steps = conversation.messages.flatMap((message) => message.activities ?? []);
  const activityContent = (
    <>
      <ConversationSourcesPanel
        browserOnly
        showActivity
        conversation={conversation}
        browserTabCount={
          signedIn && userTier !== "free" ? browserPresentation?.tabCount : undefined
        }
        browserPreview={
          signedIn && userTier !== "free" ? browserPresentation?.thumbnail : undefined
        }
        onOpenAttachment={() => {}}
        onOpenMemory={() => {}}
        onOpenBrowser={(activity) => {
          rememberFocus(outputsRef.current);
          setOutputsOpen(false);
          setSelectedBrowser(activity);
        }}
      />
      {steps.some((step) => step.tool !== "scheduled_task") && (
        <section className="kova-activity-steps" aria-label="Steps">
          <button
            type="button"
            className="kova-activity-section-toggle"
            aria-expanded={!stepsCollapsed}
            onClick={() => setStepsCollapsed((v) => !v)}
          >
            <h2>Steps</h2>
            <ChevronDown
              className={`kova-activity-chevron${stepsCollapsed ? " is-collapsed" : ""}`}
              aria-hidden="true"
            />
          </button>
          {!stepsCollapsed ? <MessageActivityList activities={steps} /> : null}
        </section>
      )}
      <button
        type="button"
        className="kova-activity-section-toggle"
        aria-expanded={!outputsCollapsed}
        onClick={() => setOutputsCollapsed((v) => !v)}
      >
        <h2>Outputs</h2>
        <ChevronDown
          className={`kova-activity-chevron${outputsCollapsed ? " is-collapsed" : ""}`}
          aria-hidden="true"
        />
      </button>
      {!outputsCollapsed && generatedOutputs.length === 0 ? (
        <p className="kova-header-note">No outputs yet.</p>
      ) : null}
      {!outputsCollapsed && generatedOutputs.length > 0 && (
        <>
          <div className="kova-output-list">
            {generatedOutputs.map((output) => (
              <button
                key={output.id}
                type="button"
                className="kova-output-row"
                onClick={() => {
                  rememberFocus(outputsRef.current);
                  setSelectedOutput(output);
                  setOutputsOpen(false);
                }}
                title={output.name}
              >
                {output.kind === "image" ? (
                  <Image aria-hidden="true" />
                ) : output.kind === "artifact" ? (
                  <FileText aria-hidden="true" />
                ) : (
                  <File aria-hidden="true" />
                )}
                <span className="kova-output-name">{output.name}</span>
                <span className="kova-output-label">{output.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <ConversationSourcesPanel
        hideBrowser
        showActivity={false}
        browserTabCount={
          signedIn && userTier !== "free" ? browserPresentation?.tabCount : undefined
        }
        browserPreview={
          signedIn && userTier !== "free" ? browserPresentation?.thumbnail : undefined
        }
        activeBrowserOnly
        separateInputs
        conversation={conversation}
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
        onOpenAttachment={(outputId) => {
          const output = outputs.find((item) => item.id === outputId);
          if (!output) return;
          rememberFocus(outputsRef.current);
          setSelectedOutput(output);
          setOutputsOpen(false);
        }}
      />
      {onOpenContext ? (
        <button
          type="button"
          className="kova-activity-context"
          onClick={(event) => {
            dialogOpeningRef.current = true;
            setOutputsOpen(false);
            onOpenContext(outputsRef.current ?? event.currentTarget);
          }}
        >
          Chat instructions and context
        </button>
      ) : null}
      {isStreaming ? (
        <p className="kova-header-note">
          A response is still being generated. Its output may change.
        </p>
      ) : null}
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
          <span>Share</span>
        </button>
        {inlineActivity ? (
          <button
            ref={outputsRef}
            type="button"
            className="kova-conversation-icon"
            aria-label="Activity"
            title="Activity"
            aria-expanded={inlineOpen}
            aria-controls={inlineOpen ? "chat-activity-panel" : undefined}
            onClick={() => setInlineOpen((value) => !value)}
          >
            <OutputsIcon />
          </button>
        ) : !isDesktop ? (
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
      {inlineActivity &&
        activityDock &&
        inlineOpen &&
        createPortal(
          <aside
            id="chat-activity-panel"
            className="kova-conversation-outputs kova-inline-activity"
            aria-label="Activity"
          >
            <header>
              <NovaLogo decorative className="size-6" />
              <h2>Activity</h2>
              <button
                type="button"
                className="kova-conversation-icon"
                aria-label="Close activity"
                onClick={() => {
                  setInlineOpen(false);
                  outputsRef.current?.focus();
                }}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            {activityContent}
          </aside>,
          activityDock,
        )}
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
                : selectedOutput?.kind === "artifact"
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
              disabled={selectedOutput.kind === "image" && !selectedOutput.source}
              onClick={() => downloadOutput(selectedOutput)}
            >
              <Download className="mr-2 h-4 w-4" />
              {selectedOutput.kind === "text" && selectedOutput.extracted
                ? "Download extracted text"
                : "Download"}
            </Button>
          ) : null}
        </DialogContent>
      </Dialog>
      {selectedBrowser &&
        (browserPresentation && signedIn && userTier !== "free" ? (
          browserPresentation.renderDialog({
            activity: selectedBrowser,
            onClose: () => setSelectedBrowser(null),
            onCloseAutoFocus: restoreFocus,
          })
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
                This is a recorded browser event. No live session is connected. A live preview and
                controls appear here when a verified browser session is active.
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
