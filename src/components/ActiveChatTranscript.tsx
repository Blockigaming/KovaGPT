import {
  useCallback,
  useEffect,
  useLayoutEffect,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import { Sliders } from "lucide-react";
import { toast } from "sonner";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatBranchBar } from "@/components/ChatBranchBar";
import { useChatBranches } from "@/hooks/useChatBranches";
import { branchConversation, type Conversation, type Message } from "@/lib/chat-store";
import { createTranscriptReadingAnchorController } from "@/lib/chat-reading-anchor";

type ReadingController = ReturnType<typeof createTranscriptReadingAnchorController>;
export type TranscriptMessageRenderer = (
  message: Message,
  index: number,
  MessageComponent: typeof ChatMessage,
  onBranch: () => void,
) => ReactNode;

type ActiveChatTranscriptProps = {
  active: Conversation;
  conversations: Conversation[];
  setActiveId: (id: string | null) => void;
  setConversations: (next: SetStateAction<Conversation[]>) => void;
  isSignedIn: boolean;
  isStreaming: boolean;
  chatRulesActive: boolean;
  openChatWorkspace: (trigger: HTMLElement) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  nearBottomRef: RefObject<boolean>;
  readingAnchorControllerRef: RefObject<ReadingController | null>;
  transcriptScope: string;
  transcriptScopeRef: RefObject<string>;
  setShowJumpToLatest: (show: boolean) => void;
  renderMessage: TranscriptMessageRenderer;
};

/** Load transcript-only rendering and anchoring after a conversation is opened. */
export function ActiveChatTranscript({
  active,
  conversations,
  setActiveId,
  setConversations,
  isSignedIn,
  isStreaming,
  chatRulesActive,
  openChatWorkspace,
  scrollRef,
  nearBottomRef,
  readingAnchorControllerRef,
  transcriptScope,
  transcriptScopeRef,
  setShowJumpToLatest,
  renderMessage,
}: ActiveChatTranscriptProps) {
  // Branch rows are keyed by the family's root conversation, so a branched chat
  // and its original share one durable branch tree.
  const branchRootId = active.branchRootId ?? active.id;
  const branchState = useChatBranches(branchRootId, Boolean(active?.temporary));

  /**
   * Switching a branch must switch what the person is actually reading. If the
   * mapped conversation is not on this device we say so instead of pretending.
   */
  const activateBranch = useCallback(
    async (branchId: string) => {
      const element = scrollRef.current;
      if (transcriptScopeRef.current !== transcriptScope || !element) return false;
      const target = branchState.branches.find((branch) => branch.id === branchId);
      if (!target) throw new Error("That branch no longer exists.");
      const exists = conversations.some(
        (conversation) => conversation.id === target.conversationId,
      );
      if (!exists) {
        throw new Error("That branch's conversation isn't available on this device.");
      }
      await branchState.activate(branchId);
      if (transcriptScopeRef.current !== transcriptScope || scrollRef.current !== element)
        return false;
      setActiveId(target.conversationId);
      return true;
    },
    [branchState, conversations, setActiveId, scrollRef, transcriptScope, transcriptScopeRef],
  );

  const updateNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distance < 120;
    nearBottomRef.current = near;
    setShowJumpToLatest(!near && Boolean(active?.messages.length));
  }, [active?.messages.length]);

  const activeMessageCount = active.messages.length;
  const latestMessageContent = active.messages.at(-1)?.content;

  const hasTranscript = Boolean(activeMessageCount);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!hasTranscript || !element) return;
    const controller = createTranscriptReadingAnchorController(element, {
      isCurrent: () =>
        transcriptScopeRef.current === transcriptScope && scrollRef.current === element,
      isFollowingBottom: () => nearBottomRef.current,
    });
    readingAnchorControllerRef.current = controller;
    return () => {
      controller.dispose();
      if (readingAnchorControllerRef.current === controller)
        readingAnchorControllerRef.current = null;
    };
  }, [transcriptScope, hasTranscript]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (nearBottomRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: isStreaming ? "auto" : "smooth" });
      setShowJumpToLatest(false);
    } else {
      setShowJumpToLatest(true);
    }
  }, [activeMessageCount, latestMessageContent, isStreaming]);

  const branchMessage = (m: Message, i: number) => {
    const element = scrollRef.current;
    if (transcriptScopeRef.current !== transcriptScope || !element) return;
    if (isStreaming) {
      toast.message("Wait for this response to finish before branching");
      return;
    }
    try {
      const branched = branchConversation(active, m.id);
      const [owner, , ready] = JSON.parse(transcriptScope) as [string, string | null, boolean];
      const destinationScope = JSON.stringify([owner, branched.id, ready]);
      setConversations((prev) => [branched, ...prev]);
      setActiveId(branched.id);
      toast.success("Branched into a new chat");
      // The original path is untouched; record the branch point
      // so it survives a reload for signed-in users.
      void branchState
        .createBranch({
          conversationId: branched.id,
          branchFromMessageId: m.id,
          branchFromMessageIndex: i,
          messageIds: active.messages.slice(0, i + 1).map((msg) => msg.id),
          label: branched.title?.slice(0, 120) ?? null,
          parentBranchId: branchState.activeBranch?.id ?? null,
        })
        .catch((error) => {
          const currentScope = transcriptScopeRef.current;
          const stillOriginal = currentScope === transcriptScope && scrollRef.current === element;
          if (!stillOriginal && currentScope !== destinationScope) return;
          toast.error(
            error instanceof Error ? error.message : "The branch point could not be saved.",
          );
        });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not branch chat");
    }
  };

  return (
    <div
      ref={scrollRef}
      data-chat-transcript="true"
      onScroll={updateNearBottom}
      className="kova-conversation-scroll flex-1 overflow-y-auto overscroll-contain scroll-smooth pb-14 pt-5 lg:pb-20 lg:pt-8"
      aria-label="Conversation"
    >
      {active.branchOrigin && (
        <div className="mx-auto mb-5 flex w-[calc(100%-2rem)] max-w-[48rem] items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/45 px-3 py-2 text-sm">
          <div className="min-w-0">
            <span className="font-medium">Branched conversation</span>
            <span className="ml-1 text-muted-foreground">from {active.branchOrigin.title}</span>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-lg px-2.5 py-1.5 font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              const origin = active.branchOrigin;
              if (!origin) return;
              const sourceExists = conversations.some(
                (conversation) => conversation.id === origin.conversationId,
              );
              if (sourceExists) setActiveId(origin.conversationId);
              else toast.error("The source conversation is no longer available");
            }}
          >
            View source
          </button>
        </div>
      )}
      <ChatBranchBar
        branches={branchState.branches}
        activeBranch={branchState.activeBranch}
        loading={branchState.loading}
        error={branchState.error}
        onActivate={activateBranch}
        onRetry={branchState.refresh}
        durableHint={
          isSignedIn
            ? "Branching keeps the original path; sharing snapshots the active branch only."
            : "Branches are stored on this device until you sign in."
        }
      />
      {chatRulesActive && (
        <div className="mx-auto flex w-full max-w-[48rem] px-3 pt-2 lg:px-0">
          <button
            type="button"
            onClick={(event) => openChatWorkspace(event.currentTarget)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Sliders className="h-3.5 w-3.5" /> Chat rules are active
          </button>
        </div>
      )}
      {active.messages.map((m, i) => renderMessage(m, i, ChatMessage, () => branchMessage(m, i)))}
    </div>
  );
}
