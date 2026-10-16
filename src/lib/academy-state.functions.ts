import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import {
  ACADEMY_ACCOUNT_PERSISTENCE_ENABLED,
  AcademyBody,
  AcademyRecord,
  AcademyTopic,
  type AcademyRecordValue,
} from "./academy-state-policy.mjs";
import { PUBLIC_ACADEMY_PAGES } from "./public-academy-content";
type Result = { data: unknown; error: { code?: string; message?: string } | null };
type Query = PromiseLike<Result> & {
  select(columns: string): Query;
  eq(key: string, value: unknown): Query;
  is(key: string, value: null): Query;
  order(key: string): Query;
  limit(value: number): Query;
  abortSignal(signal: AbortSignal): Query;
};
type Db = { from(name: string): Query; rpc(name: string, args: Record<string, unknown>): Query };
const Identity = z.object({
  expectedUserId: z.string().uuid(),
  topic: AcademyTopic.refine(
    (topic) => PUBLIC_ACADEMY_PAGES.some((page) => page.slug === topic),
    "Unknown Academy topic",
  ),
});
async function guard(expected: string, actual: string, mutation: boolean) {
  if (!ACADEMY_ACCOUNT_PERSISTENCE_ENABLED)
    throw new Error("Academy account saving is paused for this launch.");
  if (expected !== actual) throw new Error("Your account changed. Reopen Academy.");
  const request = getRequest();
  if (mutation && isCrossSiteMutation(request)) throw new Error("Cross-site request blocked.");
  const rate = await consumeApplicationRateLimit({
    identity: `user:${actual}`,
    action: mutation ? "academy_write" : "academy_read",
    limit: mutation ? 20 : 60,
    windowSeconds: 60,
  });
  if (!rate.allowed) throw new Error("Academy is busy. Please try again shortly.");
  return AbortSignal.any([request.signal, AbortSignal.timeout(10000)]);
}

export const getAcademyState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Identity.strict().parse(input))
  .handler(async ({ data, context }): Promise<AcademyRecordValue | null> => {
    const signal = await guard(data.expectedUserId, context.userId, false);
    const result = await (context.supabase as unknown as Db)
      .from("academy_learning_state")
      .select("owner_id,topic,revision,body,updated_at")
      .eq("owner_id", context.userId)
      .eq("topic", data.topic)
      .limit(1)
      .abortSignal(signal);
    if (result.error || !Array.isArray(result.data) || result.data.length > 1)
      throw new Error("Account learning state could not be loaded. Device notes are preserved.");
    if (!result.data.length) return null;
    const row = AcademyRecord.parse(result.data[0]);
    if (row.owner_id !== context.userId || row.topic !== data.topic)
      throw new Error("Account learning state identity mismatch.");
    return row;
  });
export const saveAcademyState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    Identity.extend({
      expectedRevision: z.number().int().nonnegative(),
      mutationId: z.string().uuid(),
      body: AcademyBody,
    })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<AcademyRecordValue> => {
    const signal = await guard(data.expectedUserId, context.userId, true);
    const result = await (context.supabase as unknown as Db)
      .rpc("save_academy_learning_state", {
        p_topic: data.topic,
        p_expected_revision: data.expectedRevision,
        p_mutation_id: data.mutationId,
        p_body: data.body,
      })
      .abortSignal(signal);
    if (result.error) {
      if (result.error.code === "40001")
        throw new Error(
          "Account notes changed elsewhere. Refresh the account version before choosing which draft to save.",
        );
      throw new Error(
        "Account save was not confirmed. Your device draft is preserved; retry the same save.",
      );
    }
    const row = AcademyRecord.parse(result.data);
    if (
      row.owner_id !== context.userId ||
      row.topic !== data.topic ||
      JSON.stringify(row.body) !== JSON.stringify(data.body)
    )
      throw new Error("Account save acknowledgement did not match this draft.");
    return row;
  });
