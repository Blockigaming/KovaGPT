import { publishKovaNotice } from "@/components/KovaNotificationSurface";
import { useEffect, useState } from "react";
import { listTeamJoinRequests, reviewTeamJoinRequest } from "@/lib/workspace-join.functions";
type RequestRow={id:string;team_id:string;requester_email:string;status:string;requested_at:string};
export function WorkspaceJoinAdminPanel({teamId}:{teamId:string}){
  const [requests,setRequests]=useState<RequestRow[]>([]);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState("");
  useEffect(()=>{
    let canceled=false;
    void listTeamJoinRequests().then(rows=>{
      if(!canceled)setRequests((rows as RequestRow[]).filter(r=>r.team_id===teamId));
    }).catch(()=>{if(!canceled)setError("Couldn't load membership requests.");});
    return ()=>{canceled=true;};
  },[teamId]);
  if(!requests.length&&!error)return null;
  return <section className="m-5 rounded-2xl border border-border p-4 sm:m-7" aria-label="Workspace join requests">
    <h3 className="font-semibold">Requests to join</h3>
    <p className="mt-1 text-sm text-muted-foreground">Approve a request to allow an invitation. Membership still requires a paid team seat and a separate invitation.</p>
    {error&&<p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
    <div className="mt-3 space-y-3">{requests.map(request=><div key={request.id}
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
      <span className="min-w-0 break-all text-sm">{request.requester_email}</span>
      <div className="flex gap-2">
        {([true,false] as const).map(approve=><button key={String(approve)}
          type="button" disabled={busy!==null}
          className="min-h-11 rounded-full border border-border px-4 text-sm hover:bg-muted disabled:opacity-50"
          onClick={async()=>{
            setBusy(request.id);setError("");
            try {
              const result=await reviewTeamJoinRequest({data:{requestId:request.id,approve}});
              if(!result.ok)throw Error("Request not saved");
              setRequests(items=>items.filter(item=>item.id!==request.id));
              publishKovaNotice({id:approve?"workspace_join_approved":"workspace_join_denied",title:approve?"Request approved":"Request denied",message:approve?"You can now send an invitation from your team administration page.":"The request has been denied.",confirmed:true});
            }catch{setError("Review failed. Refresh and try again.");}
            finally{setBusy(null);}
          }}>{busy===request.id?"Saving…":approve?"Approve request":"Deny"}</button>)}
      </div>
    </div>)}</div>
  </section>;
}
