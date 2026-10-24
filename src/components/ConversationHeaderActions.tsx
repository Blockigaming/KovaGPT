import { lazy, Suspense, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Archive,
  File,
  FileText,
  Image,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Share,
  Trash2,
  Download,
  Search,
  Paperclip,
  ArrowLeft,
  Files,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { exportConversationMarkdown, type Conversation } from "@/lib/chat-store";
import { conversationOutputs, type ConversationOutput } from "@/lib/conversation-outputs";
import { downloadBytes, safeDocumentFilename } from "@/lib/writing-export/common";
import { restoreDialogFocus } from "@/lib/dialog-return-focus";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { PluginsGlyph, LibraryGlyph, ProjectsGlyph } from "./SidebarIcons";
import "./conversation-header.css";

const ChatProjectDialog = lazy(() =>
  import("@/components/ChatProjectDialog").then((module) => ({
    default: module.ChatProjectDialog,
  })),
);

function focusAfterRemoval() {
  window.requestAnimationFrame(() => {
    if (document.activeElement === document.body || !document.activeElement?.isConnected)
      document
        .querySelector<HTMLTextAreaElement>('textarea[aria-label="Message KovaGPT"]')
        ?.focus();
  });
}

function OutputsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="5" cy="6" r="2.6" />
      <circle cx="5" cy="18" r="2.6" />
      <path d="M12 6h9M12 18h9" />
    </svg>
  );
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
  onRename,
  onTogglePin,
  onArchive,
  onDelete,
  onManagePlugins,
  onOpenContext,
  browserPresentation,
}: {
  browserPresentation?: {
    thumbnail: ReactNode;
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
  onArchive: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onManagePlugins: (trigger: HTMLButtonElement | null) => void;
  onOpenContext?: (trigger: HTMLButtonElement) => void;
}) {
  const { user, isLoaded, isSignedIn } = useUser();
  const sourceInventory = useMemo(
    () => conversationSources(conversation, isLoaded && isSignedIn ? (user?.id ?? null) : null),
    [conversation, isLoaded, isSignedIn, user?.id],
  );
  const hasSources =
    sourceInventory.web.length +
      sourceInventory.memory.length +
      sourceInventory.attachments.length +
      sourceInventory.browser.length >
    0;
  const [selectedBrowser, setSelectedBrowser] = useState<ConversationBrowserSource | null>(null);
  const [selectedMemory, setSelectedMemory] = useState<MemorySources | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [phoneMoreOpen, setPhoneMoreOpen] = useState(false);
  const phoneBackRef = useRef<HTMLDivElement>(null);
  const phoneMoreRef = useRef<HTMLDivElement>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const findMatches = findQuery.trim()
    ? conversation.messages.filter((message) =>
        message.content.toLocaleLowerCase().includes(findQuery.trim().toLocaleLowerCase()),
      )
    : [];
  const [outputsOpen, setOutputsOpen] = useState(false);
  const outputsHandoffRef = useRef(false);
  const [dialog, setDialog] = useState<"rename" | "delete" | "share-restricted" | null>(null);
  const [projectOpen, setProjectOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState(conversation.title);
  const [selectedOutput, setSelectedOutput] = useState<ConversationOutput | null>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
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
  const openDialog = (value: typeof dialog) => {
    rememberFocus(menuRef.current);
    if (value === "rename") setRenameTitle(conversation.title);
    setDialog(value);
  };
  const openOutputs = () => {
    outputsHandoffRef.current = true;
    setMenuOpen(false);
  };
  const restrictedTemporary = Boolean(conversation.temporary);
  return (
    <>
      <div
        className={`kova-conversation-actions${compact ? " kova-conversation-actions-compact" : ""}`}
        aria-label="Conversation actions"
      >
        {onOpenContext && (
          <button
            type="button"
            className="spec400-toolbar-button spec400-header-context"
            aria-label="Open Context"
            title="Context"
            onClick={(event) => onOpenContext(event.currentTarget)}
          >
            <Files aria-hidden="true" />
            <span>Context</span>
          </button>
        )}
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
        <Popover open={outputsOpen} onOpenChange={setOutputsOpen}>
          <PopoverTrigger asChild>
            <button
              ref={outputsRef}
              type="button"
              className="kova-conversation-icon"
              aria-label="Outputs"
              title="Outputs"
            >
              <OutputsIcon />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={10}
            className="kova-conversation-outputs"
            aria-label="Outputs"
            onCloseAutoFocus={(event) => {
              if (!dialogOpeningRef.current) return;
              event.preventDefault();
              dialogOpeningRef.current = false;
            }}
          >
            {!hasSources && generatedOutputs.length === 0 && (
              <p className="kova-header-note">No recorded outputs or sources yet.</p>
            )}
            {generatedOutputs.length > 0 && (
              <>
                <h2>Outputs</h2>
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
              browserPreview={
                signedIn && userTier !== "free" ? browserPresentation?.thumbnail : undefined
              }
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
            {isStreaming ? (
              <p className="kova-header-note">
                A response is still being generated. Its output may change.
              </p>
            ) : null}
          </PopoverContent>
        </Popover>
        <DropdownMenu
          open={menuOpen}
          onOpenChange={(open) => {
            setMenuOpen(open);
            if (!open) setPhoneMoreOpen(false);
          }}
        >
          <DropdownMenuTrigger asChild>
            <button
              ref={menuRef}
              type="button"
              className="kova-conversation-icon"
              aria-label="More chat actions"
              title="More chat actions"
            >
              <MoreHorizontal aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            alignOffset={compact ? -36 : 0}
            collisionPadding={16}
            sideOffset={6}
            className={`kova-conversation-menu${compact ? " kova-conversation-menu-phone" : ""}`}
            onCloseAutoFocus={(event) => {
              if (outputsHandoffRef.current) {
                event.preventDefault();
                outputsHandoffRef.current = false;
                requestAnimationFrame(() => {
                  if (outputsRef.current?.isConnected) setOutputsOpen(true);
                });
                return;
              }
              if (!dialogOpeningRef.current) return;
              event.preventDefault();
              dialogOpeningRef.current = false;
            }}
          >
            {compact && <div className="kova-conversation-menu-title">{conversation.title}</div>}
            {compact && phoneMoreOpen ? (
              <>
                <DropdownMenuItem
                  ref={phoneBackRef}
                  onSelect={(event) => {
                    event.preventDefault();
                    setPhoneMoreOpen(false);
                    requestAnimationFrame(() => phoneMoreRef.current?.focus());
                  }}
                >
                  <ArrowLeft aria-hidden="true" />
                  Back
                </DropdownMenuItem>
                <DropdownMenuSeparator />

                <DropdownMenuItem onSelect={() => openDialog("rename")}>
                  <Pencil aria-hidden="true" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    rememberFocus(menuRef.current);
                    onManagePlugins(menuRef.current);
                  }}
                >
                  <PluginsGlyph aria-hidden="true" />
                  Plugins
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={restrictedTemporary || !signedIn || isStreaming}
                  onSelect={() => {
                    rememberFocus(menuRef.current);
                    setProjectOpen(true);
                  }}
                >
                  <ProjectsGlyph aria-hidden="true" />
                  Add copy to project
                </DropdownMenuItem>
                {conversation.messages.some(
                  (message) =>
                    message.role === "user" &&
                    message.attachments?.some((attachment) => attachment.kind === "image"),
                ) && (
                  <DropdownMenuItem asChild disabled={navigationBlocked}>
                    <Link
                      to="/discovery"
                      search={{ mode: "images" }}
                      onClick={(event) => {
                        if (navigationBlocked) event.preventDefault();
                      }}
                      title="Search by description. Your attached image is not sent to search."
                    >
                      <Image aria-hidden="true" /> Find similar images
                    </Link>
                  </DropdownMenuItem>
                )}
              </>
            ) : (
              <>
                {compact && (
                  <DropdownMenuItem
                    onSelect={() => {
                      rememberFocus(menuRef.current);
                      if (restrictedTemporary || !signedIn) setDialog("share-restricted");
                      else onShare(menuRef.current);
                    }}
                  >
                    <Share aria-hidden="true" />
                    Share
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className={compact ? "kova-mobile-secondary" : undefined}
                  onSelect={() => openDialog("rename")}
                >
                  <Pencil aria-hidden="true" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem disabled={restrictedTemporary} onSelect={onTogglePin}>
                  {conversation.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
                  {conversation.pinned ? "Unpin" : "Pin"}
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className={compact ? "kova-mobile-secondary" : undefined}>
                    <PluginsGlyph aria-hidden="true" />
                    Plugins
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="kova-conversation-submenu">
                    <p className="kova-header-note">
                      {restrictedTemporary && conversation.temporaryContext !== "personalized"
                        ? "Connected apps are off for this temporary chat."
                        : "Review your connected apps and their permissions."}
                    </p>
                    <DropdownMenuItem
                      onSelect={() => {
                        rememberFocus(menuRef.current);
                        onManagePlugins(menuRef.current);
                      }}
                    >
                      <PluginsGlyph aria-hidden="true" />
                      Manage plugins
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                {!compact && <DropdownMenuSeparator />}
                {(!compact || sourceInventory.attachments.length > 0) && (
                  <DropdownMenuItem onSelect={openOutputs}>
                    {compact ? (
                      <Paperclip aria-hidden="true" />
                    ) : (
                      <LibraryGlyph aria-hidden="true" />
                    )}
                    {compact ? "Uploaded files" : "View files in chat"}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  disabled={isStreaming}
                  onSelect={() =>
                    downloadBytes(
                      new TextEncoder().encode(exportConversationMarkdown(conversation)),
                      "text/markdown;charset=utf-8",
                      safeDocumentFilename(conversation.title, "md"),
                    )
                  }
                >
                  <Download aria-hidden="true" />
                  Export chat
                </DropdownMenuItem>
                {compact && (
                  <DropdownMenuItem
                    onSelect={() => {
                      rememberFocus(menuRef.current);
                      setFindQuery("");
                      setFindOpen(true);
                    }}
                  >
                    <Search aria-hidden="true" />
                    Find in chat
                  </DropdownMenuItem>
                )}
                {!compact &&
                  conversation.messages.some(
                    (message) =>
                      message.role === "user" &&
                      message.attachments?.some((attachment) => attachment.kind === "image"),
                  ) && (
                    <DropdownMenuItem asChild disabled={navigationBlocked}>
                      <Link
                        to="/discovery"
                        search={{ mode: "images" }}
                        onClick={(event) => {
                          if (navigationBlocked) event.preventDefault();
                        }}
                        title="Search by description. Your attached image is not sent to search."
                      >
                        <Image aria-hidden="true" /> Find similar images
                      </Link>
                    </DropdownMenuItem>
                  )}
                {compact && (
                  <DropdownMenuItem
                    ref={phoneMoreRef}
                    onSelect={(event) => {
                      event.preventDefault();
                      setPhoneMoreOpen(true);
                      requestAnimationFrame(() => phoneBackRef.current?.focus());
                    }}
                  >
                    <MoreHorizontal aria-hidden="true" />
                    More options
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={restrictedTemporary || isStreaming}
                  onSelect={() => {
                    void Promise.resolve(onArchive()).then(focusAfterRemoval);
                  }}
                >
                  <Archive aria-hidden="true" />
                  Archive
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={isStreaming}
                  className="kova-conversation-delete"
                  onSelect={() => openDialog("delete")}
                >
                  <Trash2 aria-hidden="true" />
                  Delete
                </DropdownMenuItem>
                {!compact && <DropdownMenuSeparator />}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className={compact ? "kova-mobile-secondary" : undefined}>
                    <ProjectsGlyph aria-hidden="true" />
                    Move to project
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="kova-conversation-submenu">
                    <p className="kova-header-note">
                      {restrictedTemporary
                        ? "Temporary chats cannot be moved or copied to a project."
                        : !signedIn
                          ? "Sign in to copy chat text to one of your projects."
                          : "Moving chats isn’t supported. You can copy this chat’s text to a project; attachments stay here."}
                    </p>
                    <DropdownMenuItem
                      disabled={restrictedTemporary || !signedIn || isStreaming}
                      onSelect={() => {
                        rememberFocus(menuRef.current);
                        setProjectOpen(true);
                      }}
                    >
                      <ProjectsGlyph aria-hidden="true" />
                      Add copy to project
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                {restrictedTemporary ? (
                  <p className="kova-header-note">Temporary chats cannot be pinned or archived.</p>
                ) : isStreaming ? (
                  <p className="kova-header-note">
                    Finish the response before archiving, deleting, or copying this chat.
                  </p>
                ) : null}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Dialog open={findOpen} onOpenChange={setFindOpen}>
        <DialogContent className="sm:max-w-md kova-find-chat" onCloseAutoFocus={restoreFocus}>
          <DialogTitle>Find in chat</DialogTitle>
          <DialogDescription>Search text in this conversation.</DialogDescription>
          <input
            autoFocus
            type="search"
            aria-label="Find in chat"
            className="kova-header-title-input"
            value={findQuery}
            onChange={(event) => setFindQuery(event.target.value)}
          />
          <p role="status" className="kova-header-note">
            {findQuery.trim()
              ? `${findMatches.length} matching message${findMatches.length === 1 ? "" : "s"}`
              : "Enter a word or phrase."}
          </p>
          <div className="kova-find-results">
            {findMatches.map((message) => (
              <button
                key={message.id}
                className="kova-find-result"
                onClick={() => {
                  const target = document.getElementById(`message-${message.id}`);
                  if (target) {
                    target.tabIndex = -1;
                    rememberFocus(target);
                    target.scrollIntoView({ block: "center", behavior: "smooth" });
                  }
                  setFindOpen(false);
                }}
              >
                <span>{message.role === "user" ? "You" : "KovaGPT"}</span>
                <p>
                  {message.content.slice(
                    Math.max(
                      0,
                      message.content
                        .toLocaleLowerCase()
                        .indexOf(findQuery.trim().toLocaleLowerCase()) - 50,
                    ),
                    Math.max(
                      0,
                      message.content
                        .toLocaleLowerCase()
                        .indexOf(findQuery.trim().toLocaleLowerCase()) - 50,
                    ) + 180,
                  )}
                </p>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent className="sm:max-w-md" onCloseAutoFocus={restoreFocus}>
          <DialogTitle>
            {dialog === "rename"
              ? "Rename chat"
              : dialog === "delete"
                ? "Delete chat?"
                : "Sharing unavailable"}
          </DialogTitle>
          <DialogDescription>
            {dialog === "rename"
              ? "Choose a title for this conversation."
              : dialog === "delete"
                ? "Remove this chat from your history. You can undo immediately after deleting."
                : restrictedTemporary
                  ? "Temporary chats cannot be shared. Start a regular chat to share a conversation."
                  : "Sign in to share this conversation."}
          </DialogDescription>
          {dialog === "rename" ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!renameTitle.trim()) return;
                onRename(renameTitle.trim());
                setDialog(null);
              }}
            >
              <label
                className="sr-only"
                htmlFor={`header-rename-${compact ? "mobile" : "desktop"}`}
              >
                Chat title
              </label>
              <input
                id={`header-rename-${compact ? "mobile" : "desktop"}`}
                autoFocus
                maxLength={160}
                className="kova-header-title-input"
                value={renameTitle}
                onChange={(event) => setRenameTitle(event.target.value)}
              />
              <div className="kova-header-dialog-buttons">
                <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!renameTitle.trim()}>
                  Save
                </Button>
              </div>
            </form>
          ) : (
            <div className="kova-header-dialog-buttons">
              <Button variant="outline" onClick={() => setDialog(null)}>
                {dialog === "delete" ? "Cancel" : "Close"}
              </Button>
              {dialog === "delete" ? (
                <Button
                  variant="destructive"
                  onClick={() => {
                    setDialog(null);
                    void Promise.resolve(onDelete()).then(focusAfterRemoval);
                  }}
                >
                  Delete
                </Button>
              ) : null}
            </div>
          )}
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
                {!signedIn
                  ? "Sign in with a paid plan to use Cloud browser."
                  : userTier === "free"
                    ? "Cloud browser is available on Plus and Pro. Your Free plan does not include browser sessions."
                    : "This record has no connected live view or owned session reference. Take over is available only from a confirmed Work browser session after its run is paused."}
              </p>
              <Button asChild variant="outline" className="min-h-11">
                <Link
                  to={signedIn && userTier !== "free" ? "/work" : "/pricing"}
                  preload={false}
                  onClick={(event) => {
                    if (navigationBlocked) event.preventDefault();
                  }}
                >
                  {signedIn && userTier !== "free" ? "Open Work browser controls" : "View plans"}
                </Link>
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
      {projectOpen ? (
        <Suspense
          fallback={
            <p role="status" className="sr-only">
              Loading project picker…
            </p>
          }
        >
          <ChatProjectDialog
            open
            conversation={conversation}
            onOpenChange={(open) => {
              setProjectOpen(open);
              if (!open)
                window.requestAnimationFrame(() =>
                  restoreDialogFocus(returnFocusRef.current, returnUrlRef.current),
                );
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
