import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { loose } from "@/lib/supabase-loose";

const receiptSchema = z.object({
  operationId: z.uuid(),
  state: z.enum(["active", "restored", "dismissed", "expired", "retired", "conflict"]),
  removedCount: z.number().int().nonnegative(),
  restoredCount: z.number().int().nonnegative().optional(),
  skippedCount: z.number().int().nonnegative().optional(),
  conflictCount: z.number().int().nonnegative().optional(),
  conflictToken: z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .optional(),
  expiresAt: z.string(),
});
export type MemoryClearReceipt = z.infer<typeof receiptSchema>;
function configuredWindow() {
  const raw = runtimeEnv("KOVA_MEMORY_UNDO_TTL_SECONDS");
  const ttl = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(ttl) &&
    ttl >= 60 &&
    ttl <= 86400 &&
    runtimeEnv("KOVA_MEMORY_UNDO_CLEANUP_CONFIGURED") === "true"
    ? ttl
    : null;
}
export const memoryClearAvailability = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const seconds = configuredWindow();
    if (!seconds) return { available: false, seconds: null };
    try {
      const { data, error } = await loose(supabaseAdmin)
        .rpc("memory_clear_capability")
        .abortSignal(AbortSignal.timeout(10000));
      return { available: !error && data === 1, seconds: !error && data === 1 ? seconds : null };
    } catch {
      return { available: false, seconds: null };
    }
  });
export const changeMemoryClear = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z
      .object({
        operationId: z.uuid(),
        action: z.enum(["clear", "restore", "dismiss"]),
        keepNewer: z.boolean().default(false),
        conflictToken: z
          .string()
          .regex(/^[a-f0-9]{32}$/)
          .optional(),
      })
      .strict(),
  )
  .handler(async ({ context, data }): Promise<MemoryClearReceipt> => {
    const ttl = configuredWindow();
    if (data.action === "clear" && !ttl)
      throw new Error("Reversible clear is not configured. No new clear was requested.");
    // The principal is authenticated server context, never browser-supplied.
    // Recovery remains callable when new clears are disabled.
    const result = await loose(supabaseAdmin)
      .rpc("memory_clear_operation", {
        p_user_id: context.userId,
        p_operation_id: data.operationId,
        p_action: data.action,
        p_ttl_seconds: ttl,
        p_keep_newer: data.keepNewer,
        p_expected_conflicts: data.conflictToken ?? null,
      })
      .abortSignal(AbortSignal.timeout(10000));
    if (result.error)
      throw new Error(
        "Memory operation could not be confirmed. Keep this recovery entry and retry.",
      );
    const receipt = receiptSchema.parse(result.data);
    if (receipt.operationId !== data.operationId)
      throw new Error("Memory operation could not be confirmed. Retry this entry.");
    return receipt;
  });
