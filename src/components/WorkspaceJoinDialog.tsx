import { useState } from "react";
import { submitWorkspaceJoinRequest, type AvailableWorkspace } from "@/lib/workspace-join.functions";

export function WorkspaceJoinDialog({workspaces,open,onClose,onRequested}:{
  workspaces:AvailableWorkspace[];open:boolean;onClose:()=>void;
  onRequested:(teamId:string)=>void;
}) {
  const [submitting,setSubmitting]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  if(!open || !workspaces.length)return null;
  return <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
    <section className="w-full max-h-[85dvh] max-w-[460px] overflow-y-auto rounded-t-3xl border border-border bg-popover p-5 text-popover-foreground shadow-2xl sm:rounded-3xl sm:p-6"
      role="dialog" aria-modal="true" aria-labelledby="workspace-join-title">
      <h2 id="workspace-join-title" className="text-xl font-semibold">Join your workspace?</h2>
      <p className="mt-2 text-sm text-muted-foreground">We found a KovaGPT workspace associated with your verified email domain. You can request access from its administrator.</p>
      <div className="mt-5 space-y-2">
        {workspaces.map(workspace=><div key={workspace.team_id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border p-3">
          <div className="min-w-0">
            <strong className="block truncate text-sm">{workspace.team_name}</strong>
            <span className="text-xs text-muted-foreground">{workspace.request_status==="pending"?"Request pending":workspace.request_status==="approved"?"Approved — awaiting invitation":"Verified domain match"}</span>
          </div>
          <button type="button" disabled={workspace.request_status==="pending"||workspace.request_status==="approved"||submitting!==null}
            className="min-h-11 rounded-full bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
            onClick={async()=>{
              setError(null);setSubmitting(workspace.team_id);
              try {
                const result=await submitWorkspaceJoinRequest({data:{teamId:workspace.team_id}});
                if(result.status==="pending")onRequested(workspace.team_id);
              } catch {setError("Couldn't send your request. Check your connection and try again.");}
              finally {setSubmitting(null);}
            }}>{submitting===workspace.team_id?"Sending…":workspace.request_status==="pending"?"Requested":"Request to join"}</button>
        </div>)}
      </div>
      {error&&<p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      <button className="mt-5 min-h-12 w-full rounded-full bg-secondary text-secondary-foreground sm:min-h-11" type="button" onClick={onClose}>Not now</button>
    </section>
  </div>;
}
