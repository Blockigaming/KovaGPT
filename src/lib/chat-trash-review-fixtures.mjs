/** Deterministic local review data only. Never seeds real account history. */
import { DAY_MS, DEFAULT_TRASH_RETENTION_MS } from "./chat-trash-policy.mjs";
export function createTrashReviewFixtures(now = Date.now()) {
  const chat = (id, title) => ({
    id,
    title,
    mode: "instant",
    createdAt: now - 40 * DAY_MS,
    updatedAt: now - DAY_MS,
    messages: [
      { id: `${id}-message`, role: "user", content: "Local review fixture. No provider request." },
    ],
  });
  const entry = (id, title, deletedAt) => ({
    conversation: chat(id, title),
    deletedAt,
    expiresAt: deletedAt + DEFAULT_TRASH_RETENTION_MS,
  });
  return {
    retentionMs: DEFAULT_TRASH_RETENTION_MS,
    deleted: entry("review-trash-recent", "Weekend project ideas", now - DAY_MS),
    expiringSoon: entry(
      "review-trash-soon",
      "Trip packing checklist",
      now - DEFAULT_TRASH_RETENTION_MS + 3_600_000,
    ),
    expired: entry("review-trash-expired", "Expired local review chat", now - 31 * DAY_MS),
    restored: {
      conversation: chat("review-trash-restored", "Restored research notes"),
      deletedAt: now - 2 * DAY_MS,
      expiresAt: now + 28 * DAY_MS,
      restoredAt: now - DAY_MS,
    },
  };
}
