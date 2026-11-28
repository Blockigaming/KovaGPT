-- Staged source. Materialize with the repository migration tooling before
-- enabling KOVA_DEVELOPER_WORKSPACE_V2. Never apply directly to production.
-- Reuse existing owner and global billing locks. No account funding occurs.
create table public.developer_credit_sharing_preferences (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  allow_consumer_usage boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.developer_credit_sharing_preferences enable row level security;
revoke all on public.developer_credit_sharing_preferences from public,anon,authenticated;
grant select,insert,update,delete on public.developer_credit_sharing_preferences to service_role;

create or replace function public.manage_developer_workspace_v2(
  p_owner uuid, p_operation text, p_input jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  a uuid;
  p uuid;
  project_name text;
  existing_name text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text,20260903204500));
  if not kova_private.auth_user_exists(p_owner)
    or exists(select 1 from public.account_deletion_fences where user_id=p_owner)
    or exists(select 1 from public.banned_users where user_id=p_owner)
  then raise exception 'developer_owner_required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('developer_billing',0));
  if p_input is null or jsonb_typeof(p_input)<>'object' or pg_column_size(p_input)>8192
    then raise exception 'developer_input_invalid'; end if;

  if p_operation='set_credit_sharing' then
    if jsonb_typeof(p_input->'enabled') is distinct from 'boolean'
      then raise exception 'developer_input_invalid'; end if;
    insert into public.developer_credit_sharing_preferences(owner_id,allow_consumer_usage)
      values(p_owner,(p_input->>'enabled')::boolean)
      on conflict(owner_id) do update set allow_consumer_usage=excluded.allow_consumer_usage,
        updated_at=clock_timestamp();
    return jsonb_build_object('consumerCreditSharing',(p_input->>'enabled')::boolean);
  end if;

  if p_operation='ensure_workspace' then
    -- Adopt an existing account instead of creating a parallel wallet. The
    -- same transaction lock is used by the original create_account operation.
    select own.account_id into a
      from public.developer_account_owners own
      join public.developer_credit_accounts account on account.id=own.account_id
      where own.owner_id=p_owner
      order by (account.currency='USD') desc, own.created_at, own.account_id
      limit 1;
    if a is null then
      return public.manage_developer_workspace(
        p_owner,'create_account',jsonb_build_object('name','Personal workspace','currency','USD'));
    end if;
    select id into p from public.developer_projects where account_id=a
      order by created_at,id limit 1;
    if p is null then
      insert into public.developer_projects(account_id,name)
        values(a,'Default project') returning id into p;
    end if;
    return jsonb_build_object('accountId',a,'projectId',p);
  end if;

  a:=(p_input->>'accountId')::uuid;
  if not exists(select 1 from public.developer_account_owners where account_id=a and owner_id=p_owner)
    then raise exception 'developer_owner_required' using errcode='42501'; end if;
  p:=(p_input->>'projectId')::uuid;
  if p is null then raise exception 'developer_input_invalid'; end if;
  project_name:=btrim(p_input->>'name');
  if project_name is null or length(project_name) not between 1 and 80
    then raise exception 'developer_input_invalid'; end if;
  if p_operation='create_project' then
    -- A caller-generated UUID is an idempotency key, not authorization.
    select name into existing_name from public.developer_projects where id=p and account_id=a;
    if found then
      if existing_name<>project_name then raise exception 'developer_project_conflict'; end if;
      return jsonb_build_object('accountId',a,'projectId',p);
    end if;
    if (select count(*) from public.developer_projects where account_id=a)>=100
      then raise exception 'developer_project_limit'; end if;
    insert into public.developer_projects(id,account_id,name)
      values(p,a,project_name);
  elsif p_operation='rename_project' then
    update public.developer_projects set name=project_name where id=p and account_id=a;
    if not found then raise exception 'developer_owner_required' using errcode='42501'; end if;
  else
    raise exception 'developer_operation_invalid';
  end if;
  return jsonb_build_object('accountId',a,'projectId',p);
