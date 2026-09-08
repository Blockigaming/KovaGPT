import { createHash } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type FeedbackQuery = {
  select: (columns: string) => FeedbackQuery;
  upsert: (
    value: Record<string, unknown>,
    options: { onConflict: string },
  ) => Promise<{ error: unknown }>;
  delete: () => FeedbackQuery;
  eq: (column: string, value: unknown) => FeedbackQuery;
  in: (column: string, values: unknown[]) => FeedbackQuery;
  then: PromiseLike<{ error: unknown }>["then"];
};

const FeedbackInput = z.object({
  expectedOwnerId: z.string().uuid(),
  messageId: z.string().trim().min(1).max(200),
  rating: z.enum(["up", "down"]).nullable(),
  contextExcerpt: z.string().max(2_000).optional(),
});

const FeedbackBatchInput = z.object({
  expectedOwnerId: z.string().uuid(),
  messageIds: z
    .array(z.string().trim().min(1).max(200))
    .min(1)
    .max(200)
    .transform((messageIds) => [...new Set(messageIds)]),
});

function feedbackKey(ownerId: string, messageId: string): string {
  return createHash("sha256").update(`${ownerId}:${messageId}`).digest("hex");
}

function assertExpectedOwner(expectedOwnerId: string, actualOwnerId: string): void {
  if (expectedOwnerId !== actualOwnerId) {
    throw new Error("Your account changed. Please try again.");
  }
}

export const getResponseFeedbackBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => FeedbackBatchInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ratings: Record<string, "up" | "down"> }> => {
    assertExpectedOwner(data.expectedOwnerId, context.userId);
    const table = (context.supabase as unknown as { from: (name: string) => FeedbackQuery }).from(
      "feedback_submissions",
    );
    const { data: rows, error } = await (table
      .select("message_id,rating")
      .eq("owner_id", context.userId)
      .in("message_id", data.messageIds) as unknown as Promise<{
      data: { message_id?: unknown; rating?: unknown }[] | null;
      error: unknown;
    }>);
    if (error) throw new Error("Feedback could not be loaded.");
    const requested = new Set(data.messageIds);
    const ratings = Object.create(null) as Record<string, "up" | "down">;
    for (const row of rows ?? []) {
      if (
        typeof row.message_id === "string" &&
        requested.has(row.message_id) &&
        (row.rating === "up" || row.rating === "down")
      ) {
        ratings[row.message_id] = row.rating;
      }
    }
    return { ratings };
  });

export const submitResponseFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => FeedbackInput.parse(input))
  .handler(async ({ data, context }) => {
    assertExpectedOwner(data.expectedOwnerId, context.userId);
    const table = (context.supabase as unknown as { from: (name: string) => FeedbackQuery }).from(
      "feedback_submissions",
    );
    const key = feedbackKey(context.userId, data.messageId);
    if (data.rating === null) {
      const { error } = await table
        .delete()
        .eq("owner_id", context.userId)
        .eq("duplicate_key", key);
      if (error) throw new Error("Feedback could not be removed.");
      return { saved: false };
    }
    const { error } = await table.upsert(
      {
        owner_id: context.userId,
        message_id: data.messageId,
        rating: data.rating,
        attach_context: Boolean(data.contextExcerpt),
        context_excerpt: data.contextExcerpt ?? null,
        duplicate_key: key,
      },
      { onConflict: "owner_id,duplicate_key" },
    );
    if (error) throw new Error("Feedback could not be saved.");
    return { saved: true };
  });
