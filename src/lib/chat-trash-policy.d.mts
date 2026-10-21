import type { Conversation } from "./chat-store";
export type TrashEntry = { conversation: Conversation; deletedAt: number; expiresAt: number };
export type TrashState = { retentionMs: number; entries: TrashEntry[] };
export const DAY_MS: number;
export const DEFAULT_TRASH_RETENTION_MS: number;
export const TRASH_RETENTION_OPTIONS: readonly { label: string; value: number }[];
export function validateRetention(value: number): number;
export function customRetention(amount: string, unit: string): number;
export function retentionPreview(
  state: TrashState,
  duration: number,
  now: number,
): { requiresConfirmation: boolean; expired: TrashEntry[]; next: TrashState };
export function expireTrash(state: TrashState, now: number): TrashState;
