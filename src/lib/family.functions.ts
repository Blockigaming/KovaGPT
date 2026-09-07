// Family Sharing server functions.
// - createOrGetGroup: signed-in owner ensures their family group exists.
// - createInvite: owner mints a single-use, 7-day invite token.
// - acceptInvite: signed-in user redeems a token → becomes a member.
// - removeMember / leaveGroup / listMembers: household management.
//
// Only the owner can invite/remove. RLS + the enforce_family_member_cap
// trigger cap groups at 1 owner + 5 members.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

function newToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const getMyFamily = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: owned } = await supabase
      .from("family_groups")
      .select("id, name, owner_id, created_at")
      .eq("owner_id", userId)
      .maybeSingle();
    const { data: member } = await supabase
      .from("family_members")
      .select("group_id, role")
      .eq("user_id", userId)
      .maybeSingle();
    let group = owned;
    let role: "owner" | "member" | null = owned ? "owner" : null;
    if (!group && member?.group_id) {
      const { data: g } = await supabase
        .from("family_groups")
        .select("id, name, owner_id, created_at")
        .eq("id", member.group_id)
        .maybeSingle();
      group = g;
      role = (member.role as "owner" | "member") ?? "member";
    }
    if (!group) return { group: null, role: null, members: [], invites: [] };
    const { data: members } = await supabase
      .from("family_members")
      .select("id, user_id, role, created_at")
      .eq("group_id", group.id);
    const { data: invites } =
      role === "owner"
        ? await supabase
            .from("family_invites")
            .select("id, token, invited_email, accepted_at, expires_at, created_at")
            .eq("group_id", group.id)
            .order("created_at", { ascending: false })
        : { data: [] };
    return { group, role, members: members ?? [], invites: invites ?? [] };
  });

export const createFamilyGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) =>
    z.object({ name: z.string().trim().min(1).max(60).default("My Family") }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: groupId, error } = await supabaseAdmin.rpc("create_or_repair_family_group", {
      p_owner_id: context.userId,
      p_name: data.name,
    });
    if (error || typeof groupId !== "string") {
      throw new Error(
        "Family group could not be saved. If you belong to another family, leave it first.",
      );
    }
    return { id: groupId };
  });

export const createFamilyInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => z.object({ email: z.string().email().optional() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: group, error: gErr } = await supabase
      .from("family_groups")
      .select("id")
      .eq("owner_id", userId)
      .maybeSingle();
    if (gErr) throw new Error(gErr.message);
    if (!group) throw new Error("Create your family group first.");
    const token = newToken();
    const { error } = await supabase.from("family_invites").insert({
      group_id: group.id,
      token,
      invited_email: data.email ?? null,
      created_by: userId,
    });
    if (error) throw new Error(error.message);
    return { token };
  });

export const acceptFamilyInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => z.object({ token: z.string().regex(/^[0-9a-f]{48}$/u) }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: groupId, error } = await supabaseAdmin.rpc("accept_family_invite_atomic", {
      p_user_id: context.userId,
      p_token: data.token,
    });
    if (error || typeof groupId !== "string") {
      throw new Error(
        "Invite could not be accepted. Check that it is current, matches your verified email, and that you are not already in a family.",
      );
    }
    return { group_id: groupId };
  });

export const removeFamilyMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => z.object({ memberUserId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: group } = await supabase
      .from("family_groups")
      .select("id")
      .eq("owner_id", userId)
      .maybeSingle();
    if (!group) throw new Error("You are not a group owner.");
    if (data.memberUserId === userId)
      throw new Error("Owners cannot remove themselves; delete the group instead.");
    const { error } = await supabase
      .from("family_members")
      .delete()
      .eq("group_id", group.id)
      .eq("user_id", data.memberUserId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const leaveFamily = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("family_members")
      .delete()
      .eq("user_id", userId)
      .eq("role", "member");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const revokeFamilyInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => z.object({ inviteId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("family_invites").delete().eq("id", data.inviteId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
