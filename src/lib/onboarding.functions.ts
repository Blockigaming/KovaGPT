import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getOnboarding = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_onboarding")
      .select("primary_use, response_style, completed, completed_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    return data ?? null;
  });

export const saveOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { primary_use: string; response_style: string }) => ({
    primary_use: String(d.primary_use ?? "").slice(0, 100),
    response_style: String(d.response_style ?? "balanced").slice(0, 40),
  }))
  .handler(async ({ data, context }) => {
    const row = {
      user_id: context.userId,
      primary_use: data.primary_use,
      response_style: data.response_style,
      completed: true,
      completed_at: new Date().toISOString(),
    };
    const { error } = await context.supabase
      .from("user_onboarding")
      .upsert(row, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const skipOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const row = {
      user_id: context.userId,
      response_style: "balanced",
      completed: true,
      completed_at: new Date().toISOString(),
    };
    await context.supabase
      .from("user_onboarding")
      .upsert(row, { onConflict: "user_id" });
    return { ok: true };
  });
