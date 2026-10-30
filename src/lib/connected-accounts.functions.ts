import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getConnectedToolContext, runConnectedTool } from "@/integrations/connected-tools.server";
import { CONNECTION_FLOWS } from "@/integrations/connection-flows.mjs";

export const searchConnectedAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      connectionId: z.string().max(40),
      accountId: z.string().uuid(),
      query: z.string().trim().min(1).max(300),
    }),
  )
  .handler(async ({ data, context }) => {
    const flow = Object.hasOwn(CONNECTION_FLOWS, data.connectionId)
      ? CONNECTION_FLOWS[data.connectionId]
      : undefined;
    if (!flow) return { error: "This connection is unavailable." };
    try {
      const binding = await getConnectedToolContext(context.userId);
      return await runConnectedTool(
        context.userId,
        flow.tool,
        { account_id: data.accountId, query: data.query },
        binding,
      );
    } catch {
      return {
        error: "This account could not be read. Refresh its status or reconnect and try again.",
      };
    }
  });

export const refreshConnectedAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      await getConnectedToolContext(context.userId);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });
