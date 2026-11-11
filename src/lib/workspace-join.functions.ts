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
export const findAvailableWorkspaces = createServerFn({ method: "GET" })
  .middleware([workspaceAuth])
  .handler(async ({ context }): Promise<AvailableWorkspace[]> => {
    const result = await teamRpc("discover_verified_team_workspaces", { p_actor: context.userId });
    return Array.isArray(result) ? (result as AvailableWorkspace[]) : [];
  });
export const submitWorkspaceJoinRequest = createServerFn({ method: "POST" })
  .middleware([workspaceAuth])
  .validator((input: unknown) => z.object({ teamId: z.string().uuid() }).strict().parse(input))
  .handler(async ({ data, context }) => {
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
    // The request is durable, even if email is delayed or unavailable.
    // Email is sent by the separate retriable delivery operation.
    await import("./workspace-join-notifications.server")
      .then(({ deliverJoinRequestNotice }) => deliverJoinRequestNotice(String(id)))
      .catch(() => {});
    return { id: String(id), status: "pending" as const };
  });

export const listTeamJoinRequests = createServerFn({ method: "GET" })
  .middleware([workspaceAuth])
  .handler(async ({ context }) => {
    const db = loose(supabaseAdmin);
    const owned = await db.from("team_workspaces").select("id").eq("owner_id", context.userId);
    if (owned.error) throw new Error("Workspace requests could not be loaded.");
    const ids = (owned.data ?? []).map((item: { id: string }) => item.id);
    if (!ids.length) return [];
    const result = await db
      .from("team_join_requests")
      .select("id,team_id,requester_email,status,requested_at")
      .in("team_id", ids)
      .eq("status", "pending")
      .limit(100);
    if (result.error) throw new Error("Workspace requests could not be loaded.");
    return result.data ?? [];
  });
export const reviewTeamJoinRequest = createServerFn({ method: "POST" })
  .middleware([workspaceAuth])
  .validator((input: unknown) =>
    z.object({ requestId: z.string().uuid(), approve: z.boolean() }).strict().parse(input),
  )
  .handler(async ({ data, context }) => ({
    ok: await teamRpc("review_verified_team_join", {
      p_actor: context.userId,
      p_id: data.requestId,
      p_approve: data.approve,
    }),
    // Approval permits an existing paid-seat invitation; it does NOT add a member.
    membershipCreated: false,
  }));
