import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DailyUsageDto = {
  date: string;
  chats: number;
  images: number;
  uploads: number;
  voice: number;
  resetsAt: string; // next UTC midnight ISO
};

export const getMyDailyUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DailyUsageDto> => {
    const today = new Date();
    const ymd = today.toISOString().slice(0, 10);
    const nextMidnight = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1),
    );

    const { data, error } = await context.supabase
      .from("daily_usage")
      .select("usage_date, chats, images, uploads, voice")
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      // RLS or table issue - return zeros rather than leaking error details
      console.error("[getMyDailyUsage] read error", error.message);
      return {
        date: ymd,
        chats: 0,
        images: 0,
        uploads: 0,
        voice: 0,
        resetsAt: nextMidnight.toISOString(),
      };
    }

    // The row is considered "today" only if the latest row's date matches today.
    if (!data || data.usage_date !== ymd) {
      return {
        date: ymd,
        chats: 0,
        images: 0,
        uploads: 0,
        voice: 0,
        resetsAt: nextMidnight.toISOString(),
      };
    }

    return {
      date: ymd,
      chats: data.chats ?? 0,
      images: data.images ?? 0,
      uploads: data.uploads ?? 0,
      voice: data.voice ?? 0,
      resetsAt: nextMidnight.toISOString(),
    };
  });
