-- Source only: no rates, credit offers, administrator identities or activation are seeded.
alter table public.api_pricing_versions drop constraint api_pricing_versions_approved_by_fkey;
alter table public.api_pricing_versions add constraint api_pricing_versions_approved_by_fkey
 foreign key(approved_by) references auth.users(id) on delete set null;
create table public.developer_pricing_drafts (
  id uuid primary key, kind text not null check(kind in ('pricing','credit_offer')),
  revision bigint not null check(revision between 1 and 100000), canonical_payload text not null,
  payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'draft' check(status in ('draft','approved','retired')),
  created_by uuid not null, updated_by uuid not null, approved_by uuid,
  approved_at timestamptz, result_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(octet_length(canonical_payload) between 2 and 131072),
  check(encode(sha256(convert_to(canonical_payload,'UTF8')),'hex')=payload_hash),
  check(jsonb_typeof(canonical_payload::jsonb)='object')
);
create table public.developer_pricing_administration_events (
  id bigint generated always as identity primary key, draft_id uuid not null references public.developer_pricing_drafts(id),
  actor_id uuid not null, kind text not null check(kind in ('saved','approved','retired')),
  revision bigint not null, payload_hash text not null, reason text, created_at timestamptz not null default now()
);
alter table public.developer_pricing_drafts enable row level security;
alter table public.developer_pricing_administration_events enable row level security;
revoke all on public.developer_pricing_drafts,public.developer_pricing_administration_events from public,anon,authenticated;
grant select,insert,update on public.developer_pricing_drafts to service_role;
grant select,insert on public.developer_pricing_administration_events to service_role;
grant usage,select on sequence public.developer_pricing_administration_events_id_seq to service_role;
create index developer_pricing_drafts_updated_idx on public.developer_pricing_drafts(updated_at desc,id);
create function public.guard_approved_pricing_draft() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.status in ('approved','retired') and (tg_op='DELETE' or
    (to_jsonb(new)-array['status','updated_by','updated_at']) is distinct from (to_jsonb(old)-array['status','updated_by','updated_at']) or
    new.status not in ('approved','retired') or (old.status='retired' and new.status<>'retired')) then raise exception 'pricing_admin_draft_immutable';end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger developer_pricing_approved_draft_immutable before update or delete on public.developer_pricing_drafts for each row execute function public.guard_approved_pricing_draft();
create trigger developer_pricing_events_immutable before update or delete on public.developer_pricing_administration_events
 for each row execute function public.prevent_financial_entry_mutation();

create function public.guard_approved_pricing() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.status in ('approved','retired') and (tg_op='DELETE' or
    (to_jsonb(new)-array['status','approved_by']) is distinct from (to_jsonb(old)-array['status','approved_by']) or
    (new.approved_by is distinct from old.approved_by and new.approved_by is not null) or
    new.status not in ('approved','retired') or (old.status='retired' and new.status<>'retired')) then
    raise exception 'approved_pricing_immutable';
  end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger api_approved_pricing_immutable before update or delete on public.api_pricing_versions
 for each row execute function public.guard_approved_pricing();
create function public.guard_verified_upstream_price() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.verification_status in ('approved','expired') and (tg_op='DELETE' or
    (to_jsonb(new)-array['active','verification_status','verifier']) is distinct from (to_jsonb(old)-array['active','verification_status','verifier']) or
    (new.verifier is distinct from old.verifier and new.verifier is not null) or
    new.verification_status not in ('approved','expired') or (not old.active and new.active) or
    (old.verification_status='expired' and new.verification_status<>'expired')) then raise exception 'verified_upstream_price_immutable';end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger upstream_verified_price_immutable before update or delete on public.upstream_price_registry
 for each row execute function public.guard_verified_upstream_price();

create function public.save_developer_pricing_draft(p_admin uuid,p_id uuid,p_kind text,p_expected_revision bigint,
 p_expected_hash text,p_canonical text,p_hash text) returns public.developer_pricing_drafts
 language plpgsql security invoker set search_path='' as $$
