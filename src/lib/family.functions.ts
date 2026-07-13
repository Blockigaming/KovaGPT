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
    const { data: invites } = role === "owner"
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
  .inputValidator((i: unknown) => z.object({ name: z.string().trim().min(1).max(60).default("My Family") }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("family_groups").select("id").eq("owner_id", userId).maybeSingle();
    if (existing) return { id: existing.id };
    const { data: group, error } = await supabase
      .from("family_groups")
      .insert({ owner_id: userId, name: data.name })
      .select("id").single();
    if (error) throw new Error(error.message);
    // Add owner as a member row so RLS treats them uniformly.
    await supabase.from("family_members").insert({ group_id: group.id, user_id: userId, role: "owner" });
    return { id: group.id };
  });

export const createFamilyInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ email: z.string().email().optional() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: group, error: gErr } = await supabase
      .from("family_groups").select("id").eq("owner_id", userId).maybeSingle();
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
  .inputValidator((i: unknown) => z.object({ token: z.string().min(8) }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    // We need to READ any invite by token to validate. RLS only lets the owner
    // read invites, so use the admin client for the read-only lookup.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: invite } = await supabaseAdmin
      .from("family_invites")
      .select("id, group_id, accepted_at, expires_at")
      .eq("token", data.token)
      .maybeSingle();
    if (!invite) throw new Error("Invalid invite.");
    if (invite.accepted_at) throw new Error("This invite has already been used.");
    if (new Date(invite.expires_at).getTime() < Date.now()) throw new Error("Invite expired.");
    // Insert membership via the admin client - the RLS INSERT policy only
    // permits the owner to add members; invite acceptance is authorized here
    // by the valid unexpired token above.
    const { error: mErr } = await supabaseAdmin
      .from("family_members")
      .insert({ group_id: invite.group_id, user_id: userId, role: "member" });
    if (mErr) throw new Error(mErr.message);

    await supabaseAdmin
      .from("family_invites")
      .update({ accepted_at: new Date().toISOString(), accepted_by: userId })
      .eq("id", invite.id);
    return { group_id: invite.group_id };
  });

export const removeFamilyMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ memberUserId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: group } = await supabase
      .from("family_groups").select("id").eq("owner_id", userId).maybeSingle();
    if (!group) throw new Error("You are not a group owner.");
    if (data.memberUserId === userId) throw new Error("Owners cannot remove themselves; delete the group instead.");
    const { error } = await supabase
      .from("family_members").delete()
      .eq("group_id", group.id).eq("user_id", data.memberUserId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const leaveFamily = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("family_members").delete().eq("user_id", userId).eq("role", "member");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const revokeFamilyInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ inviteId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("family_invites").delete().eq("id", data.inviteId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
