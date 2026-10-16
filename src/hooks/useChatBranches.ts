import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const EMPTY_BRANCHES: BranchView[] = [];

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
  const { isLoaded, isSignedIn, user } = useUser();
  const listFn = useServerFn(listChatBranches);
  const createFn = useServerFn(createChatBranch);
  const activateFn = useServerFn(activateChatBranch);

  const key = `${isLoaded}:${user?.id ?? (isSignedIn ? "pending" : "guest")}:${rootChatId}:${temporary}`;
  const scope = useRef({ key, active: true, read: 0, mutation: false, rows: [] as BranchView[] });
  if (scope.current.key !== key)
    scope.current = { key, active: true, read: 0, mutation: false, rows: [] };
  const current = scope.current;
  const isCurrent = useCallback(() => scope.current === current && current.active, [current]);
  const [snapshot, setSnapshot] = useState({ key, rows: [] as BranchView[] });
  const branches = snapshot.key === key ? snapshot.rows : EMPTY_BRANCHES;
  const setBranches = useCallback(
    (update: BranchView[] | ((previous: BranchView[]) => BranchView[])) => {
      if (!isCurrent()) return;
      current.rows = typeof update === "function" ? update(current.rows) : update;
      setSnapshot({ key: current.key, rows: current.rows });
    },
    [current, isCurrent],
  );
  useEffect(() => {
    current.active = true;
    return () => {
      current.active = false;
    };
  }, [current]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persistent =
    Boolean(rootChatId) && !temporary && isLoaded && (!isSignedIn || Boolean(user?.id));

  const refresh = useCallback(async () => {
    if (!isCurrent() || current.mutation) return;
    const sequence = ++current.read;
    if (!persistent || !rootChatId) {
      setBranches([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (isSignedIn) {
        const rows = await listFn({ data: { chatId: rootChatId } });
        if (!isCurrent() || sequence !== current.read) return;
        if (!Array.isArray(rows)) throw new Error("Branches could not be loaded.");
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
      if (!isCurrent() || sequence !== current.read) return;
      setError(
        err instanceof Error && err.message !== "h.map is not a function"
          ? err.message
          : "Branches could not be loaded.",
      );
    } finally {
      if (isCurrent() && sequence === current.read) setLoading(false);
    }
  }, [current, isCurrent, persistent, setBranches, isSignedIn, listFn, rootChatId]);

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
      if (!isCurrent() || !persistent || !rootChatId) return null;
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
        if (!isCurrent()) return null;
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
      setBranches(
        localBranches(safeBrowserStorage("localStorage"), rootChatId).map((row) => ({
          ...row,
          durable: false,
        })),
      );
      return saved ? { ...saved, durable: false } : null;
    },
    [createFn, isSignedIn, isCurrent, persistent, setBranches, rootChatId],
  );

  /**
   * Guarantees the original conversation has its own branch row, so the branch
   * list can always offer a truthful way back to the unbranched path.
   */
  const ensureRootBranch = useCallback(async (): Promise<BranchView | null> => {
    if (!persistent || !rootChatId) return null;
    const existing = current.rows.find((branch) => branch.conversationId === rootChatId);
    if (existing) return existing;
    return persistBranch({
      conversationId: rootChatId,
      label: "Original",
      active: true,
    });
  }, [current, persistBranch, persistent, rootChatId]);

  const createBranch = useCallback(
    async (input: {
      conversationId: string;
      branchFromMessageId: string;
      branchFromMessageIndex?: number;
      messageIds?: string[];
      label?: string | null;
      parentBranchId?: string | null;
    }): Promise<BranchView | null> => {
      if (!isCurrent() || current.mutation) return null;
      current.mutation = true;
      current.read++;
      try {
        const root = await ensureRootBranch();
        if (!isCurrent() || !root) return null;
        return await persistBranch({
          ...input,
          parentBranchId: input.parentBranchId ?? root.id,
          active: true,
        });
      } catch (error) {
        if (!isCurrent()) return null;
        throw error;
      } finally {
        current.mutation = false;
        if (isCurrent()) setLoading(false);
      }
    },
    [current, isCurrent, ensureRootBranch, persistBranch],
  );

  const activate = useCallback(
    async (branchId: string) => {
      if (!isCurrent() || !persistent || !rootChatId) return null;
      if (!branchId) throw new Error("Select a branch first.");
      if (current.mutation) return null;
      current.mutation = true;
      current.read++;
      try {
        if (isSignedIn) {
          const row = await activateFn({ data: { chatId: rootChatId, branchId } });
          if (!isCurrent()) return null;
          const view = fromDto(row);
          setBranches((prev) =>
            prev.map((branch) => ({ ...branch, active: branch.id === view.id })),
          );
          return view;
        }
        const saved = activateLocalBranch(safeBrowserStorage("localStorage"), rootChatId, branchId);
        if (!saved) throw new Error("That branch no longer exists on this device.");
        setBranches(
          localBranches(safeBrowserStorage("localStorage"), rootChatId).map((row) => ({
            ...row,
            durable: false,
          })),
        );
        return { ...saved, durable: false as const };
      } catch (error) {
        if (!isCurrent()) return null;
        throw error;
      } finally {
        current.mutation = false;
        if (isCurrent()) setLoading(false);
      }
    },
    [activateFn, current, isCurrent, isSignedIn, persistent, setBranches, rootChatId],
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
