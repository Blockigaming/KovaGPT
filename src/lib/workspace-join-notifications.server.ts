/** Workspace join email delivery and retries are server-only. */
import { loose } from "./supabase-loose";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { teamRpc } from "./team-billing.server";
import { readResponseBytesBounded } from "./endpoint-reliability.mjs";

export async function deliverJoinRequestNotice(id: string) {
  if (!process.env.RESEND_API_KEY) return false;
  const db = loose(supabaseAdmin);
  const request = (await teamRpc("claim_team_join_notification", { p_id: id })) as {
    id: string;
    team_id: string;
    requester_email: string;
    status: string;
    notification_sent_at: string | null;
  } | null;
  if (!request || request.status !== "pending" || request.notification_sent_at) return false;
  const team = await db
    .from("team_workspaces")
    .select("owner_id,name")
    .eq("id", request.team_id)
    .single();
  if (team.error || !team.data) return false;
  const owner = await teamRpc("kova_auth_directory_email", {
    p_account_id: team.data.owner_id,
  }).catch(() => null);
  if (typeof owner !== "string" || !owner.includes("@")) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: "Bearer " + process.env.RESEND_API_KEY,
      "Content-Type": "application/json",
      "Idempotency-Key": "kova-workspace-join:" + id,
    },
    body: JSON.stringify({
      from: "KovaGPT <noreply@kovagpt.com>",
      to: [owner],
      subject: "Workspace membership request",
      text:
        "A verified account has requested to join your KovaGPT workspace " +
        team.data.name +
        ". Review the request in your team administration area. Request ID: " +
        id,
    }),
  });
  const text = new TextDecoder().decode(
    await readResponseBytesBounded(response, 8192, { timeoutMs: 10000 }),
  );
  let result: unknown;
  try {
    result = JSON.parse(text);
  } catch {
    return false;
  }
  const providerId = (result as { id?: unknown })?.id;
  if (!response.ok || typeof providerId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(providerId))
    return false;
  const committed = await db
    .from("team_join_requests")
    .update({
      notification_sent_at: new Date().toISOString(),
      notification_provider_id: providerId,
      notification_lease_until: null,
    })
    .eq("id", id)
    .is("notification_sent_at", null);
  return !committed.error;
}

/** Existing signed email worker calls this only after its primary queue has spare capacity. */
export async function retryWorkspaceJoinNotification() {
  if (!process.env.RESEND_API_KEY) return 0;
  const now = new Date();
  const oldest = new Date(now.getTime() - 20 * 60 * 60 * 1000).toISOString();
  const result = await loose(supabaseAdmin)
    .from("team_join_requests")
    .select("id")
    .eq("status", "pending")
    .is("notification_sent_at", null)
    .lt("notification_attempts", 6)
    .gt("requested_at", oldest)
    .or("notification_lease_until.is.null,notification_lease_until.lt." + now.toISOString())
    .order("requested_at", { ascending: true })
    .limit(1);
  if (result.error) {
    if (["42P01", "PGRST205"].includes(result.error.code)) return 0;
    throw new Error("Workspace email queue could not be inspected.");
  }
  if (!result.data?.length) return 0;
  return (await deliverJoinRequestNotice(result.data[0].id)) ? 1 : 0;
}
