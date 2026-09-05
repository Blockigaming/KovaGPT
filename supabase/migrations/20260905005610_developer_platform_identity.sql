-- Server-only API-key identities; no public activation, keys or funded balances are seeded.
create table public.developer_account_owners (
  account_id uuid primary key references public.developer_credit_accounts(id),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check(length(name) between 1 and 80),
  created_at timestamptz not null default now()
);
create index developer_accounts_owner_idx on public.developer_account_owners(owner_id,account_id);
create table public.developer_projects (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references public.developer_account_owners(account_id) on delete cascade,
  name text not null check(length(name) between 1 and 80), created_at timestamptz not null default now(),unique(id,account_id)
);
alter table public.developer_billing_keys add column secret_digest text check(secret_digest ~ '^[a-f0-9]{64}$'),
  add column credential_owner uuid references auth.users(id) on delete cascade,
  add column secret_suffix text check(length(secret_suffix)=6),add column name text check(length(name) between 1 and 80);
alter table public.developer_account_owners enable row level security;
alter table public.developer_projects enable row level security;
revoke all on public.developer_account_owners,public.developer_projects from public,anon,authenticated;
grant select,insert,update,delete on public.developer_account_owners,public.developer_projects to service_role;

create function public.manage_developer_workspace(p_owner uuid,p_operation text,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a uuid; o uuid; p uuid; k uuid; l jsonb; scope text; scope_id uuid; currency text; expires timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
  if not kova_private.auth_user_exists(p_owner) or exists(select 1 from public.account_deletion_fences where user_id=p_owner) then
    raise exception 'developer_owner_unavailable' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  if p_input is null or jsonb_typeof(p_input)<>'object' or pg_column_size(p_input)>8192 then raise exception 'developer_input_invalid'; end if;
  if p_operation='create_account' then
    if (select count(*) from public.developer_account_owners where owner_id=p_owner)>=10 then raise exception 'developer_account_limit';end if;
    currency:=p_input->>'currency';
    if currency is null or currency !~ '^[A-Z]{3}$' or length(coalesce(p_input->>'name','')) not between 1 and 80 then raise exception 'developer_input_invalid';end if;
    a:=gen_random_uuid();o:=gen_random_uuid();p:=gen_random_uuid();
    insert into public.developer_credit_accounts(id,organization_id,currency) values(a,o,currency);
    insert into public.developer_account_owners(account_id,owner_id,name) values(a,p_owner,p_input->>'name');
    insert into public.developer_projects(id,account_id,name) values(p,a,'Default project');
    return jsonb_build_object('accountId',a,'projectId',p);
  end if;
  a:=(p_input->>'accountId')::uuid;
  if not exists(select 1 from public.developer_account_owners where account_id=a and owner_id=p_owner) then raise exception 'developer_owner_required' using errcode='42501';end if;
  select organization_id into o from public.developer_credit_accounts where id=a for update;
  if p_operation='revoke_key' then
    update public.developer_billing_keys set enabled=false,revoked_at=coalesce(revoked_at,now()) where id=(p_input->>'keyId')::uuid and account_id=a;
    if not found then raise exception 'developer_key_not_found';end if;
    return jsonb_build_object('revoked',true);
  elsif p_operation='issue_key' then
    p:=(p_input->>'projectId')::uuid;k:=(p_input->>'keyId')::uuid;expires:=(p_input->>'expiresAt')::timestamptz;
    if not exists(select 1 from public.developer_projects where id=p and account_id=a)
      or p_input->>'digest' is null or p_input->>'digest' !~ '^[a-f0-9]{64}$'
      or length(coalesce(p_input->>'suffix',''))<>6 or length(coalesce(p_input->>'name','')) not between 1 and 80
      or expires is null or expires<=now() or expires>now()+interval '90 days'
      or jsonb_typeof(p_input->'scopes') is distinct from 'array' or jsonb_array_length(p_input->'scopes') not between 1 and 4
      or exists(select 1 from jsonb_array_elements_text(p_input->'scopes') s where s not in ('chat','streaming','image_generation','embeddings')) then raise exception 'developer_key_invalid';end if;
    if p_input->>'rotateKeyId' is not null then
      update public.developer_billing_keys set enabled=false,revoked_at=now() where id=(p_input->>'rotateKeyId')::uuid and account_id=a and revoked_at is null;
      if not found then raise exception 'developer_key_not_found';end if;
    end if;
    -- Rotation retires its owned source under the account/billing lock before counting;
    -- any later validation failure rolls the retirement back with the transaction.
    if (select count(*) from public.developer_billing_keys where account_id=a and revoked_at is null)>=100 then
      raise exception 'developer_key_limit';
    end if;
    insert into public.developer_billing_keys(id,account_id,project_id,enabled,expires_at,capabilities,secret_digest,secret_suffix,name,credential_owner)
      values(k,a,p,true,expires,array(select jsonb_array_elements_text(p_input->'scopes')),p_input->>'digest',p_input->>'suffix',p_input->>'name',p_owner);
    scope:='key';scope_id:=k;l:=p_input->'limits';
  elsif p_operation='set_limits' then
    scope:=p_input->>'scope';l:=p_input->'limits';
    if scope='organization' then scope_id:=o;
    elsif scope='project' and exists(select 1 from public.developer_projects where id=(p_input->>'scopeId')::uuid and account_id=a) then scope_id:=(p_input->>'scopeId')::uuid;
    elsif scope='key' and exists(select 1 from public.developer_billing_keys where id=(p_input->>'scopeId')::uuid and account_id=a) then scope_id:=(p_input->>'scopeId')::uuid;
    else raise exception 'developer_scope_invalid';end if;
  else raise exception 'developer_operation_invalid';end if;
  if l is null or jsonb_typeof(l)<>'object' or (l->>'request')::numeric<=0 or (l->>'daily')::numeric<(l->>'request')::numeric
    or (l->>'monthly')::numeric<(l->>'daily')::numeric or (l->>'monthly')::numeric>1000000000
    or (l->>'concurrent')::integer not between 1 and 8 then raise exception 'developer_limits_invalid';end if;
  insert into public.developer_billing_limits(account_id,scope_type,scope_id,request_limit,daily_limit,monthly_limit,concurrent_limit)
    values(a,scope,scope_id,(l->>'request')::numeric,(l->>'daily')::numeric,(l->>'monthly')::numeric,(l->>'concurrent')::integer)
    on conflict on constraint developer_billing_limits_pkey do update set request_limit=excluded.request_limit,daily_limit=excluded.daily_limit,monthly_limit=excluded.monthly_limit,concurrent_limit=excluded.concurrent_limit;
  return jsonb_build_object('keyId',k,'saved',true);
end $$;
revoke all on function public.manage_developer_workspace(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.manage_developer_workspace(uuid,text,jsonb) to service_role;

-- The account deletion barrier remains authoritative immediately before dispatch.
create or replace function public.dispatch_developer_billing(p_request uuid,p_lease uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.developer_api_requests%rowtype; v_owner uuid;
begin
  select own.owner_id into v_owner from public.developer_api_requests req
    join public.developer_account_owners own on own.account_id=req.account_id
    where req.id=p_request and req.lease_token=p_lease;
  if v_owner is null then return false;end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text,20260903204500));
  if not kova_private.auth_user_exists(v_owner)
    or exists(select 1 from public.account_deletion_fences where user_id=v_owner)
    or exists(select 1 from public.banned_users where user_id=v_owner)
    or exists(select 1 from public.user_preferences where user_id=v_owner and coalesce((settings->>'lockdown_mode')::boolean,false)) then return false;end if;
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  select * into r from public.developer_api_requests where id=p_request and lease_token=p_lease
    and settlement_state='reserved' and lease_expires_at>now() for update;
  if not found or not exists(select 1 from public.developer_account_owners own where own.account_id=r.account_id and own.owner_id=v_owner) then return false; end if;
  if not exists(select 1 from public.developer_billing_keys k join public.developer_credit_accounts a on a.id=k.account_id
    where k.id=r.api_key_id and k.enabled and k.revoked_at is null and k.expires_at>now()
      and r.capability=any(k.capabilities) and a.suspended_at is null)
    or not exists(select 1 from public.api_pricing_versions where id=r.pricing_version_id and status='approved' and expires_at>now())
    or exists(select 1 from public.api_emergency_controls c where c.active and
      (c.scope_type='global' or (c.scope_type='provider' and c.scope_id=r.provider)
        or (c.scope_type='model' and c.scope_id=r.upstream_model) or (c.scope_type='capability' and c.scope_id=r.capability)
        or (c.scope_type='organization' and c.scope_id=r.organization_id::text)
        or (c.scope_type='project' and c.scope_id=r.project_id::text) or (c.scope_type='key' and c.scope_id=r.api_key_id::text))) then return false; end if;
  update public.developer_api_requests set settlement_state='dispatched',dispatched_at=now(),lease_expires_at=now()+interval '10 minutes' where id=r.id;
  return true;
end $$;