declare d public.developer_pricing_drafts%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('developer-pricing-administration',0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_admin::text,20260903204500));
  if not kova_private.auth_user_exists(p_admin) or exists(select 1 from public.account_deletion_fences where user_id=p_admin) then raise exception 'pricing_admin_account_unavailable';end if;
  if p_id is null or p_kind not in ('pricing','credit_offer') or p_expected_revision is null or p_expected_revision<0 or
    p_hash is null or p_hash is distinct from encode(sha256(convert_to(p_canonical,'UTF8')),'hex') then raise exception 'pricing_admin_draft_invalid';end if;
  select * into d from public.developer_pricing_drafts where id=p_id for update;
  if found then
    if d.kind<>p_kind or d.status<>'draft' then raise exception 'pricing_admin_draft_immutable';end if;
    if d.payload_hash=p_hash and d.revision in (p_expected_revision,p_expected_revision+1) then return d;end if;
    if d.revision<>p_expected_revision or d.payload_hash is distinct from p_expected_hash then raise exception 'pricing_admin_draft_conflict';end if;
    update public.developer_pricing_drafts set revision=revision+1,canonical_payload=p_canonical,payload_hash=p_hash,updated_by=p_admin,updated_at=clock_timestamp() where id=p_id returning * into d;
  else
    if p_expected_revision<>0 or p_expected_hash is not null then raise exception 'pricing_admin_draft_conflict';end if;
    if (select count(*) from public.developer_pricing_drafts)>=10000 then raise exception 'pricing_admin_capacity';end if;
    insert into public.developer_pricing_drafts(id,kind,revision,canonical_payload,payload_hash,created_by,updated_by)
      values(p_id,p_kind,1,p_canonical,p_hash,p_admin,p_admin) returning * into d;
  end if;
  insert into public.developer_pricing_administration_events(draft_id,actor_id,kind,revision,payload_hash)
    values(p_id,p_admin,'saved',d.revision,d.payload_hash);
  return d;
end $$;

create function public.approve_developer_pricing_draft(p_admin uuid,p_id uuid,p_revision bigint,p_hash text)
 returns public.developer_pricing_drafts language plpgsql security invoker set search_path='' as $$
