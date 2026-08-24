export const MAX_CHAT_ID_LENGTH: number;
export const MAX_MESSAGE_ID_LENGTH: number;
export const MAX_MESSAGE_CONTENT_LENGTH: number;
export const MAX_EDIT_INSTRUCTION_LENGTH: number;
export const MAX_RULES_LENGTH: number;
export const MAX_LABEL_LENGTH: number;
export const MAX_VERSIONS_PER_MESSAGE: number;
export const MAX_BRANCHES_PER_CHAT: number;
export const MAX_PINS_PER_CHAT: number;
export const MAX_BRANCH_MESSAGE_IDS: number;
export const MAX_PINNED_CONTEXT_CHARS: number;
export const MAX_PINNED_ITEM_CHARS: number;
export const MAX_CONVERSATION_ID_LENGTH: number;
export const PIN_STATUS_AVAILABLE: "active";

export type MessageVersionSource = "original" | "inline_edit" | "retry" | "branch_edit";
export type PinSourceType = "library" | "project_file";
export type PinStatus = "active" | "indexing" | "failed" | "permission_lost" | "deleted";

export const MESSAGE_VERSION_SOURCES: readonly MessageVersionSource[];
export const PIN_SOURCE_TYPES: readonly PinSourceType[];
export const PIN_STATUSES: readonly PinStatus[];

export function parseChatId(value: unknown): string;
export function parseMessageId(value: unknown, label?: string): string;
export function parseConversationId(value: unknown): string;
export function parseUuid(value: unknown, label?: string): string;

export function parseMessageVersionInput(input: unknown): {
  chatId: string;
  messageId: string;
  branchId: string | null;
  selectionStart: number | null;
  selectionEnd: number | null;
  source: MessageVersionSource;
  instruction: string | null;
  content: string;
  originalContent: string | null;
  accepted: boolean;
};

export function parseMessageIds(value: unknown): string[];

export function parseBranchInput(input: unknown): {
  chatId: string;
  conversationId: string;
  parentBranchId: string | null;
  branchFromParentMessageId: string | null;
  branchFromMessageId: string | null;
  branchFromMessageIndex: number | null;
  messageIds: string[];
  label: string | null;
  active: boolean;
};

export function parseBranchActivationInput(input: unknown): {
  chatId: string;
  branchId: string;
};

export function parseCustomRulesInput(input: unknown): {
  chatId: string;
  instructions: string;
  enabled: boolean;
};

export function parsePinInput(input: unknown): {
  chatId: string;
  sourceType: PinSourceType;
  sourceId: string;
  projectId: string | null;
  status: PinStatus;
};

export function parsePinStatusInput(input: unknown): {
  chatId: string;
  pinId: string;
  status: PinStatus;
};

export function parseUnpinInput(input: unknown): { chatId: string; pinId: string };

export type PinnedContextItem = {
  pinId: string;
  sourceType: PinSourceType;
  sourceId: string;
  projectId: string | null;
  status: PinStatus;
  name: string;
  content: string;
};

export function budgetPinnedContext(
  items: PinnedContextItem[],
  options?: { totalChars?: number; itemChars?: number; maxItems?: number },
): {
  items: (PinnedContextItem & { truncated: boolean; includedChars: number })[];
  usedChars: number;
  totalBudget: number;
  truncatedCount: number;
  skippedCount: number;
  truncated: boolean;
};

export function describePinStatus(status: PinStatus | string): string;

export type InstructionScope = "global" | "project" | "chat";
export type InstructionLayer = { scope: InstructionScope; text: string };

export function composeInstructionLayers(input?: {
  global?: string | null;
  project?: string | null;
  chat?: string | null;
}): InstructionLayer[];

export function renderInstructionLayers(layers: InstructionLayer[]): string;
