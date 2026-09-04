import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { buildTransactionalEmail, emailOperationFingerprint } from "@/lib/email-queue.server";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";

import type { PendingInvite, ProjectInvite, ProjectRole } from "./projects.functions";

type InviteRpcClient = {
  rpc: (
    name: "accept_project_invite" | "decline_project_invite",
    args: { _invite_id: string },
  ) => Promise<{ data: string | boolean | null; error: { message: string } | null }>;
};

function inviteRpcClient(value: unknown): InviteRpcClient {
  return value as InviteRpcClient;
}

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
        email: z.string().trim().email().max(254),
        role: z.enum(["editor", "viewer"]).default("editor"),
        operation_id: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string; auto_accepted: false }> => {
    const email = data.email.toLowerCase();
    const callerEmail = (context.claims as { email?: string } | undefined)?.email?.toLowerCase();
    if (callerEmail === email) throw new Error("You can't invite yourself.");

    const rateLimit = await consumeApplicationRateLimit({
      identity: `user:${context.userId}`,
      action: "project_invite_email",
      limit: 20,
      windowSeconds: 3600,
    });
    if (!rateLimit.allowed) {
      throw new Error(
        rateLimit.status === "limited"
          ? "Too many invitations. Please try again later."
          : "Invitation protection is temporarily unavailable.",
      );
    }

    const { data: project, error: projectError } = await context.supabase
      .from("projects")
      .select("name")
      .eq("id", data.project_id)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (projectError || !project) {
      throw new Error("Only the project owner can invite members.");
    }

    const requestFingerprint = await emailOperationFingerprint([
      "project-invite",
      context.userId,
      data.project_id,
      email,
      data.role,
    ]);
    const payload = await buildTransactionalEmail({
      templateName: "project-invite",
      recipientEmail: email,
      messageId: data.operation_id,
      idempotencyKey: data.operation_id,
      data: {
        projectName: project.name,
        inviterName: "A KovaGPT user",
        role: data.role,
        destinationUrl: "https://kovagpt.com/projects",
      },
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inviteId, error } = await supabaseAdmin.rpc(
      "create_project_invite_and_enqueue" as never,
      {
        p_actor_id: context.userId,
        p_project_id: data.project_id,
        p_recipient_email: email,
        p_role: data.role,
        p_operation_id: data.operation_id,
        p_request_fingerprint: requestFingerprint,
        p_payload: payload,
      } as never,
    );
    if (error || typeof inviteId !== "string") {
      console.error("[inviteMember]", { error_code: "project_invite_enqueue_failed" });
      throw new Error("The invitation could not be created and emailed.");
    }
    return { id: inviteId, auto_accepted: false };
  });

export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("project_invites")
      .update({ status: "revoked", accepted_at: null })
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

    const ids = (rows ?? []).map((row) => row.project_id);
    if (ids.length === 0) return [];

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: projects, error: projectError } = await supabaseAdmin
      .from("projects")
      .select("id, name")
      .in("id", ids);
    if (projectError) {
      console.error("[listMyPendingInvites] projects", projectError.message);
      return [];
    }

    const nameMap = new Map<string, string>();
    for (const project of projects ?? []) nameMap.set(project.id, project.name);
    return (rows ?? []).map((row) => ({
      invite_id: row.id,
      project_id: row.project_id,
      project_name: nameMap.get(row.project_id) ?? "Project",
      role: row.role as ProjectRole,
      invited_by: row.invited_by,
      created_at: row.created_at,
    }));
  });

export const acceptInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ invite_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ project_id: string }> => {
    const { data: projectId, error } = await inviteRpcClient(context.supabase).rpc(
      "accept_project_invite",
      { _invite_id: data.invite_id },
    );
    if (error || typeof projectId !== "string") {
      console.error("[acceptInvite]", error?.message);
      throw new Error("Invite could not be accepted.");
    }
    return { project_id: projectId };
  });

export const declineInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ invite_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { data: declined, error } = await inviteRpcClient(context.supabase).rpc(
      "decline_project_invite",
      { _invite_id: data.invite_id },
    );
    if (error || declined !== true) {
      console.error("[declineInvite]", error?.message);
      throw new Error("Invite could not be declined.");
    }
    return { ok: true };
  });
