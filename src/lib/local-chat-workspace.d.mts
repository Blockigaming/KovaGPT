export const LOCAL_WORKSPACE_STORAGE_KEY: string;
export const LOCAL_MAX_CHATS: number;
export const LOCAL_MAX_VERSIONS_PER_MESSAGE: number;
export const LOCAL_MAX_CONTENT_CHARS: number;
export const LOCAL_MAX_RULES_CHARS: number;
export const LOCAL_MAX_BRANCHES_PER_CHAT: number;

export type LocalStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type LocalVersion = {
  id: string;
  version: number;
  content: string;
  originalContent: string | null;
  editInstruction: string | null;
  source: string;
  createdAt: string;
  durable: false;
};

export type LocalRules = { instructions: string; enabled: boolean; updatedAt: string };

export type LocalBranch = {
  id: string;
  label: string | null;
  branchFromMessageId: string | null;
  branchFromMessageIndex: number | null;
  parentBranchId: string | null;
  active: boolean;
  createdAt: string;
};

export function parseWorkspaceState(raw: string | null): { chats: Record<string, unknown> };
export function readWorkspace(storage: LocalStorageLike | null): { chats: Record<string, unknown> };
export function writeWorkspace(
  storage: LocalStorageLike | null,
  state: { chats: Record<string, unknown> },
): boolean;
export function localVersions(
  storage: LocalStorageLike | null,
  chatId: string,
  messageId: string,
): LocalVersion[];
export function saveLocalVersion(
  storage: LocalStorageLike | null,
  chatId: string,
  messageId: string,
  input: {
    content: string;
    originalContent?: string | null;
    editInstruction?: string | null;
    source?: string;
  },
): LocalVersion;
export function localRules(storage: LocalStorageLike | null, chatId: string): LocalRules | null;
export function saveLocalRules(
  storage: LocalStorageLike | null,
  chatId: string,
  input: { instructions: string; enabled?: boolean },
): LocalRules;
export function clearLocalRules(storage: LocalStorageLike | null, chatId: string): null;
export function localBranches(storage: LocalStorageLike | null, chatId: string): LocalBranch[];
export function saveLocalBranch(
  storage: LocalStorageLike | null,
  chatId: string,
  branch: Partial<LocalBranch> & { id: string },
): LocalBranch | null;
export function activateLocalBranch(
  storage: LocalStorageLike | null,
  chatId: string,
  branchId: string,
): LocalBranch | null;
