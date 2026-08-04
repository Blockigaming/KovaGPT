import { createHash } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type FeedbackQuery = {
  upsert: (
    value: Record<string, unknown>,
    options: { onConflict: string },
  ) => Promise<{ error: unknown }>;
  delete: () => FeedbackQuery;
  eq: (column: string, value: unknown) => FeedbackQuery;
  then: PromiseLike<{ error: unknown }>["then"];
};

const FeedbackInput = z.object({
  messageId: z.string().trim().min(1).max(200),
  rating: z.enum(["up", "down"]).nullable(),
  contextExcerpt: z.string().max(2_000).optional(),
});

export const submitResponseFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => FeedbackInput.parse(input))
  .handler(async ({ data, context }) => {
    const table = (context.supabase as unknown as { from: (name: string) => FeedbackQuery }).from(
      "feedback_submissions",
    );
    const key = createHash("sha256").update(`${context.userId}:${data.messageId}`).digest("hex");
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
