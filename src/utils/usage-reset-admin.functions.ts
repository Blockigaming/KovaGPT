import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { configuredAdministratorIds } from "@/lib/administrator.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loose } from "@/lib/supabase-loose";

export const canGrantUsageResets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => configuredAdministratorIds().has(context.userId));

export const grantUsageReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { recipient: string; reason: string; requestId: string }) => data)
  .handler(async ({ context, data }) => {
    if (!configuredAdministratorIds().has(context.userId)) throw new Error("Access denied.");
    const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    if (!uuid.test(data.recipient) || !uuid.test(data.requestId) || typeof data.reason !== "string")
      throw new Error("Enter a valid account ID and reason.");
    const { data: granted, error } = await loose(supabaseAdmin).rpc("kova_grant_chat_limit_reset", {
      p_user: data.recipient,
      p_admin: context.userId,
      p_id: data.requestId,
      p_reason: data.reason,
    });
    if (error || granted !== true) throw new Error("Reset grant failed.");
    return true;
  });

type StaleHold = {
  event_id: string;
  request_id: string;
  model: string;
  created_at: string;
  maximum_micros: number;
};

export const listStaleCreditHolds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StaleHold[] | null> => {
    if (!configuredAdministratorIds().has(context.userId)) return null;
    const { data, error } = await loose(supabaseAdmin)
      .rpc("kova_stale_credit_holds", {})
      .abortSignal(AbortSignal.timeout(10_000));
    if (error || !Array.isArray(data)) throw new Error("Credit holds are unavailable.");
    return data as StaleHold[];
  });

export const reconcileStaleCreditHold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (data: { ownerId: string; eventId: string; actualUsd: string; reason: string }) => data,
  )
  .handler(async ({ context, data }) => {
    if (data.ownerId !== context.userId || !configuredAdministratorIds().has(context.userId))
      throw new Error("Access denied.");
    const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    if (
      !uuid.test(data.eventId) ||
      typeof data.actualUsd !== "string" ||
      !/^\d{1,3}(?:\.\d{1,8})?$/.test(data.actualUsd) ||
      Number(data.actualUsd) > 500 ||
      typeof data.reason !== "string" ||
      !data.reason.trim() ||
      data.reason.trim().length > 240
    )
      throw new Error("Enter a verified cost and reason.");
    const { data: applied, error } = await loose(supabaseAdmin)
      .rpc("kova_reconcile_stale_credit_spend", {
        p_event: data.eventId,
        p_admin: context.userId,
        p_actual_cost: Number(data.actualUsd),
        p_reason: data.reason.trim(),
      })
      .abortSignal(AbortSignal.timeout(10_000));
    if (error || applied !== true) throw new Error("The hold could not be reconciled.");
    return true;
  });
