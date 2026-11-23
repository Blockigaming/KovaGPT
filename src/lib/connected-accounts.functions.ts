import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  getConnectedToolContext,
  runConnectionAccountSearch,
} from "@/integrations/connected-tools.server";
import { CONNECTION_FLOWS } from "@/integrations/connection-flows.mjs";
import { logOperationalEvent } from "@/lib/structured-log.server";

const providerReadErrors = new Map([
  ["connection_reauthorization_required", "The provider session expired. Reconnect this account."],
  [
    "connection_permission_required",
    "The provider denied read access. Check the account permissions.",
  ],
  ["connection_rate_limited", "The read limit was reached. Try again in a minute."],
  [
    "connection_changed_or_expired",
    "The connection changed or expired. Refresh its status and try again.",
  ],
  [
    "outlook_default_calendar_unavailable",
    "Microsoft could not find a default calendar for this account.",
  ],
  ["onedrive_default_drive_unavailable", "Microsoft could not find a OneDrive for this account."],
  [
    "invalid_connection_response",
    "The provider returned an unexpected response. Try again shortly.",
  ],
  ["connection_account_not_allowed", "The selected account no longer grants this read."],
  ["invalid_connection_query", "This connector does not support that query."],
  [
    "connection_status_unavailable",
    "Account status is temporarily unavailable. Try again shortly.",
  ],
  [
    "connection_protection_unavailable",
    "Connection reads are temporarily unavailable. Try again shortly.",
  ],
  ["connection_read_failed", "The provider could not complete this search. Try again shortly."],
]);

export const searchConnectedAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      connectionId: z.string().max(40),
      accountId: z.string().uuid(),
      query: z.string().trim().min(1).max(300),
      recordType: z.enum(["accounts", "contacts", "opportunities"]).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const flow = Object.hasOwn(CONNECTION_FLOWS, data.connectionId)
      ? CONNECTION_FLOWS[data.connectionId]
      : undefined;
    if (!flow) return { error: "This connection is unavailable." };
    if (data.connectionId === "salesforce" && !data.recordType)
      return { error: "Choose the Salesforce record type to search." };
    try {
      const binding = await getConnectedToolContext(context.userId);
      return await runConnectionAccountSearch(
        context.userId,
        flow.tool,
        {
          account_id: data.accountId,
          query: data.query,
          ...(data.connectionId === "salesforce" ? { record_type: data.recordType } : {}),
        },
        binding,
      );
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const message = providerReadErrors.get(code);
      const status = error instanceof Error ? error.cause : undefined;
      const reference = crypto.randomUUID();
      logOperationalEvent({
        correlationId: reference,
        category: "connections",
        operation: flow.tool,
        metadata: {
          code: message ? code : "connection_read_unavailable",
          ...(message && typeof status === "number" && status >= 400 && status <= 599
            ? { status }
            : {}),
        },
      });
      return {
        error: `${message ?? "This account could not be read. Refresh its status and try again."} Reference ${reference}.`,
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
