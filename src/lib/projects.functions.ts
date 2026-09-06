import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type ProjectRole = "owner" | "editor" | "viewer";

export type ProjectSummary = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  owner_id: string;
  role: ProjectRole;
  member_count: number;
  chat_count?: number;
  file_count?: number;
  instructions_preview?: string | null;
  created_at?: string;
  updated_at: string;
  pinned_at: string | null;
  archived_at: string | null;
  deletion_requested_at: string | null;
};

export const PROJECT_LIMITS: Record<
  "free" | "plus" | "pro",
  { projects: number; filesPerProject: number }
> = {
  free: { projects: 3, filesPerProject: 5 },
  plus: { projects: 25, filesPerProject: 25 },
  pro: { projects: 200, filesPerProject: 40 },
};

async function planTier(supabase: unknown, userId: string): Promise<"free" | "plus" | "pro"> {
  try {
    const s = supabase as {
      rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown }>;
    };
    const { data } = await s.rpc("user_plan_tier", { _user_id: userId });
    const t = String(data ?? "free");
    if (t === "pro" || t === "plus") return t;
  } catch {
    /* ignore */
  }
  return "free";
}

export type ProjectDetail = {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string | null;
  color: string | null;
  owner_id: string;
  role: ProjectRole;
  created_at: string;
  updated_at: string;
  deletion_requested_at: string | null;
};

export type ProjectMember = {
  user_id: string;
  email: string | null;
  role: ProjectRole;
  created_at: string;
};

export type ProjectInvite = {
  id: string;
  email: string;
  role: ProjectRole;
  status: "pending" | "accepted" | "revoked";
  created_at: string;
};

export type ProjectChatSummary = {
  id: string;
  title: string;
  updated_at: string;
  created_by: string;
};

export type ProjectChatMessage = { role: "user" | "assistant" | "system"; content: string };
export type ProjectChatDetail = ProjectChatSummary & {
  snapshot: { messages: ProjectChatMessage[] };
  project_id: string;
};

export type PendingInvite = {
  invite_id: string;
  project_id: string;
  project_name: string;
  role: ProjectRole;
  invited_by: string;
  created_at: string;
};

const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().max(100_000),
});

// -------- Projects CRUD --------

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ProjectSummary[]> => {
    const { data: memberships, error: memErr } = await context.supabase
      .from("project_members")
      .select("project_id, role")
      .eq("user_id", context.userId);
    if (memErr) {
      console.error("[listProjects] mem", memErr.message);
      return [];
    }
    const ids = (memberships ?? []).map((m) => m.project_id);
    if (ids.length === 0) return [];
    const { data: projects, error: pErr } = await context.supabase
      .from("projects")
      .select(
        "id, name, description, system_prompt, color, owner_id, created_at, updated_at, pinned_at, archived_at, deletion_requested_at",
      )
      .in("id", ids)
      .order("pinned_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false });
    if (pErr) {
      console.error("[listProjects] p", pErr.message);
      return [];
    }
    const [{ data: counts }, { data: chats }, { data: files }] = await Promise.all([
      context.supabase.from("project_members").select("project_id").in("project_id", ids),
      context.supabase.from("project_chats").select("project_id").in("project_id", ids),
      context.supabase
        .from("project_files")
        .select("project_id")
        .in("project_id", ids)
        .eq("status", "ready"),
    ]);
    const countMap = new Map<string, number>();
    const chatMap = new Map<string, number>();
    const fileMap = new Map<string, number>();
    for (const r of counts ?? []) countMap.set(r.project_id, (countMap.get(r.project_id) ?? 0) + 1);
    for (const r of chats ?? []) chatMap.set(r.project_id, (chatMap.get(r.project_id) ?? 0) + 1);
    for (const r of files ?? []) fileMap.set(r.project_id, (fileMap.get(r.project_id) ?? 0) + 1);
    const roleMap = new Map<string, ProjectRole>();
    for (const m of memberships ?? []) roleMap.set(m.project_id, m.role as ProjectRole);
    return (projects ?? []).map((p: Record<string, unknown>) => ({
      id: p.id as string,
      name: p.name as string,
      description: (p.description as string | null) ?? null,
      color: (p.color as string | null) ?? null,
      owner_id: p.owner_id as string,
      role: roleMap.get(p.id as string) ?? "viewer",
      member_count: countMap.get(p.id as string) ?? 1,
      chat_count: chatMap.get(p.id as string) ?? 0,
      file_count: fileMap.get(p.id as string) ?? 0,
      instructions_preview:
        typeof p.system_prompt === "string" ? p.system_prompt.slice(0, 180) : null,
      created_at: p.created_at as string,
      updated_at: p.updated_at as string,
      pinned_at: (p.pinned_at as string | null) ?? null,
      archived_at: (p.archived_at as string | null) ?? null,
      deletion_requested_at: (p.deletion_requested_at as string | null) ?? null,
    }));
  });

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(100),
        description: z.string().trim().max(1000).optional().nullable(),
        system_prompt: z.string().trim().max(4000).optional().nullable(),
        color: z.string().trim().max(24).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    // Enforce per-plan active-project cap (owned by user).
    const tier = await planTier(context.supabase, context.userId);
    const cap = PROJECT_LIMITS[tier].projects;
    const { count } = await context.supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", context.userId)
      .is("archived_at", null);
    if ((count ?? 0) >= cap) {
      throw new Error(
        `You've reached your ${tier === "free" ? "Free" : tier === "plus" ? "Plus" : "Pro"} plan limit of ${cap} active projects. Archive one or upgrade to add more.`,
      );
    }
    // Use admin client: caller identity is already verified by requireSupabaseAuth
    // middleware, and we hard-pin owner_id to the verified userId. This avoids
    // RLS/JWT-signing-key edge cases where PostgREST's auth.uid() briefly
    // returns NULL for freshly-minted tokens.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("projects")
      .insert({
        owner_id: context.userId,
        name: data.name,
        description: data.description ?? null,
        system_prompt: data.system_prompt ?? null,
        color: data.color ?? "blue",
      })
      .select("id")
      .single();
    if (error || !row) {
      console.error("[createProject]", error?.message);
      throw new Error(error?.message || "Failed to create project");
    }
    return { id: row.id };
  });

