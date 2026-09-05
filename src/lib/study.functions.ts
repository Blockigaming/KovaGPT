import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { isCrossSiteMutation } from "@/lib/auth-security.mjs";
import { StudyState, type PracticeState } from "@/lib/study-policy.mjs";
export type StudyRecord = {
  id: string;
  owner_id: string;
  revision: number;
  creation_token: string;
  body: PracticeState | null;
  deleted_at: string | null;
  updated_at: string;
  title?: string;
};
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
const Identity = z.object({ expectedUserId: z.string().uuid() });
async function guard(expected: string, actual: string, mutation: boolean) {
  if (expected !== actual) throw new Error("Your account changed. Reopen Study.");
  const request = getRequest();
  if (mutation && isCrossSiteMutation(request)) throw new Error("Cross-site request blocked.");
  const rate = await consumeApplicationRateLimit({
    identity: `user:${actual}`,
    action: mutation ? "study_write" : "study_read",
    limit: mutation ? 20 : 60,
    windowSeconds: 60,
  });
  if (!rate.allowed) throw new Error("Study is busy. Please try again shortly.");
  return AbortSignal.any([request.signal, AbortSignal.timeout(10000)]);
}
export const listStudySets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Identity.parse(input))
  .handler(async ({ data, context }): Promise<StudyRecord[]> => {
    const signal = await guard(data.expectedUserId, context.userId, false);
    const result = await (context.supabase as unknown as Db)
      .from("study_sets")
      .select("id,owner_id,revision,creation_token,deleted_at,updated_at,title:body->deck->>title")
      .eq("owner_id", context.userId)
      .is("deleted_at", null)
      .order("id")
      .limit(101)
      .abortSignal(signal);
    if (result.error || !Array.isArray(result.data) || result.data.length > 100)
      throw new Error("Saved practice could not be loaded.");
    return result.data as StudyRecord[];
  });
export const saveStudySet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    Identity.extend({
      id: z.string().uuid(),
      expectedRevision: z.number().int().nonnegative(),
      mutationId: z.string().uuid(),
      creationToken: z.string().datetime({ offset: true }),
      body: StudyState.nullable(),
      remove: z.boolean(),
      temporary: z.literal(false),
    })
      .strict()
      .refine((x) => (x.remove ? x.body === null : x.body !== null))
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<StudyRecord | { creationExpired: true }> => {
    const signal = await guard(data.expectedUserId, context.userId, true);
    if (new TextEncoder().encode(JSON.stringify(data.body)).length > 180000)
      throw new Error("This practice set is too large. Export it or start a smaller set.");
    const result = await (context.supabase as unknown as Db)
      .rpc("save_study_set", {
        p_id: data.id,
        p_expected_revision: data.expectedRevision,
        p_mutation_id: data.mutationId,
        p_body: data.body,
        p_creation_token: data.creationToken,
        p_delete: data.remove,
      })
      .abortSignal(signal);
    if (result.error) {
      if (result.error.code === "40001" && result.error.message === "study_creation_expired")
        return { creationExpired: true };
      if (result.error.code === "40001")
        throw new Error("This set changed on another device. Reload it before saving.");
      if (result.error.code === "54000")
        throw new Error(
          "Wait a minute before retrying, or remove a saved set if you already have 100.",
        );
      throw new Error("Practice was not confirmed saved. Retry the same save.");
    }
    if (!result.data) throw new Error("Practice was not confirmed saved. Retry the same save.");
    return result.data as StudyRecord;
  });

export const getStudySet = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Identity.extend({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<StudyRecord> => {
    const signal = await guard(data.expectedUserId, context.userId, false);
    const result = await (context.supabase as unknown as Db)
      .from("study_sets")
      .select("id,owner_id,revision,creation_token,body,deleted_at,updated_at")
      .eq("owner_id", context.userId)
      .eq("id", data.id)
      .is("deleted_at", null)
      .limit(1)
      .abortSignal(signal);
    if (result.error || !Array.isArray(result.data) || result.data.length !== 1)
      throw new Error("This practice set is no longer available.");
    const row = result.data[0] as StudyRecord;
    StudyState.parse(row.body);
    return row;
  });
