import { useLayout } from "@/hooks/use-mobile";
import { MobileBottomSheet } from "./MobileBottomSheet";
import { MessageActivityList } from "./MessageActivityList";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { File, FileText, Image, Share, Download, LayoutList, ChevronDown } from "lucide-react";
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
import { ConversationSourcesPanel, ConversationActivitySummary } from "./ConversationSourcesPanel";
import "./conversation-header.css";

function OutputsIcon() {
  return <LayoutList aria-hidden="true" />;
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
      {!outputsCollapsed && generatedOutputs.length === 0 ? <p className="kova-header-note">No outputs yet.</p> : null}
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
        onOpenAttachment={() => {}}
      />
    </>
  );

  return (
    <>
      <div className={`kova-conversation-actions${compact ? " kova-conversation-actions-compact" : ""}`}>
        <Popover open={outputsOpen} onOpenChange={setOutputsOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              ref={outputsRef}
              className="kova-conversation-icon"
              aria-label="Activity"
              title="Activity"
            >
              <OutputsIcon />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="kova-conversation-outputs"
            onCloseAutoFocus={(event) => {
              if (dialogOpeningRef.current) {
                event.preventDefault();
                dialogOpeningRef.current = false;
              }
            }}
          >
            {activityContent}
          </PopoverContent>
        </Popover>
        {!compact && (
          <button
            type="button"
            ref={shareRef}
            className="kova-conversation-share"
            onClick={() => {
              if (restrictedTemporary) {
                setDialog("share-restricted");
                return;
              }
              onShare(shareRef.current);
            }}
          >
            <Share aria-hidden="true" />
            <span>Share</span>
          </button>
        )}
      </div>
      <Dialog open={dialog === "share-restricted"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sharing is unavailable</DialogTitle>
            <DialogDescription>
              Temporary chats cannot be shared. Start a saved chat to share it.
            </DialogDescription>
          </DialogHeader>
          <div className="kova-header-dialog-buttons">
            <Button variant="outline" onClick={() => setDialog(null)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(selectedOutput)}
        onOpenChange={(open) => {
          if (!open) setSelectedOutput(null);
        }}
      >
        <DialogContent onCloseAutoFocus={restoreFocus} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{selectedOutput?.name ?? "Output"}</DialogTitle>
            <DialogDescription>{selectedOutput?.label}</DialogDescription>
          </DialogHeader>
          {selectedOutput?.kind === "image" && selectedOutput.source ? (
            <img
              src={selectedOutput.source}
              alt=""
              className="kova-header-image-preview"
            />
          ) : selectedOutput && selectedOutput.kind !== "image" ? (
            <pre className="kova-header-text-preview">{selectedOutput.content}</pre>
          ) : null}
          {selectedOutput ? (
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