export const pinProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        pinned: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("projects")
      .update({ pinned_at: data.pinned ? new Date().toISOString() : null })
      .eq("id", data.id);
    if (error) {
      console.error("[pinProject]", error.message);
      throw new Error("Failed to pin");
    }
    return { ok: true };
  });

export const duplicateProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    // Load source (must be visible under RLS = caller is a member)
    const { data: src, error: sErr } = await context.supabase
      .from("projects")
      .select("name, description, system_prompt, color")
      .eq("id", data.id)
      .maybeSingle();
    if (sErr || !src) throw new Error("Project not found");

    // Enforce plan cap
    const tier = await planTier(context.supabase, context.userId);
    const cap = PROJECT_LIMITS[tier].projects;
    const { count } = await context.supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", context.userId)
      .is("archived_at", null);
    if ((count ?? 0) >= cap) {
      throw new Error(
        `You've reached your plan limit of ${cap} active projects. Archive one or upgrade to duplicate.`,
      );
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const newName = `${src.name} (copy)`.slice(0, 100);
    const { data: row, error } = await supabaseAdmin
      .from("projects")
      .insert({
        owner_id: context.userId,
        name: newName,
        description: src.description,
        system_prompt: src.system_prompt,
        color: src.color ?? "blue",
      })
      .select("id")
      .single();
    if (error || !row) {
      console.error("[duplicateProject]", error?.message);
      throw new Error("Failed to duplicate");
    }
    return { id: row.id };
  });

export const getProject = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ProjectDetail | null> => {
    const { data: p, error } = await context.supabase
      .from("projects")
      .select(
        "id, name, description, system_prompt, color, owner_id, created_at, updated_at, deletion_requested_at",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (error) {
      console.error("[getProject]", error.message);
      return null;
    }
    if (!p) return null;
    const { data: mem } = await context.supabase
      .from("project_members")
      .select("role")
      .eq("project_id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    return {
      ...p,
      role:
        (mem?.role as ProjectRole | undefined) ??
        (p.owner_id === context.userId ? "owner" : "viewer"),
    };
  });

