-- Dormant, service-only production worker contract. Installation schedules no
-- job and sends no mail. Existing challenge/preference/lease checks remain the
-- dispatch authority; request bodies never select recipients or queue records.
begin;

create table kova_private.email_worker_runs (
  run_id uuid primary key,
  issued_at timestamptz not null,
  claimed_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz
);
create index email_worker_runs_expiry on kova_private.email_worker_runs(claimed_at);
create table kova_private.email_worker_state (
  singleton boolean primary key default true check (singleton),
  run_id uuid,
  lease_until timestamptz,
  account_event_id uuid,
  check ((run_id is null) = (lease_until is null))
);
insert into kova_private.email_worker_state(singleton) values (true);
alter table kova_private.email_worker_runs enable row level security;
alter table kova_private.email_worker_state enable row level security;
revoke all on kova_private.email_worker_runs,kova_private.email_worker_state
  from public,anon,authenticated,service_role;

create function public.kova_email_claim_worker_run(p_run_id uuid,p_issued_at timestamptz)
returns boolean language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare v_now timestamptz:=clock_timestamp(); v_state kova_private.email_worker_state;
begin
  if p_run_id is null or p_issued_at is null or not isfinite(p_issued_at)
    or p_issued_at<v_now-interval '60 seconds' or p_issued_at>v_now+interval '5 seconds' then
    raise exception 'email_worker_request_invalid' using errcode='22023';
  end if;
  select * into v_state from kova_private.email_worker_state where singleton for update;
  if not found then raise exception 'email_worker_state_missing'; end if;
  if v_state.lease_until>v_now then return false; end if;
  -- Expired request signatures cannot authenticate again. Keep a bounded
  -- replay receipt; deleting older receipts cannot revive their signatures.
  delete from kova_private.email_worker_runs where run_id in (
    select r.run_id from kova_private.email_worker_runs r
      where r.claimed_at<v_now-interval '1 day' order by r.claimed_at limit 100
  );
  insert into kova_private.email_worker_runs(run_id,issued_at)
    values(p_run_id,p_issued_at) on conflict do nothing;
  if not found then return false; end if;
  update kova_private.email_worker_state set run_id=p_run_id,lease_until=v_now+interval '180 seconds',account_event_id=null
    where singleton;
  return true;
end $$;

create function public.kova_email_worker_scope(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare v_now timestamptz:=clock_timestamp(); v_auth jsonb; v_events jsonb; v_event_id uuid;
begin
  if p_run_id is null or not exists(select 1 from kova_private.email_worker_state
    where singleton and run_id=p_run_id and lease_until>v_now+interval '120 seconds') then
    raise exception 'email_worker_lease_lost' using errcode='42501';
  end if;
  -- At most one challenge and one account notice per invocation. Select only
  -- the existing owned queues. Their claim/prepare RPCs recheck current proof,
  -- preferences, suppression, expiry and idempotency before any provider call.
  select jsonb_build_object('messageIds',jsonb_build_array(q.message->>'message_id'),
    'recipients',jsonb_build_array(q.message->>'to'),'issuedNotBefore',v_now-interval '59 minutes')
    into v_auth from pgmq.q_auth_emails q
    where q.vt<=v_now and q.enqueued_at>=v_now-interval '59 minutes'
      and q.message->>'purpose'='auth'
      and q.message->>'label' in ('kova-auth-verification','kova-auth-recovery')
      and q.message->>'message_id' ~ '^[A-Za-z0-9_-]{43}$'
      and q.message->>'to'=lower(btrim(q.message->>'to'))
      and char_length(q.message->>'to') between 3 and 320
      and q.message->>'to' ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    order by q.msg_id limit 1;
  select jsonb_build_object('eventIds',jsonb_build_array(e.id),
    'issuedNotBefore',v_now-interval '24 hours'),e.id
    into v_events,v_event_id from kova_private.account_email_events e
    where e.status='pending' and e.recipient is not null and e.expires_at>v_now
      and e.occurred_at>=v_now-interval '24 hours'
    order by e.occurred_at,e.id limit 1;
  update kova_private.email_worker_state set account_event_id=v_event_id
    where singleton and run_id=p_run_id and lease_until>v_now+interval '120 seconds';
  if not found then raise exception 'email_worker_lease_lost' using errcode='42501'; end if;
  return jsonb_build_object('auth',v_auth,'account',v_events);
end $$;

-- Worker-specific claim keeps the full existing 24-hour outbox retention.
-- The staging operator's 15-minute scope is deliberately not widened. No
-- caller-supplied event ID or recipient can reach this worker-only boundary.
create function public.kova_email_claim_account_dispatch(p_run_id uuid)
returns table(id uuid,event_type text,recipient text,occurred_at timestamptz,metadata jsonb,lease_token uuid,lease_expires_at timestamptz)
language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
#variable_conflict use_column
declare v_now timestamptz:=clock_timestamp(); v_event kova_private.account_email_events; v_id uuid;
begin
  select account_event_id into v_id from kova_private.email_worker_state
    where singleton and run_id=p_run_id and lease_until>v_now+interval '90 seconds';
  if not found then raise exception 'email_worker_lease_lost' using errcode='42501'; end if;
  if v_id is null then return; end if;
  perform public.account_email_purge_expired(100);
  select * into v_event from kova_private.account_email_events e
    where e.id=v_id and e.status='pending' and e.recipient is not null
      and e.expires_at>v_now and e.occurred_at>=v_now-interval '24 hours'
    for update skip locked;
  if not found then return; end if;
  if not kova_private.account_email_dispatch_allowed(v_event) then
    update kova_private.account_email_events set status='suppressed',recipient=null,updated_at=v_now
      where id=v_event.id;
    return;
  end if;
  update kova_private.account_email_events set status='leased',lease_token=gen_random_uuid(),
    lease_until=v_now+interval '2 minutes',updated_at=v_now where id=v_event.id returning * into v_event;
  id:=v_event.id;event_type:=v_event.event_type;recipient:=v_event.recipient;occurred_at:=v_event.occurred_at;
  metadata:=v_event.metadata;lease_token:=v_event.lease_token;lease_expires_at:=v_event.lease_until;
  return next;
end $$;

create function public.kova_email_finish_worker_run(p_run_id uuid)
returns boolean language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare v_now timestamptz:=clock_timestamp();
begin
  update kova_private.email_worker_state set run_id=null,lease_until=null,account_event_id=null
    where singleton and run_id=p_run_id and lease_until>v_now;
  if not found then return false; end if;
  update kova_private.email_worker_runs set finished_at=v_now where run_id=p_run_id;
  return true;
end $$;

revoke all on function public.kova_email_claim_worker_run(uuid,timestamptz),
  public.kova_email_worker_scope(uuid),public.kova_email_claim_account_dispatch(uuid),public.kova_email_finish_worker_run(uuid)
  from public,anon,authenticated;
grant execute on function public.kova_email_claim_worker_run(uuid,timestamptz),
  public.kova_email_worker_scope(uuid),public.kova_email_claim_account_dispatch(uuid),public.kova_email_finish_worker_run(uuid) to service_role;
commit;
