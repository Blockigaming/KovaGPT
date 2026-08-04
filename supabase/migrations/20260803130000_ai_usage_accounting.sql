-- Direct-OpenAI usage metadata only. Prompts and generated content are deliberately excluded.
create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(), request_id text not null unique,
  idempotency_key text, user_id uuid references auth.users(id) on delete set null,
  guest_ip_hash text, conversation_id uuid, kova_mode text not null check (kova_mode in ('instant','medium','thinking','high','extra_high','pro','utility','image','embedding','deep_research')),
  plan_tier text not null check (plan_tier in ('guest','free','plus','pro')), premium boolean not null default false,
  provider text not null default 'openai' check (provider='openai'), provider_model text not null,
  estimated_input_tokens bigint not null check (estimated_input_tokens>=0), reserved_tokens bigint not null check (reserved_tokens>=0),
  input_tokens bigint not null default 0 check (input_tokens>=0), cached_input_tokens bigint not null default 0 check (cached_input_tokens>=0),
  output_tokens bigint not null default 0 check (output_tokens>=0), reasoning_tokens bigint not null default 0 check (reasoning_tokens>=0),
  actual_billable_tokens bigint check (actual_billable_tokens is null or actual_billable_tokens>=0),
  tool_usage jsonb not null default '{}'::jsonb, estimated_cost_usd numeric(14,8) not null check (estimated_cost_usd>=0),
  actual_cost_usd numeric(14,8) check (actual_cost_usd is null or actual_cost_usd>=0), context_trimmed boolean not null default false,
  status text not null check (status in ('reserved','started','streaming','completed','aborted','timed_out','provider_rejected','provider_failed','client_disconnected','accounting_failed','quota_rejected','stale')),
  latency_ms integer check (latency_ms is null or latency_ms>=0), error_classification text,
  lease_expires_at timestamptz, created_at timestamptz not null default now(), started_at timestamptz, completed_at timestamptz,
  check ((user_id is null) <> (guest_ip_hash is null))
);
create index if not exists ai_usage_events_user_created_idx on public.ai_usage_events(user_id,created_at desc);
create index if not exists ai_usage_events_guest_created_idx on public.ai_usage_events(guest_ip_hash,created_at desc) where guest_ip_hash is not null;
create index if not exists ai_usage_events_active_lease_idx on public.ai_usage_events(lease_expires_at) where status in ('reserved','started','streaming');
create unique index if not exists ai_usage_events_user_idempotency_idx on public.ai_usage_events(user_id,idempotency_key) where user_id is not null and idempotency_key is not null;
create unique index if not exists ai_usage_events_guest_idempotency_idx on public.ai_usage_events(guest_ip_hash,idempotency_key) where guest_ip_hash is not null and idempotency_key is not null;
alter table public.ai_usage_events enable row level security;
revoke all on public.ai_usage_events from public,anon,authenticated;
grant select on public.ai_usage_events to authenticated; grant all on public.ai_usage_events to service_role;
create policy "Users inspect own AI usage" on public.ai_usage_events for select to authenticated using ((select auth.uid())=user_id);

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
    select coalesce(sum(coalesce(actual_billable_tokens,reserved_tokens)),0) into used_day from ai_usage_events where user_id=p_user_id and created_at>=date_trunc('day',now() at time zone 'utc') at time zone 'utc' and status not in ('quota_rejected','provider_rejected','provider_failed','accounting_failed');
    select coalesce(sum(coalesce(actual_billable_tokens,reserved_tokens)),0) into used_month from ai_usage_events where user_id=p_user_id and created_at>=date_trunc('month',now() at time zone 'utc') at time zone 'utc' and status not in ('quota_rejected','provider_rejected','provider_failed','accounting_failed');
    if used_day+p_reserved_tokens>p_daily_limit then return query select null::uuid,'daily_tokens'; return; end if;
    if used_month+p_reserved_tokens>p_monthly_limit then return query select null::uuid,'monthly_tokens'; return; end if;
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

create or replace function public.finalize_ai_generation(p_event_id uuid,p_status text,p_input bigint,p_cached bigint,p_output bigint,p_reasoning bigint,p_actual_cost numeric,p_latency integer,p_tools jsonb,p_error text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_status not in ('completed','aborted','timed_out','provider_rejected','provider_failed','client_disconnected','accounting_failed') then raise exception 'invalid_terminal_status'; end if;
  update ai_usage_events set status=p_status,input_tokens=greatest(p_input,0),cached_input_tokens=greatest(p_cached,0),output_tokens=greatest(p_output,0),reasoning_tokens=least(greatest(p_reasoning,0),greatest(p_output,0)),actual_billable_tokens=greatest(p_input+p_output,0),actual_cost_usd=greatest(p_actual_cost,0),latency_ms=greatest(p_latency,0),tool_usage=coalesce(p_tools,'{}'::jsonb),error_classification=p_error,completed_at=now(),lease_expires_at=null
  where id=p_event_id and status in ('reserved','started','streaming'); return found;
end $$;
revoke all on function public.acquire_ai_generation(text,text,uuid,text,uuid,text,text,boolean,text,bigint,bigint,numeric,boolean,bigint,bigint,integer,integer,integer,integer,integer,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.finalize_ai_generation(uuid,text,bigint,bigint,bigint,bigint,numeric,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.acquire_ai_generation(text,text,uuid,text,uuid,text,text,boolean,text,bigint,bigint,numeric,boolean,bigint,bigint,integer,integer,integer,integer,integer,timestamptz,timestamptz) to service_role;
grant execute on function public.finalize_ai_generation(uuid,text,bigint,bigint,bigint,bigint,numeric,integer,jsonb,text) to service_role;
