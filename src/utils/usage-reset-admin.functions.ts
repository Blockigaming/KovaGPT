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
