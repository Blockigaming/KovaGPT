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
 */
export function useChatBranches(chatId: string | null, temporary = false) {
  const { isSignedIn } = useUser();
  const listFn = useServerFn(listChatBranches);
  const createFn = useServerFn(createChatBranch);
  const activateFn = useServerFn(activateChatBranch);

  const [branches, setBranches] = useState<BranchView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persistent = Boolean(chatId) && !temporary;

  const refresh = useCallback(async () => {
    if (!chatId || temporary) {
      setBranches([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (isSignedIn) {
        const rows = await listFn({ data: { chatId } });
        setBranches(rows.map(fromDto));
      } else {
        setBranches(
          localBranches(safeBrowserStorage("localStorage"), chatId).map((row) => ({
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
  }, [chatId, isSignedIn, listFn, temporary]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createBranch = useCallback(
    async (input: {
      branchFromMessageId: string;
      branchFromMessageIndex?: number;
      messageIds?: string[];
      label?: string | null;
      parentBranchId?: string | null;
    }): Promise<BranchView | null> => {
      if (!persistent || !chatId) return null;
      if (isSignedIn) {
        const row = await createFn({
          data: {
            chatId,
            branchFromMessageId: input.branchFromMessageId,
            branchFromMessageIndex: input.branchFromMessageIndex,
            messageIds: input.messageIds ?? [],
            label: input.label ?? null,
            parentBranchId: input.parentBranchId ?? null,
            active: true,
          },
        });
        const view = fromDto(row);
        setBranches((prev) => [
          ...prev.map((branch) => ({ ...branch, active: false })).filter((b) => b.id !== view.id),
          view,
        ]);
        return view;
      }
      const saved = saveLocalBranch(safeBrowserStorage("localStorage"), chatId, {
        id: `local-${Date.now().toString(36)}`,
        label: input.label ?? null,
        branchFromMessageId: input.branchFromMessageId,
        branchFromMessageIndex: input.branchFromMessageIndex ?? null,
        parentBranchId: input.parentBranchId ?? null,
        active: true,
      });
      await refresh();
      return saved ? { ...saved, durable: false } : null;
    },
    [chatId, createFn, isSignedIn, persistent, refresh],
  );

  const activate = useCallback(
    async (branchId: string) => {
      if (!persistent || !chatId) return null;
      if (!branchId) throw new Error("Select a branch first.");
      if (isSignedIn) {
        const row = await activateFn({ data: { chatId, branchId } });
        const view = fromDto(row);
        setBranches((prev) => prev.map((branch) => ({ ...branch, active: branch.id === view.id })));
        return view;
      }
      const saved = activateLocalBranch(safeBrowserStorage("localStorage"), chatId, branchId);
      if (!saved) throw new Error("That branch no longer exists on this device.");
      await refresh();
      return { ...saved, durable: false as const };
    },
    [activateFn, chatId, isSignedIn, persistent, refresh],
  );

  const activeBranch = useMemo(() => branches.find((branch) => branch.active) ?? null, [branches]);

  return { branches, activeBranch, loading, error, refresh, createBranch, activate, persistent };
}
