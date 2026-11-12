import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireVerifiedUser } from "./api-auth.server";
import { consumeApplicationRateLimit } from "./distributed-rate-limit.server";
import { loose } from "./supabase-loose";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { teamRpc } from "./team-billing.server";

const workspaceAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const caller = await requireVerifiedUser(getRequest());
  if (caller instanceof Response) throw caller;
  return next({ context: { userId: caller.userId } });
});
export type AvailableWorkspace = { team_id: string; team_name: string; request_status: string };
const workspacePrincipal = z.object({ expectedUserId: z.string().uuid() }).strict();
const workspaceIdentity = workspacePrincipal.extend({ teamId: z.string().uuid() });
const joinRequestStatus = z.enum(["pending", "approved", "denied", "withdrawn"]);
export type JoinRequestStatus = z.infer<typeof joinRequestStatus>;

function assertWorkspacePrincipal(expectedUserId: string, userId: string) {
  if (expectedUserId !== userId)
    throw new Error("Your account changed. Reopen workspace settings before continuing.");
}

async function ownsWorkspace(teamId: string, ownerId: string) {
  const owned = await loose(supabaseAdmin)
    .from("team_workspaces")
    .select("id")
    .eq("id", teamId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (owned.error) throw new Error("Workspace ownership could not be confirmed.");
  return Boolean(owned.data);
}

export const findAvailableWorkspaces = createServerFn({ method: "GET" })
  .middleware([workspaceAuth])
  .validator((input: unknown) => workspacePrincipal.parse(input))
  .handler(async ({ data, context }): Promise<AvailableWorkspace[]> => {
    assertWorkspacePrincipal(data.expectedUserId, context.userId);
    const result = await teamRpc("discover_verified_team_workspaces", { p_actor: context.userId });
    return Array.isArray(result) ? (result as AvailableWorkspace[]) : [];
  });
export const submitWorkspaceJoinRequest = createServerFn({ method: "POST" })
  .middleware([workspaceAuth])
  .validator((input: unknown) => workspaceIdentity.parse(input))
  .handler(async ({ data, context }) => {
    assertWorkspacePrincipal(data.expectedUserId, context.userId);
    const rate = await consumeApplicationRateLimit({
      identity: "user:" + context.userId,
      action: "workspace_join_request",
      limit: 3,
      windowSeconds: 3600,
    });
    if (!rate.allowed) throw new Error("Too many requests. Try again later.");
    const id = await teamRpc("request_verified_team_join", {
      p_actor: context.userId,
      p_team: data.teamId,
    });
    if (typeof id !== "string") throw new Error("The workspace request could not be confirmed.");
    // The request is durable, even if email is delayed or unavailable.
    // Email is sent by the separate retriable delivery operation.
    await import("./workspace-join-notifications.server")
      .then(({ deliverJoinRequestNotice }) => deliverJoinRequestNotice(id))
      .catch(() => {});
    const saved = await loose(supabaseAdmin)
      .from("team_join_requests")
      .select("status")
      .eq("id", id)
      .eq("team_id", data.teamId)
      .eq("requester_id", context.userId)
      .maybeSingle();
    const status = joinRequestStatus.safeParse(saved.data?.status);
    if (saved.error || !status.success)
      throw new Error("The workspace request could not be confirmed.");
    return { id, status: status.data };
  });

export const listTeamJoinRequests = createServerFn({ method: "GET" })
  .middleware([workspaceAuth])
  .validator((input: unknown) => workspaceIdentity.parse(input))
  .handler(async ({ data, context }) => {
    assertWorkspacePrincipal(data.expectedUserId, context.userId);
    if (!(await ownsWorkspace(data.teamId, context.userId))) return [];
    const result = await loose(supabaseAdmin)
      .from("team_join_requests")
      .select("id,team_id,requester_email,status,requested_at")
      .eq("team_id", data.teamId)
      .eq("status", "pending")
      .order("requested_at", { ascending: true })
      .limit(100);
    if (result.error) throw new Error("Workspace requests could not be loaded.");
    return result.data ?? [];
  });
export const reviewTeamJoinRequest = createServerFn({ method: "POST" })
  .middleware([workspaceAuth])
  .validator((input: unknown) =>
    workspaceIdentity.extend({ requestId: z.string().uuid(), approve: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    assertWorkspacePrincipal(data.expectedUserId, context.userId);
    if (!(await ownsWorkspace(data.teamId, context.userId)))
      throw new Error("The workspace request is unavailable.");
    const saved = await loose(supabaseAdmin)
      .from("team_join_requests")
      .select("id")
      .eq("team_id", data.teamId)
      .eq("id", data.requestId)
      .maybeSingle();
    if (saved.error || !saved.data) throw new Error("The workspace request is unavailable.");
    return {
      ok: await teamRpc("review_verified_team_join", {
        p_actor: context.userId,
        p_id: data.requestId,
        p_approve: data.approve,
      }),
      // Membership and seats are allocated only by the existing invitation flow.
      membershipCreated: false,
    };
  });
