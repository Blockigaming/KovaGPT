import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useUser } from "@/components/auth/ClerkSafe";
import {
  activateChatBranch,
  createChatBranch,
  listChatBranches,
  type ChatBranchDto,
} from "@/lib/chat-workspace.functions";
import {
  activateLocalBranch,
  localBranches,
  saveLocalBranch,
} from "@/lib/local-chat-workspace.mjs";
import { safeBrowserStorage } from "@/lib/principal-browser-storage.mjs";

export type BranchView = {
  id: string;
  /** The conversation this branch displays; equals the root chat id for the original. */
  conversationId: string;
  label: string | null;
  branchFromMessageId: string | null;
  branchFromMessageIndex: number | null;
  parentBranchId: string | null;
  active: boolean;
  createdAt: string;
  /** True when the branch lives in the account, false for device-only records. */
  durable: boolean;
};

function fromDto(row: ChatBranchDto): BranchView {
  return {
    id: row.id,
    conversationId: row.conversationId,
    label: row.label,
    branchFromMessageId: row.branchFromMessageId,
    branchFromMessageIndex: row.branchFromMessageIndex,
    parentBranchId: row.parentBranchId,
    active: row.active,
    createdAt: row.createdAt,
    durable: true,
  };
}

/**
 * Durable chat branches for signed-in users, with a bounded device-only
 * fallback for guests. Temporary Chat records nothing and reports an empty tree
 * so the UI can say so honestly.
 *
 * `rootChatId` is the stable root conversation id of the branch family: every
 * branch row (including the original) maps to a real conversation id, so the
 * caller can switch what is actually displayed rather than only flip a flag.
 */
export function useChatBranches(rootChatId: string | null, temporary = false) {
  const { isSignedIn } = useUser();
  const listFn = useServerFn(listChatBranches);
  const createFn = useServerFn(createChatBranch);
  const activateFn = useServerFn(activateChatBranch);

  const [branches, setBranches] = useState<BranchView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persistent = Boolean(rootChatId) && !temporary;

  const refresh = useCallback(async () => {
    if (!rootChatId || temporary) {
      setBranches([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (isSignedIn) {
        const rows = await listFn({ data: { chatId: rootChatId } });
        setBranches(rows.map(fromDto));
      } else {
        setBranches(
          localBranches(safeBrowserStorage("localStorage"), rootChatId).map((row) => ({
            ...row,
            durable: false as const,
          })),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Branches could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [isSignedIn, listFn, rootChatId, temporary]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const persistBranch = useCallback(
    async (input: {
      conversationId: string;
      branchFromMessageId?: string | null;
      branchFromMessageIndex?: number;
      messageIds?: string[];
      label?: string | null;
      parentBranchId?: string | null;
      active?: boolean;
    }): Promise<BranchView | null> => {
      if (!persistent || !rootChatId) return null;
      if (isSignedIn) {
        const row = await createFn({
          data: {
            chatId: rootChatId,
            conversationId: input.conversationId,
            branchFromMessageId: input.branchFromMessageId ?? null,
            branchFromMessageIndex: input.branchFromMessageIndex,
            messageIds: input.messageIds ?? [],
            label: input.label ?? null,
            parentBranchId: input.parentBranchId ?? null,
            active: input.active !== false,
          },
        });
        const view = fromDto(row);
        setBranches((prev) => {
          const others = prev
            .filter((branch) => branch.id !== view.id)
            .map((branch) => (view.active ? { ...branch, active: false } : branch));
          return [...others, view];
        });
        return view;
      }
      const saved = saveLocalBranch(safeBrowserStorage("localStorage"), rootChatId, {
        id: `local-${Date.now().toString(36)}`,
        conversationId: input.conversationId,
        label: input.label ?? null,
        branchFromMessageId: input.branchFromMessageId ?? null,
        branchFromMessageIndex: input.branchFromMessageIndex ?? null,
        parentBranchId: input.parentBranchId ?? null,
        active: input.active !== false,
      });
      await refresh();
      return saved ? { ...saved, durable: false } : null;
    },
    [createFn, isSignedIn, persistent, refresh, rootChatId],
  );

  /**
   * Guarantees the original conversation has its own branch row, so the branch
   * list can always offer a truthful way back to the unbranched path.
   */
  const ensureRootBranch = useCallback(async (): Promise<BranchView | null> => {
    if (!persistent || !rootChatId) return null;
    const existing = branches.find((branch) => branch.conversationId === rootChatId);
    if (existing) return existing;
    return persistBranch({
      conversationId: rootChatId,
      label: "Original",
      active: true,
    });
  }, [branches, persistBranch, persistent, rootChatId]);

  const createBranch = useCallback(
    async (input: {
      conversationId: string;
      branchFromMessageId: string;
      branchFromMessageIndex?: number;
      messageIds?: string[];
      label?: string | null;
      parentBranchId?: string | null;
    }): Promise<BranchView | null> => {
      const root = await ensureRootBranch();
      return persistBranch({
        ...input,
        parentBranchId: input.parentBranchId ?? root?.id ?? null,
        active: true,
      });
    },
    [ensureRootBranch, persistBranch],
  );

  const activate = useCallback(
    async (branchId: string) => {
      if (!persistent || !rootChatId) return null;
      if (!branchId) throw new Error("Select a branch first.");
      if (isSignedIn) {
        const row = await activateFn({ data: { chatId: rootChatId, branchId } });
        const view = fromDto(row);
        setBranches((prev) => prev.map((branch) => ({ ...branch, active: branch.id === view.id })));
        return view;
      }
      const saved = activateLocalBranch(safeBrowserStorage("localStorage"), rootChatId, branchId);
      if (!saved) throw new Error("That branch no longer exists on this device.");
      await refresh();
      return { ...saved, durable: false as const };
    },
    [activateFn, isSignedIn, persistent, refresh, rootChatId],
  );

  const activeBranch = useMemo(() => branches.find((branch) => branch.active) ?? null, [branches]);

  return {
    branches,
    activeBranch,
    loading,
    error,
    refresh,
    createBranch,
    activate,
    persistent,
    rootChatId,
  };
}
