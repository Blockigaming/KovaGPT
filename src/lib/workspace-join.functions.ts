import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireVerifiedUser } from "./api-auth.server";
import { consumeApplicationRateLimit } from "./distributed-rate-limit.server";
import { loose } from "./supabase-loose";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { teamRpc } from "./team-billing.server";
import { readResponseBytesBounded } from "./endpoint-reliability.mjs";

const workspaceAuth = createMiddleware({type:"function"}).server(async ({next}) => {
  const caller = await requireVerifiedUser(getRequest());
  if (caller instanceof Response) throw caller;
  return next({context:{userId:caller.userId}});
});
export type AvailableWorkspace = { team_id:string; team_name:string; request_status:string };
export const findAvailableWorkspaces = createServerFn({method:"GET"})
  .middleware([workspaceAuth])
  .handler(async ({context}):Promise<AvailableWorkspace[]> => {
    const result = await teamRpc("discover_verified_team_workspaces",{p_actor:context.userId});
    return Array.isArray(result) ? result as AvailableWorkspace[] : [];
  });
export const submitWorkspaceJoinRequest = createServerFn({method:"POST"})
  .middleware([workspaceAuth])
  .validator((input:unknown)=>z.object({teamId:z.string().uuid()}).strict().parse(input))
  .handler(async ({data,context}) => {
    const rate = await consumeApplicationRateLimit({identity:"user:"+context.userId,
      action:"workspace_join_request",limit:3,windowSeconds:3600});
    if (!rate.allowed) throw new Error("Too many requests. Try again later.");
    const id=await teamRpc("request_verified_team_join",{p_actor:context.userId,p_team:data.teamId});
    // The request is durable, even if email is delayed or unavailable.
    // Email is sent by the separate retriable delivery operation.
    await deliverJoinRequestNotice(String(id)).catch(()=>{});
    return {id:String(id),status:"pending" as const};
  });

export async function deliverJoinRequestNotice(id:string) {
  if (!process.env.RESEND_API_KEY) return false;
  const db=loose(supabaseAdmin);
  const request=await teamRpc("claim_team_join_notification",{p_id:id}) as {
    id:string;team_id:string;requester_email:string;status:string;notification_sent_at:string|null;
  } | null;
  if (!request || request.status!=="pending" || request.notification_sent_at) return false;
  const team=await db.from("team_workspaces").select("owner_id,name").eq("id",request.team_id).single();
  if(team.error || !team.data) return false;
  const owner=await teamRpc("kova_auth_directory_email",{p_account_id:team.data.owner_id}).catch(()=>null);
  if(typeof owner!=="string" || !owner.includes("@")) return false;
  const response=await fetch("https://api.resend.com/emails",{
    method:"POST",redirect:"error",signal:AbortSignal.timeout(10000),
    headers:{"Authorization":"Bearer "+process.env.RESEND_API_KEY,"Content-Type":"application/json",
      "Idempotency-Key":"kova-workspace-join:"+id},
    body:JSON.stringify({from:"KovaGPT <noreply@kovagpt.com>",to:[owner],
      subject:"Workspace membership request",
      text:"A verified account has requested to join your KovaGPT workspace "+team.data.name+
      ". Review the request in your team administration area. Request ID: "+id})
  });
  const text=new TextDecoder().decode(await readResponseBytesBounded(response,8192,{timeoutMs:10000}));
  let result:unknown;try{result=JSON.parse(text)}catch{return false}
  const providerId=(result as {id?:unknown})?.id;
  if(!response.ok || typeof providerId!=="string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(providerId))return false;
  const committed=await db.from("team_join_requests").update({
    notification_sent_at:new Date().toISOString(),
    notification_provider_id:providerId,
    notification_lease_until:null,
  }).eq("id",id).is("notification_sent_at",null);
  return !committed.error;
}

/** Existing signed email worker calls this only after its primary queue has spare capacity. */
export async function retryWorkspaceJoinNotification() {
  if (!process.env.RESEND_API_KEY) return 0;
  const now=new Date();
  const oldest=new Date(now.getTime()-20*60*60*1000).toISOString();
  const result=await loose(supabaseAdmin).from("team_join_requests").select("id")
    .eq("status","pending")
    .is("notification_sent_at",null)
    .lt("notification_attempts",6)
    .gt("requested_at",oldest)
    .or("notification_lease_until.is.null,notification_lease_until.lt."+now.toISOString())
    .order("requested_at",{ascending:true})
    .limit(1);
  if (result.error) {
    if (["42P01","PGRST205"].includes(result.error.code)) return 0;
    throw new Error("Workspace email queue could not be inspected.");
  }
  if (!result.data?.length) return 0;
  return await deliverJoinRequestNotice(result.data[0].id) ? 1 : 0;
}
export const listTeamJoinRequests = createServerFn({method:"GET"})
  .middleware([workspaceAuth])
  .handler(async ({context}) => {
    const db=loose(supabaseAdmin);
    const owned=await db.from("team_workspaces").select("id").eq("owner_id",context.userId);
    if(owned.error)throw new Error("Workspace requests could not be loaded.");
    const ids=(owned.data??[]).map((item:{id:string})=>item.id);
    if(!ids.length)return [];
    const result=await db.from("team_join_requests").select("id,team_id,requester_email,status,requested_at")
      .in("team_id",ids).eq("status","pending").limit(100);
    if(result.error)throw new Error("Workspace requests could not be loaded.");
    return result.data??[];
  });
export const reviewTeamJoinRequest=createServerFn({method:"POST"})
  .middleware([workspaceAuth])
  .validator((input:unknown)=>z.object({requestId:z.string().uuid(),approve:z.boolean()}).strict().parse(input))
  .handler(async ({data,context})=>({
    ok:await teamRpc("review_verified_team_join",
      {p_actor:context.userId,p_id:data.requestId,p_approve:data.approve}),
    // Approval permits an existing paid-seat invitation; it does NOT add a member.
    membershipCreated:false
  }));