declare d public.developer_pricing_drafts%rowtype; proposal jsonb; v jsonb; row jsonb;
  result uuid; registry_ids jsonb:='[]'; price_id uuid; config jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('developer-pricing-administration',0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_admin::text,20260903204500));
  if not kova_private.auth_user_exists(p_admin) or exists(select 1 from public.account_deletion_fences where user_id=p_admin) then raise exception 'pricing_admin_account_unavailable';end if;
  select * into d from public.developer_pricing_drafts where id=p_id for update;
  if not found or d.revision is distinct from p_revision or d.payload_hash is distinct from p_hash then raise exception 'pricing_admin_draft_conflict';end if;
  if d.status='approved' then return d;end if;
  if d.status<>'draft' then raise exception 'pricing_admin_draft_immutable';end if;
  proposal:=d.canonical_payload::jsonb;
  if d.kind='pricing' then
    v:=proposal->'version';
    if v->>'expires_at' is null or v->>'effective_at' is null or v->>'margin_floor' is null or v->>'currency' is null or
      (v->>'expires_at')::timestamptz<=greatest(clock_timestamp(),(v->>'effective_at')::timestamptz) or
      (v->>'expires_at')::timestamptz>clock_timestamp()+interval '90 days' or
      (v->>'margin_floor')::numeric<.5 or (v->>'margin_floor')::numeric>=1 or
      (v->>'currency') !~ '^[A-Z]{3}$' or jsonb_array_length(proposal->'registry') not between 1 and 256 then raise exception 'pricing_admin_terms_invalid';end if;
    for row in select value from jsonb_array_elements(proposal->'registry') loop
      if row->>'currency' is distinct from v->>'currency' or (row->>'effective_at')::timestamptz>(v->>'effective_at')::timestamptz or
        (row->>'expires_at')::timestamptz<(v->>'expires_at')::timestamptz or coalesce(row#>>'{evidence,sha256}','') !~ '^[a-f0-9]{64}$' or
        coalesce(length(row#>>'{evidence,reference}'),0)=0 or (row#>>'{evidence,verifiedAt}')::timestamptz>clock_timestamp() or
        (row#>>'{evidence,verifiedAt}')::timestamptz<clock_timestamp()-interval '90 days' then raise exception 'pricing_admin_evidence_invalid';end if;
      insert into public.upstream_price_registry(version,provider,upstream_model,billing_dimension,unit,unit_quantity,unit_price,currency,source,
        verification_status,effective_at,expires_at,last_verified_at,verifier,active,evidence)
      values((v->>'version')::integer,row->>'provider',row->>'upstream_model',row->>'billing_dimension',row->>'unit',(row->>'unit_quantity')::numeric,
        (row->>'unit_price')::numeric,row->>'currency',row->>'source','approved',(row->>'effective_at')::timestamptz,(row->>'expires_at')::timestamptz,
        (row#>>'{evidence,verifiedAt}')::timestamptz,p_admin,true,row->'evidence') returning id into price_id;
      registry_ids:=registry_ids||jsonb_build_array(price_id);
    end loop;
    config:=(v->'public_price_configuration')||jsonb_build_object('registryIds',registry_ids,'administrationDraftId',d.id,'administrationHash',d.payload_hash);
    insert into public.api_pricing_versions(version,currency,margin_floor,risk_buffer_percentage,minimum_request_charge,rounding_increment,
      allowance_configuration,public_price_configuration,status,approved_by,approved_at,effective_at,expires_at)
    values((v->>'version')::integer,v->>'currency',(v->>'margin_floor')::numeric,(v->>'risk_buffer_percentage')::numeric,
      (v->>'minimum_request_charge')::numeric,(v->>'rounding_increment')::numeric,v->'allowance_configuration',config,'approved',p_admin,clock_timestamp(),
      (v->>'effective_at')::timestamptz,(v->>'expires_at')::timestamptz) returning id into result;
  else
    if (proposal->>'expires_at')::timestamptz<=clock_timestamp() or (proposal->>'expires_at')::timestamptz>clock_timestamp()+interval '90 days' then raise exception 'pricing_admin_expiry_invalid';end if;
    insert into public.developer_credit_offers(name,environment,stripe_price_id,currency,subtotal_amount,credits_amount,refund_reserve,dispute_reserve,maximum_processor_fee,
      tax_mode,tax_review_reference,approved_by,approved_at,expires_at,active)
    values(proposal->>'name',proposal->>'environment',proposal->>'stripe_price_id',proposal->>'currency',(proposal->>'subtotal_amount')::bigint,(proposal->>'credits_amount')::bigint,
      (proposal->>'refund_reserve')::bigint,(proposal->>'dispute_reserve')::bigint,(proposal->>'maximum_processor_fee')::bigint,proposal->>'tax_mode',proposal->>'tax_review_reference',
      p_admin,clock_timestamp(),(proposal->>'expires_at')::timestamptz,true) returning id into result;
  end if;
  update public.developer_pricing_drafts set status='approved',approved_by=p_admin,approved_at=clock_timestamp(),result_id=result,updated_at=clock_timestamp() where id=p_id returning * into d;
  insert into public.developer_pricing_administration_events(draft_id,actor_id,kind,revision,payload_hash) values(p_id,p_admin,'approved',d.revision,d.payload_hash);
  return d;
end $$;

create function public.retire_developer_pricing_draft(p_admin uuid,p_id uuid,p_revision bigint,p_hash text,p_reason text)
 returns public.developer_pricing_drafts language plpgsql security invoker set search_path='' as $$
declare d public.developer_pricing_drafts%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('developer-pricing-administration',0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_admin::text,20260903204500));
  if not kova_private.auth_user_exists(p_admin) or exists(select 1 from public.account_deletion_fences where user_id=p_admin) then raise exception 'pricing_admin_account_unavailable';end if;
  if p_reason is null or length(p_reason) not between 8 and 500 then raise exception 'pricing_admin_reason_required';end if;
  select * into d from public.developer_pricing_drafts where id=p_id for update;
  if not found or d.revision is distinct from p_revision or d.payload_hash is distinct from p_hash then raise exception 'pricing_admin_draft_conflict';end if;
  if d.status='retired' then return d;end if;
  if d.status<>'approved' then raise exception 'pricing_admin_approval_required';end if;
  if d.kind='pricing' then
    update public.api_pricing_versions set status='retired' where id=d.result_id;
    update public.upstream_price_registry set active=false,verification_status='expired' where id in
      (select value::uuid from public.api_pricing_versions v,jsonb_array_elements_text(v.public_price_configuration->'registryIds') where v.id=d.result_id);
  else update public.developer_credit_offers set active=false where id=d.result_id;end if;
  update public.developer_pricing_drafts set status='retired',updated_by=p_admin,updated_at=clock_timestamp() where id=p_id returning * into d;
  insert into public.developer_pricing_administration_events(draft_id,actor_id,kind,revision,payload_hash,reason) values(p_id,p_admin,'retired',d.revision,d.payload_hash,p_reason);
  return d;
end $$;
revoke all on function public.save_developer_pricing_draft(uuid,uuid,text,bigint,text,text,text),public.approve_developer_pricing_draft(uuid,uuid,bigint,text),public.retire_developer_pricing_draft(uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.save_developer_pricing_draft(uuid,uuid,text,bigint,text,text,text),public.approve_developer_pricing_draft(uuid,uuid,bigint,text),public.retire_developer_pricing_draft(uuid,uuid,bigint,text,text) to service_role;

-- Account exports include an administrator's own reviewed financial material;
-- ordinary clients cannot use these views to enumerate commercial policy.
create view public.developer_pricing_draft_export_rows with(security_invoker=true) as
 select d.id,participant.owner_id,d.kind,d.revision,d.canonical_payload,d.payload_hash,d.status,
  d.created_by,d.updated_by,d.approved_by,d.approved_at,d.result_id,d.created_at,d.updated_at
 from public.developer_pricing_drafts d cross join lateral
  (select distinct x as owner_id from unnest(array[d.created_by,d.updated_by,d.approved_by]) x where x is not null) participant;
create view public.developer_pricing_event_export_rows with(security_invoker=true) as
 select id,actor_id as owner_id,draft_id,kind,revision,payload_hash,reason,created_at
 from public.developer_pricing_administration_events;
revoke all on public.developer_pricing_draft_export_rows,public.developer_pricing_event_export_rows from public,anon,authenticated;
grant select on public.developer_pricing_draft_export_rows,public.developer_pricing_event_export_rows to service_role;