export const updateProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(100).optional(),
        description: z.string().trim().max(1000).nullable().optional(),
        system_prompt: z.string().trim().max(4000).nullable().optional(),
        color: z.string().trim().max(24).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { id, ...rest } = data;
    const { error } = await context.supabase.from("projects").update(rest).eq("id", id);
    if (error) {
      console.error("[updateProject]", error.message);
      throw new Error("Failed to update project");
    }
    return { ok: true };
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const [{ supabaseAdmin }, deletion] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("@/lib/project-deletion.server"),
    ]);
    try {
      await deletion.deleteProjectStorageFirst({
        admin: supabaseAdmin,
        userId: context.userId,
        projectId: data.id,
      });
    } catch (error) {
      console.error("[deleteProject] storage-first cleanup failed", {
        code:
          error instanceof deletion.ProjectDeletionError ? error.code : "project_deletion_failed",
      });
      throw new Error(deletion.projectDeletionPublicMessage(error), { cause: error });
    }
    return { ok: true };
  });

// -------- Members --------

export const listMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ project_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ProjectMember[]> => {
    const { data: rows, error } = await context.supabase
      .from("project_members")
      .select("user_id, role, created_at")
      .eq("project_id", data.project_id)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("[listMembers]", error.message);
      return [];
    }
    // Fetch emails via admin (RLS blocks other users' emails)
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const withEmail: ProjectMember[] = [];
    for (const r of rows ?? []) {
      let email: string | null = null;
      try {
        const { data: u } = await supabaseAdmin.auth.admin.getUserById(r.user_id);
        email = u.user?.email ?? null;
      } catch {
        /* ignore */
      }
      withEmail.push({
        user_id: r.user_id,
        email,
        role: r.role as ProjectRole,
        created_at: r.created_at,
      });
    }
    return withEmail;
  });

export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        user_id: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("project_members")
      .delete()
      .eq("project_id", data.project_id)
      .eq("user_id", data.user_id);
    if (error) {
      console.error("[removeMember]", error.message);
      throw new Error("Failed to remove member");
    }
    return { ok: true };
  });

export const updateMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        user_id: z.string().uuid(),
        role: z.enum(["editor", "viewer"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("project_members")
      .update({ role: data.role })
      .eq("project_id", data.project_id)
      .eq("user_id", data.user_id);
    if (error) {
      console.error("[updateMemberRole]", error.message);
      throw new Error("Failed to update role");
    }
    return { ok: true };
  });

// -------- Invites --------

export const listInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ project_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ProjectInvite[]> => {
    const { data: rows, error } = await context.supabase
      .from("project_invites")
      .select("id, email, role, status, created_at")
      .eq("project_id", data.project_id)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[listInvites]", error.message);
      return [];
    }
    return (rows ?? []) as ProjectInvite[];
  });

export const inviteMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        email: z.string().trim().email().max(255),
        role: z.enum(["editor", "viewer"]).default("editor"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string; auto_accepted: boolean }> => {
    const email = data.email.toLowerCase();
    const callerEmail = (context.claims as { email?: string } | undefined)?.email?.toLowerCase();
    if (callerEmail === email) throw new Error("You can't invite yourself.");

    // Auto-accept if the invited email already belongs to a user
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let existingUserId: string | null = null;
    try {
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const found = list.users.find((u) => u.email?.toLowerCase() === email);
      existingUserId = found?.id ?? null;
    } catch (e) {
      console.error("[inviteMember] lookup", e);
    }

    const { data: row, error } = await context.supabase
      .from("project_invites")
      .upsert(
        {
          project_id: data.project_id,
          email,
          role: data.role,
          invited_by: context.userId,
          status: existingUserId ? "accepted" : "pending",
          accepted_at: existingUserId ? new Date().toISOString() : null,
        },
        { onConflict: "project_id,email" },
      )
      .select("id")
      .single();
    if (error || !row) {
      console.error("[inviteMember]", error?.message);
      throw new Error("Failed to invite");
    }

    if (existingUserId) {
      const { error: mErr } = await supabaseAdmin
        .from("project_members")
        .upsert(
          { project_id: data.project_id, user_id: existingUserId, role: data.role },
          { onConflict: "project_id,user_id" },
        );
      if (mErr) console.error("[inviteMember] add member", mErr.message);
    }
    return { id: row.id, auto_accepted: !!existingUserId };
  });

export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("project_invites")
      .update({ status: "revoked" })
      .eq("id", data.id);
    if (error) {
      console.error("[revokeInvite]", error.message);
      throw new Error("Failed to revoke");
    }
    return { ok: true };
  });

