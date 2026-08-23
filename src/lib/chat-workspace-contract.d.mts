export const MAX_CHAT_ID_LENGTH: number;
export const MAX_MESSAGE_CONTENT_LENGTH: number;
export const MAX_INSTRUCTION_LENGTH: number;
export const MAX_RULES_LENGTH: number;
export const MAX_LABEL_LENGTH: number;
export const MAX_FILE_NAME_LENGTH: number;
export const MAX_VERSIONS_PER_MESSAGE: number;
export const MAX_BRANCHES_PER_CHAT: number;
export const MAX_PINS_PER_CHAT: number;

export function parseChatId(value: unknown): string;
export function parseUuid(value: unknown, label?: string): string;

export function parseMessageVersionInput(input: unknown): {
  chatId: string;
  messageId: string;
  content: string;
  instruction: string | null;
  selectionStart: number | null;
  selectionEnd: number | null;
};

export function parseBranchInput(input: unknown): {
  chatId: string;
  label: string | null;
  parentMessageId: string | null;
  originMessageId: string | null;
  isActive: boolean;
};

export function parseCustomRulesInput(input: unknown): {
  chatId: string;
  rules: string;
  enabled: boolean;
};

export function parsePinInput(input: unknown): {
  chatId: string;
  fileId: string | null;
  fileName: string | null;
  projectId: string | null;
};

export function parseUnpinInput(input: unknown): { chatId: string; pinId: string };

export type InstructionScope = "global" | "project" | "chat";
export type InstructionLayer = { scope: InstructionScope; text: string };

export function composeInstructionLayers(input?: {
  global?: string | null;
  project?: string | null;
  chat?: string | null;
}): InstructionLayer[];

export function renderInstructionLayers(layers: InstructionLayer[]): string;
