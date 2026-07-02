import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type StorageDto = {
  bytesUsed: number;
  libraryCount: number;
};

export const getMyStorage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StorageDto> => {
    const [{ data: storageRow }, { count }] = await Promise.all([
      context.supabase
        .from("user_storage")
        .select("bytes_used")
        .eq("user_id", context.userId)
        .maybeSingle(),
      context.supabase
        .from("user_library_items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", context.userId),
    ]);

    return {
      bytesUsed: storageRow?.bytes_used ?? 0,
      libraryCount: count ?? 0,
    };
  });
