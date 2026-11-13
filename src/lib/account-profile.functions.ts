import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loose } from "@/lib/supabase-loose";

const profileSchema = z.object({
  name: z.string().trim().min(1).max(120).nullable(),
  photo: z
    .string()
    .max(180_000)
    .regex(/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/u)
    .nullable()
    .optional(),
});
export type AccountProfile = z.infer<typeof profileSchema>;
const ownerSchema = z.object({ ownerId: z.string().uuid() });

export const readAccountProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ownerSchema.parse(input))
  .handler(async ({ data, context }): Promise<AccountProfile | null> => {
    if (data.ownerId !== context.userId) throw new Error("Your account changed.");
    const result = await loose(context.supabase)
      .from("user_preferences")
      .select("settings")
      .eq("user_id", context.userId)
      .abortSignal(AbortSignal.timeout(8000))
      .maybeSingle();
    if (result.error) throw new Error("Your profile could not be loaded.");
    return profileSchema.safeParse(result.data?.settings?.account_profile).data ?? null;
  });

export const saveAccountProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    ownerSchema.extend({ profile: profileSchema.partial() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<AccountProfile> => {
    if (data.ownerId !== context.userId) throw new Error("Your account changed.");
    const table = () => loose(context.supabase).from("user_preferences");
    const current = await table()
      .select("settings,updated_at")
      .eq("user_id", context.userId)
      .abortSignal(AbortSignal.timeout(8000))
      .maybeSingle();
    if (current.error) throw new Error("Your profile could not be loaded.");
    const previous = profileSchema.safeParse(current.data?.settings?.account_profile).data;
    const profile = { name: null, ...previous, ...data.profile };
    const settings = { ...current.data?.settings, account_profile: profile };
    const updated_at = new Date().toISOString();
    const query = current.data
      ? table()
          .update({ settings, updated_at })
          .eq("user_id", context.userId)
          .eq("updated_at", current.data.updated_at)
          .eq("settings", JSON.stringify(current.data.settings))
      : table().insert({ user_id: context.userId, settings, updated_at });
    const result = await query
      .select("user_id")
      .abortSignal(AbortSignal.timeout(8000))
      .maybeSingle();
    if (result.error || !result.data)
      throw new Error("Your profile could not be saved. Try again.");
    return profile;
  });