end $$;
revoke all on function public.manage_developer_workspace_v2(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.manage_developer_workspace_v2(uuid,text,jsonb) to service_role;

-- Preserve existing key issuance and rotation while adding the explicit moderation scope.
create or replace function public.manage_developer_workspace(p_owner uuid,p_operation text,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a uuid; o uuid; p uuid; k uuid; l jsonb; scope text; scope_id uuid; currency text; expires timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
  if not kova_private.auth_user_exists(p_owner) or exists(select 1 from public.account_deletion_fences where user_id=p_owner)
    or exists(select 1 from public.banned_users where user_id=p_owner) then
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
      or jsonb_typeof(p_input->'scopes') is distinct from 'array' then raise exception 'developer_key_invalid';end if;
    if jsonb_array_length(p_input->'scopes') not between 1 and 14
      or (select count(distinct s) from jsonb_array_elements_text(p_input->'scopes') s)<>jsonb_array_length(p_input->'scopes')
      or exists(select 1 from jsonb_array_elements_text(p_input->'scopes') s where s is null or s not in ('chat','streaming','image_generation','embeddings','files','moderation','decisions','file_analysis','computer_use','cloud_browser','audio_transcription','audio_speech','realtime','audio_translation')) then raise exception 'developer_key_invalid';end if;
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

-- Ephemeral Realtime grants: durable single redemption and turn fences. No media,
-- credentials, prompts or outputs are retained. Provider execution remains metered.
create table public.developer_realtime_sessions_v1 (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.developer_projects(id) on delete cascade,
  api_key_id uuid not null references public.developer_billing_keys(id) on delete cascade,
  grant_digest text not null check(grant_digest ~ '^[a-f0-9]{64}$'),
  key_digest text not null check(key_digest ~ '^[a-f0-9]{64}$'),
  origin text check(origin is null or octet_length(origin) between 9 and 512),
  state text not null default 'issued' check(state in ('issued','connected','closed')),
  connection_id uuid,
  turn_id uuid,
  turns integer not null default 0 check(turns between 0 and 8),
  created_at timestamptz not null default clock_timestamp(),
  redeem_by timestamptz not null,
  expires_at timestamptz not null,
  closed_at timestamptz,
  check(redeem_by>created_at and expires_at>=redeem_by),
  check(state<>'connected' or connection_id is not null)
);
create index developer_realtime_sessions_owner_v1_idx on public.developer_realtime_sessions_v1(owner_id,expires_at);
create index developer_realtime_sessions_expiry_v1_idx on public.developer_realtime_sessions_v1(expires_at);
alter table public.developer_realtime_sessions_v1 enable row level security;
revoke all on public.developer_realtime_sessions_v1 from public,anon,authenticated;
grant select,insert,update,delete on public.developer_realtime_sessions_v1 to service_role;

create function public.manage_developer_realtime_sessions_v1(p_operation text,p_id uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  s public.developer_realtime_sessions_v1%rowtype;
  own uuid; k uuid; proj uuid; acct uuid; secret text; caps text[]; now_at timestamptz;
  connection uuid; turn uuid;
begin
  if p_id is null or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>4096
  then raise exception 'developer_realtime_invalid'; end if;
  if p_operation='issue' then
    own:=(p_input->>'owner_id')::uuid; k:=(p_input->>'api_key_id')::uuid; proj:=(p_input->>'project_id')::uuid;
  else
    select owner_id,api_key_id,project_id into own,k,proj from public.developer_realtime_sessions_v1 where id=p_id;
  end if;
  if own is null or k is null or proj is null then raise exception 'developer_realtime_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(own::text,20260903204500));
  now_at:=clock_timestamp();
  if p_operation<>'issue' then
    select * into s from public.developer_realtime_sessions_v1 where id=p_id and owner_id=own for update;
    if not found then raise exception 'developer_realtime_not_found'; end if;
    -- Closing by the established connection is always permitted, including after revocation.
    if p_operation='disconnect' then
      if s.connection_id is null or s.connection_id is distinct from (p_input->>'connection_id')::uuid
      then raise exception 'developer_realtime_not_found'; end if;
      update public.developer_realtime_sessions_v1 set state='closed',turn_id=null,closed_at=coalesce(closed_at,now_at) where id=p_id;
      return jsonb_build_object('id',p_id,'state','closed');
    end if;
  end if;
  if not kova_private.auth_user_exists(own)
    or exists(select 1 from public.account_deletion_fences where user_id=own)
    or exists(select 1 from public.banned_users where user_id=own)
    or exists(select 1 from public.user_preferences where user_id=own and coalesce((settings->>'lockdown_mode')::boolean,false))
  then raise exception 'developer_scope_required' using errcode='42501'; end if;
  select b.account_id,b.secret_digest,b.capabilities into acct,secret,caps from public.developer_billing_keys b
    join public.developer_account_owners a on a.account_id=b.account_id
    join public.developer_projects p on p.id=b.project_id and p.account_id=b.account_id
    join public.developer_credit_accounts c on c.id=b.account_id
    where b.id=k and p.id=proj and a.owner_id=own and b.enabled and b.revoked_at is null
      and b.expires_at>now_at and 'realtime'=any(b.capabilities) and c.suspended_at is null;
  if acct is null or secret is null then raise exception 'developer_scope_required' using errcode='42501'; end if;
  if p_operation='issue' then
    if coalesce(p_input->>'grant_digest','') !~ '^[a-f0-9]{64}$'
      or (p_input->>'origin' is not null and (jsonb_typeof(p_input->'origin')<>'string' or octet_length(p_input->>'origin')>512))
    then raise exception 'developer_realtime_invalid'; end if;
    delete from public.developer_realtime_sessions_v1 where owner_id=own and expires_at<=now_at;
    if (select count(*) from public.developer_realtime_sessions_v1 where owner_id=own and state<>'closed')>=4
      or (select count(*) from public.developer_realtime_sessions_v1 where owner_id=own)>=64
    then raise exception 'developer_realtime_quota_exceeded'; end if;
    insert into public.developer_realtime_sessions_v1(id,owner_id,project_id,api_key_id,grant_digest,key_digest,origin,created_at,redeem_by,expires_at)
      values(p_id,own,proj,k,p_input->>'grant_digest',secret,p_input->>'origin',now_at,now_at+interval '30 seconds',now_at+interval '5 minutes') returning * into s;
  else
    if s.key_digest<>secret or s.expires_at<=now_at then raise exception 'developer_realtime_not_found'; end if;
    if p_operation='claim' then
      connection:=(p_input->>'connection_id')::uuid;
      if s.state<>'issued' or s.redeem_by<=now_at or connection is null
        or s.grant_digest is distinct from p_input->>'grant_digest' or s.origin is distinct from p_input->>'origin'
      then raise exception 'developer_realtime_not_found'; end if;
      update public.developer_realtime_sessions_v1 set state='connected',connection_id=connection where id=p_id returning * into s;
    elsif p_operation in ('check','begin','finish') then
      connection:=(p_input->>'connection_id')::uuid;
      if s.state<>'connected' or connection is null or s.connection_id is distinct from connection
      then raise exception 'developer_realtime_not_found'; end if;
      if p_operation='begin' then
        turn:=(p_input->>'turn_id')::uuid;
        if turn is null or s.turn_id is not null or s.turns>=8 then raise exception 'developer_realtime_conflict'; end if;
        update public.developer_realtime_sessions_v1 set turn_id=turn,turns=turns+1 where id=p_id returning * into s;
      elsif p_operation='finish' then
        turn:=(p_input->>'turn_id')::uuid;
        if turn is null or s.turn_id is distinct from turn then raise exception 'developer_realtime_conflict'; end if;
        update public.developer_realtime_sessions_v1 set turn_id=null where id=p_id returning * into s;
      end if;
    elsif p_operation in ('get','close') then
      if (p_input->>'owner_id')::uuid is distinct from own or (p_input->>'api_key_id')::uuid is distinct from k
        or (p_input->>'project_id')::uuid is distinct from proj
      then raise exception 'developer_realtime_not_found'; end if;
      if p_operation='close' then
        update public.developer_realtime_sessions_v1 set state='closed',turn_id=null,closed_at=coalesce(closed_at,now_at) where id=p_id returning * into s;
      end if;
    else raise exception 'developer_operation_invalid'; end if;
  end if;
  return jsonb_build_object('id',s.id,'state',s.state,'redeem_by',s.redeem_by,'expires_at',s.expires_at,'turns',s.turns,
    'owner_id',own,'project_id',proj,'api_key_id',k,'account_id',acct,'capabilities',to_jsonb(caps));
end $$;
revoke all on function public.manage_developer_realtime_sessions_v1(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.manage_developer_realtime_sessions_v1(text,uuid,jsonb) to service_role;

create function public.expire_developer_realtime_sessions_v1(p_limit integer default 100)
returns integer language plpgsql security invoker set search_path='' as $$
declare removed integer;
begin
  delete from public.developer_realtime_sessions_v1 where id in(select id from public.developer_realtime_sessions_v1
    where expires_at<=clock_timestamp() order by expires_at,id limit least(greatest(p_limit,1),100) for update skip locked);
  get diagnostics removed=row_count;
  return removed;
end $$;
revoke all on function public.expire_developer_realtime_sessions_v1(integer) from public,anon,authenticated;
grant execute on function public.expire_developer_realtime_sessions_v1(integer) to service_role;
