-- Work receipts reconcile canonical consumer accounting without replaying AI work.
-- No prompts or output bytes are retained here; only immutable receipt hashes and totals.
create table public.work_accounting_settlements (
  event_id uuid primary key references public.ai_usage_events(id),
  run_id uuid not null references public.work_execution_runs(id) on delete cascade,
  owner_id uuid not null,
  step_id uuid not null,
  step_epoch bigint not null check(step_epoch>0),
  input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),
  receipt_hash text not null check(receipt_hash ~ '^[a-f0-9]{64}$'),
  totals jsonb not null check(pg_column_size(totals)<=4096),
  created_at timestamptz not null default now(),
  unique(run_id,step_epoch,step_id)
);
alter table public.work_accounting_settlements enable row level security;
revoke all on public.work_accounting_settlements from public,anon,authenticated;
grant select,insert on public.work_accounting_settlements to service_role;

create function public.settle_work_accounting(
  p_owner uuid,p_run uuid,p_step uuid,p_epoch bigint,p_event uuid,p_input_hash text,
  p_receipt_hash text,p_model text,p_input bigint,p_cached bigint,p_output bigint,
  p_reasoning bigint,p_actual_cost numeric,p_latency integer
) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.work_execution_runs%rowtype; e public.ai_usage_events%rowtype;
  prior public.work_accounting_settlements%rowtype; totals jsonb; cost numeric;
begin
  if p_owner is null or p_run is null or p_step is null or p_event is null or p_epoch is null or p_epoch<1
    or p_input_hash is null or p_input_hash !~ '^[a-f0-9]{64}$'
    or p_receipt_hash is null or p_receipt_hash !~ '^[a-f0-9]{64}$'
    or p_model is null or length(p_model)>100
    or p_input is null or p_cached is null or p_output is null or p_reasoning is null
    or p_latency is null or p_actual_cost is null
    or p_input<0 or p_input>1000000000 or p_output<0 or p_output>1000000000
    or p_cached<0 or p_cached>p_input or p_reasoning<0 or p_reasoning>p_output
    or p_latency<0 or p_actual_cost<0 or p_actual_cost>1000000
    or p_actual_cost::text in ('NaN','Infinity','-Infinity') then
    raise exception 'work_accounting_receipt_invalid';
  end if;
  cost:=round(p_actual_cost,8);
  totals:=jsonb_build_object('model',p_model,'input',p_input,'cached',p_cached,'output',p_output,
    'reasoning',p_reasoning,'cost',cost,'latency',p_latency);
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
  if not kova_private.auth_user_exists(p_owner)
    or exists(select 1 from public.account_deletion_fences where user_id=p_owner) then
    raise exception 'work_account_unavailable' using errcode='42501';
  end if;
  -- Match canonical admission's lock before locking its usage row. Settlement
  -- remains available during Lockdown, disabled generation, and owner cancellation.
  perform pg_advisory_xact_lock(hashtextextended('kova-ai-global',0));
  select * into r from public.work_execution_runs where id=p_run and owner_id=p_owner for update;
  if not found or r.state->>'model' is distinct from p_model then
    raise exception 'work_accounting_binding_invalid';
  end if;
  select * into e from public.ai_usage_events where id=p_event for update;
  if not found or e.user_id is distinct from p_owner or e.provider_model is distinct from p_model
    or e.idempotency_key is distinct from 'work:'||p_run::text||':'||p_epoch::text||':'||p_step::text then
    raise exception 'work_accounting_binding_invalid';
  end if;
  select * into prior from public.work_accounting_settlements where event_id=p_event;
  if found then
    if prior.run_id is distinct from p_run or prior.owner_id is distinct from p_owner
      or prior.step_id is distinct from p_step or prior.step_epoch is distinct from p_epoch
      or prior.input_hash is distinct from p_input_hash or prior.receipt_hash is distinct from p_receipt_hash
      or prior.totals is distinct from totals then raise exception 'work_accounting_receipt_conflict'; end if;
    return true;
  end if;
  -- A cancelled/recovered run can have a newer epoch; only the persisted step's
  -- original epoch/input/reservation authorize its late authoritative receipt.
  if r.state#>>'{step,id}' is distinct from p_step::text
    or r.state#>>'{step,reservationId}' is distinct from p_event::text
    or r.state#>>'{step,inputHash}' is distinct from p_input_hash
    or (r.state#>>'{step,epoch}')::bigint is distinct from p_epoch then
    raise exception 'work_accounting_binding_invalid';
  end if;
  if e.status='completed' then
    -- Handles an old writer or a lost response after its successful finalization.
    if e.input_tokens is distinct from p_input or e.cached_input_tokens is distinct from p_cached
      or e.output_tokens is distinct from p_output or e.reasoning_tokens is distinct from p_reasoning
      or e.actual_billable_tokens is distinct from p_input+p_output
      or e.actual_cost_usd is distinct from cost or e.latency_ms is distinct from p_latency then
      raise exception 'work_accounting_receipt_conflict';
    end if;
  elsif e.status in ('reserved','started','streaming','stale') then
    if (e.actual_billable_tokens is not null and e.actual_billable_tokens>p_input+p_output)
      or (e.actual_cost_usd is not null and e.actual_cost_usd>cost)
      or e.input_tokens>p_input or e.output_tokens>p_output then
      raise exception 'work_accounting_receipt_conflict';
    end if;
    update public.ai_usage_events set status='completed',input_tokens=p_input,cached_input_tokens=p_cached,
      output_tokens=p_output,reasoning_tokens=p_reasoning,actual_billable_tokens=p_input+p_output,
      actual_cost_usd=cost,latency_ms=p_latency,tool_usage=jsonb_build_object('calls',0),
      error_classification=null,completed_at=now(),lease_expires_at=null where id=p_event;
  else raise exception 'work_accounting_terminal_conflict';
  end if;
  insert into public.work_accounting_settlements(event_id,run_id,owner_id,step_id,step_epoch,input_hash,receipt_hash,totals)
    values(p_event,p_run,p_owner,p_step,p_epoch,p_input_hash,p_receipt_hash,totals);
  return true;
end $$;
revoke all on function public.settle_work_accounting(uuid,uuid,uuid,bigint,uuid,text,text,text,bigint,bigint,bigint,bigint,numeric,integer) from public,anon,authenticated;
grant execute on function public.settle_work_accounting(uuid,uuid,uuid,bigint,uuid,text,text,text,bigint,bigint,bigint,bigint,numeric,integer) to service_role;
