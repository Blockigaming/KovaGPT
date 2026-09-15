import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { STORAGE_LIMITS_BYTES } from "@/lib/modes";
import type { BillingTier } from "@/lib/billing-plans";

export type StorageDto = {
  bytesUsed: number;
  libraryCount: number;
  tier: BillingTier | null;
  limitBytes: number | null;
};

export const getMyStorage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StorageDto> => {
    const [storage, library, subscription] = await Promise.all([
      context.supabase
        .from("user_storage")
        .select("bytes_used")
        .eq("user_id", context.userId)
        .maybeSingle(),
      context.supabase
        .from("user_library_items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", context.userId),
      context.supabase.rpc("current_subscription_summary"),
    ]);

    if (storage.error || library.error) {
      throw new Error("Could not load cloud storage usage. Please try again.");
    }
    const bytesUsed = storage.data?.bytes_used ?? 0;
    const libraryCount = library.count;
    if (
      !Number.isSafeInteger(bytesUsed) ||
      bytesUsed < 0 ||
      libraryCount === null ||
      !Number.isSafeInteger(libraryCount) ||
      libraryCount < 0
    ) {
      throw new Error("Cloud storage usage is unavailable. Please try again.");
    }
    const summary =
      !subscription.error &&
      subscription.data &&
      typeof subscription.data === "object" &&
      !Array.isArray(subscription.data)
        ? (subscription.data as Record<string, unknown>)
        : null;
    const value = summary?.effectiveTier;
    const tier = value === "free" || value === "plus" || value === "pro" ? value : null;

    return {
      bytesUsed,
      libraryCount,
      tier,
      limitBytes: tier === null ? null : STORAGE_LIMITS_BYTES[tier],
    };
  });