export const listMyPendingInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PendingInvite[]> => {
    const email = (context.claims as { email?: string } | undefined)?.email?.toLowerCase();
    if (!email) return [];
    const { data: rows, error } = await context.supabase
      .from("project_invites")
      .select("id, project_id, role, invited_by, created_at, status, email")
      .eq("status", "pending")
      .ilike("email", email);
    if (error) {
      console.error("[listMyPendingInvites]", error.message);
      return [];
    }
    const ids = (rows ?? []).map((r) => r.project_id);
    if (ids.length === 0) return [];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: projects } = await supabaseAdmin
      .from("projects")
      .select("id, name")
      .in("id", ids);
    const nameMap = new Map<string, string>();
    for (const p of projects ?? []) nameMap.set(p.id, p.name);
    return (rows ?? []).map((r) => ({
      invite_id: r.id,
      project_id: r.project_id,
      project_name: nameMap.get(r.project_id) ?? "Project",
      role: r.role as ProjectRole,
      invited_by: r.invited_by,
      created_at: r.created_at,
    }));
  });

export const acceptInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ invite_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ project_id: string }> => {
    const email = (context.claims as { email?: string } | undefined)?.email?.toLowerCase();
    if (!email) throw new Error("Email required");
    const { data: invite, error: fErr } = await context.supabase
      .from("project_invites")
      .select("id, project_id, email, role, status")
      .eq("id", data.invite_id)
      .maybeSingle();
    if (fErr || !invite) throw new Error("Invite not found");
    if (invite.email.toLowerCase() !== email) throw new Error("This invite isn't for you");
    if (invite.status !== "pending") throw new Error("Invite no longer valid");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: mErr } = await supabaseAdmin
      .from("project_members")
      .upsert(
        { project_id: invite.project_id, user_id: context.userId, role: invite.role },
        { onConflict: "project_id,user_id" },
      );
    if (mErr) {
      console.error("[acceptInvite] mem", mErr.message);
      throw new Error("Failed to accept");
    }
    const { error: uErr } = await supabaseAdmin
      .from("project_invites")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", invite.id);
    if (uErr) console.error("[acceptInvite] upd", uErr.message);
    return { project_id: invite.project_id };
  });

export const declineInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ invite_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const email = (context.claims as { email?: string } | undefined)?.email?.toLowerCase();
    if (!email) throw new Error("Email required");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("project_invites")
      .update({ status: "revoked" })
      .eq("id", data.invite_id)
      .ilike("email", email);
    if (error) {
      console.error("[declineInvite]", error.message);
      throw new Error("Failed");
    }
    return { ok: true };
  });

// -------- Project chats --------

export const listProjectChats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ project_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ProjectChatSummary[]> => {
    const { data: rows, error } = await context.supabase
      .from("project_chats")
      .select("id, title, updated_at, created_by")
      .eq("project_id", data.project_id)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("[listProjectChats]", error.message);
      return [];
    }
    return (rows ?? []) as ProjectChatSummary[];
  });

export const getProjectChat = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ProjectChatDetail | null> => {
    const { data: row, error } = await context.supabase
      .from("project_chats")
      .select("id, project_id, title, snapshot, updated_at, created_by")
      .eq("id", data.id)
      .maybeSingle();
    if (error || !row) return null;
    return {
      ...row,
      snapshot: (row.snapshot as { messages: ProjectChatMessage[] }) ?? { messages: [] },
    } as ProjectChatDetail;
  });

export const createProjectChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        title: z.string().trim().min(1).max(200).default("Untitled chat"),
        messages: z.array(MessageSchema).max(500).default([]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { data: row, error } = await context.supabase
      .from("project_chats")
      .insert({
        project_id: data.project_id,
        title: data.title,
        snapshot: { messages: data.messages },
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error || !row) {
      console.error("[createProjectChat]", error?.message);
      throw new Error("Failed to create chat");
    }
    return { id: row.id };
  });

export const saveProjectChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        title: z.string().trim().min(1).max(200).optional(),
        messages: z.array(MessageSchema).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const patch: { snapshot: { messages: ProjectChatMessage[] }; title?: string } = {
      snapshot: { messages: data.messages },
    };
    if (data.title) patch.title = data.title;
    const { error } = await context.supabase.from("project_chats").update(patch).eq("id", data.id);
    if (error) {
      console.error("[saveProjectChat]", error.message);
      throw new Error("Failed to save");
    }
    return { ok: true };
  });

export const deleteProjectChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.from("project_chats").delete().eq("id", data.id);
    if (error) {
      console.error("[deleteProjectChat]", error.message);
      throw new Error("Failed to delete");
    }
    return { ok: true };
  });
