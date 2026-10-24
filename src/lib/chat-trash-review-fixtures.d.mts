import type { TrashEntry } from "./chat-trash-policy.mjs";
export function createTrashReviewFixtures(now?: number): {
  retentionMs: number;
  deleted: TrashEntry;
  expiringSoon: TrashEntry;
  expired: TrashEntry;
  restored: TrashEntry & { restoredAt: number };
};
