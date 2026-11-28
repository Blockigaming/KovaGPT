-- Accelerate a pending webhook retry without resetting its lifetime or attempt budget.
create function public.retry_developer_webhook_v1(
  p_owner uuid,p_key uuid,p_project uuid,p_endpoint uuid,p_event uuid,p_expected_attempts integer
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.developer_webhook_deliveries_v1%rowtype;
begin
  if p_owner is null or p_expected_attempts is null or p_expected_attempts not between 1 and 4
    then raise exception 'developer_webhook_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
  if not public.developer_webhook_key_active_v1(p_owner,p_project,p_key)
    then raise exception 'developer_scope_required' using errcode='42501'; end if;
  perform 1 from public.developer_webhook_endpoints_v1
    where project_id=p_project and id=p_endpoint and owner_id=p_owner and api_key_id=p_key for update;
  if not found then raise exception 'developer_webhook_not_found'; end if;
  select * into d from public.developer_webhook_deliveries_v1
    where project_id=p_project and endpoint_id=p_endpoint and id=p_event for update;
  if not found then raise exception 'developer_webhook_not_found'; end if;
  if d.status<>'pending' or d.attempts<>p_expected_attempts or d.created_at<now()-interval '7 days'
    then raise exception 'developer_webhook_conflict'; end if;
  update public.developer_webhook_deliveries_v1 set next_attempt_at=least(next_attempt_at,clock_timestamp())
    where project_id=p_project and endpoint_id=p_endpoint and id=p_event returning * into d;
  return jsonb_build_object('id',d.id,'status',d.status);
end $$;
revoke all on function public.retry_developer_webhook_v1(uuid,uuid,uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.retry_developer_webhook_v1(uuid,uuid,uuid,uuid,uuid,integer) to service_role;
