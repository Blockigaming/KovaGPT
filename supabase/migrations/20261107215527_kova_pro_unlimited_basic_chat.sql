-- Pro basic chat is included, while advanced usage remains capped.
-- Preserve service-role-only access, idempotency, leases, accounting and locks.
create or replace function public.acquire_ai_generation(
  p_request_id text,p_idempotency_key text,p_user_id uuid,p_guest_ip_hash text,p_conversation_id uuid,p_mode text,p_plan text,p_premium boolean,
  p_model text,p_estimated_input bigint,p_reserved_tokens bigint,p_estimated_cost numeric,p_context_trimmed boolean,
  p_daily_limit bigint,p_monthly_limit bigint,p_premium_limit integer,p_guest_limit integer,p_global_concurrency integer,p_principal_concurrency integer,p_lease_seconds integer,
  p_period_start timestamptz,p_period_end timestamptz)
returns table(event_id uuid,decision text) language plpgsql security definer set search_path=public,pg_temp as $$
declare active_global integer; active_principal integer; used_day bigint; used_month bigint; used_premium integer; used_guest integer; new_id uuid;
begin
  if (p_user_id is null)=(p_guest_ip_hash is null) then return query select null::uuid,'invalid_principal'; return; end if;
  perform pg_advisory_xact_lock(hashtextextended('kova-ai-global',0));
  if exists(select 1 from ai_usage_events where idempotency_key=p_idempotency_key and ((p_user_id is not null and user_id=p_user_id) or (p_guest_ip_hash is not null and guest_ip_hash=p_guest_ip_hash))) then
    return query select null::uuid,'duplicate'; return;
  end if;
  update ai_usage_events set status='stale',completed_at=now(),error_classification='lease_expired' where status in ('reserved','started','streaming') and lease_expires_at<now();
  select count(*) into active_global from ai_usage_events where status in ('reserved','started','streaming') and lease_expires_at>=now();
  if active_global>=p_global_concurrency then return query select null::uuid,'global_concurrency'; return; end if;
  select count(*) into active_principal from ai_usage_events where status in ('reserved','started','streaming') and lease_expires_at>=now() and ((p_user_id is not null and user_id=p_user_id) or (p_guest_ip_hash is not null and guest_ip_hash=p_guest_ip_hash));
  if active_principal>=p_principal_concurrency then return query select null::uuid,'principal_concurrency'; return; end if;
  if p_user_id is not null then
    -- Included Pro Argon Lite chat has no daily/monthly token allowance.
    if not coalesce(p_plan='pro' and p_model='kova-argon-4.6' and p_mode='instant' and p_premium=false,false) then
    select coalesce(sum(coalesce(actual_billable_tokens,reserved_tokens)),0) into used_day from ai_usage_events where user_id=p_user_id and created_at>=date_trunc('day',now() at time zone 'utc') at time zone 'utc' and status not in ('quota_rejected','provider_rejected','provider_failed','accounting_failed') and not (plan_tier='pro' and provider_model='kova-argon-4.6' and kova_mode='instant' and premium=false);
    select coalesce(sum(coalesce(actual_billable_tokens,reserved_tokens)),0) into used_month from ai_usage_events where user_id=p_user_id and created_at>=date_trunc('month',now() at time zone 'utc') at time zone 'utc' and status not in ('quota_rejected','provider_rejected','provider_failed','accounting_failed') and not (plan_tier='pro' and provider_model='kova-argon-4.6' and kova_mode='instant' and premium=false);
    if used_day+p_reserved_tokens>p_daily_limit then return query select null::uuid,'daily_tokens'; return; end if;
    if used_month+p_reserved_tokens>p_monthly_limit then return query select null::uuid,'monthly_tokens'; return; end if;
    end if;
    if p_premium then
      select count(*) into used_premium from ai_usage_events where user_id=p_user_id and premium and created_at>=p_period_start and created_at<p_period_end and status not in ('quota_rejected','provider_rejected','provider_failed','accounting_failed');
      if used_premium>=p_premium_limit then return query select null::uuid,'premium_period'; return; end if;
    end if;
  else
    select count(*) into used_guest from ai_usage_events where guest_ip_hash=p_guest_ip_hash and created_at>=date_trunc('day',now() at time zone 'utc') at time zone 'utc' and status not in ('quota_rejected','provider_rejected','provider_failed','accounting_failed');
    if used_guest>=p_guest_limit then return query select null::uuid,'guest_daily'; return; end if;
  end if;
  begin
    insert into ai_usage_events(request_id,idempotency_key,user_id,guest_ip_hash,conversation_id,kova_mode,plan_tier,premium,provider_model,estimated_input_tokens,reserved_tokens,estimated_cost_usd,context_trimmed,status,lease_expires_at)
    values(p_request_id,p_idempotency_key,p_user_id,p_guest_ip_hash,p_conversation_id,p_mode,p_plan,p_premium,p_model,p_estimated_input,p_reserved_tokens,p_estimated_cost,p_context_trimmed,'reserved',now()+make_interval(secs=>p_lease_seconds)) returning id into new_id;
  exception when unique_violation then return query select null::uuid,'duplicate'; return; end;
  return query select new_id,'acquired';
end $$;

revoke all on function public.acquire_ai_generation(text,text,uuid,text,uuid,text,text,boolean,text,bigint,bigint,numeric,boolean,bigint,bigint,integer,integer,integer,integer,integer,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.acquire_ai_generation(text,text,uuid,text,uuid,text,text,boolean,text,bigint,bigint,numeric,boolean,bigint,bigint,integer,integer,integer,integer,integer,timestamptz,timestamptz) to service_role;
