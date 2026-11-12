-- Recheck the request against the current verified account and workspace when
-- the owner approves it. A stale request can still be denied and cleared.
create or replace function public.review_verified_team_join(p_actor uuid,p_id uuid,p_approve boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.team_join_requests; t public.team_workspaces;
begin
 select * into r from public.team_join_requests where id=p_id for update;
 if r.id is null then raise exception 'Request not found'; end if;
 select * into t from public.team_workspaces where id=r.team_id for update;
 if t.owner_id is distinct from p_actor
   or kova_private.team_verified_email(p_actor) is null
   or exists(select 1 from public.account_deletion_fences f where f.user_id=p_actor)
 then raise exception 'Only the verified workspace owner may review this request'; end if;
 if r.status<>'pending' then raise exception 'Request is no longer pending'; end if;
 if p_approve and (
   lower(kova_private.team_verified_email(r.requester_id)) is distinct from r.requester_email
   or not exists(
     select 1 from public.discover_verified_team_workspaces(r.requester_id) d
     where d.team_id=r.team_id
   )
 ) then raise exception 'Request eligibility has changed'; end if;
 update public.team_join_requests set status=case when p_approve then 'approved' else 'denied' end,
 reviewed_at=now(),reviewed_by=p_actor where id=p_id;
 return true;
end $$;
revoke all on function public.review_verified_team_join(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.review_verified_team_join(uuid,uuid,boolean) to service_role;
