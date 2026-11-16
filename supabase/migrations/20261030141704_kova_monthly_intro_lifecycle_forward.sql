-- Complete the previously source-only monthly-intro-v1 contract. Installation
-- neither enables billing, creates Stripe objects, registers Prices, nor grants
-- a subscription. Runtime callers remain separately authenticated server code.
-- Customer/checkout uncertainty is durable: neither time nor list absence can
-- release a claim. Only a verified terminal Stripe observation can settle it.
begin;

-- This is an additive forward installation against the inspected legacy
-- billing data plane. Refuse unknown columns, key/role drift, changed tier
-- authorities or an earlier partial installation before creating any object.
do $$
declare item record; relation_oid oid; routine_oid oid; expected_count integer;
  canonical_billing_baseline boolean;
begin
  -- Full canonical history retains the observation protocol and irreversible
  -- deletion fence. Production's inspected legacy profile remains unchanged.
  -- Recognize this complete published shape; partial/unknown shapes still fail.
  canonical_billing_baseline :=
    (select count(*) from pg_attribute where attrelid=to_regclass('public.subscriptions') and attnum>0 and not attisdropped)=16
    and (select count(*) from pg_attribute where attrelid=to_regclass('public.processed_stripe_events') and attnum>0 and not attisdropped)=19
    and (select count(*) from pg_attribute where attrelid=to_regclass('public.account_deletion_fences') and attnum>0 and not attisdropped)=4;
  if canonical_billing_baseline then
    for item in select * from (values
      ('subscriptions','last_stripe_observation_sequence','bigint',false,null::text),
      ('processed_stripe_events','processing_status','text',true,'''completed''::text'),
      ('processed_stripe_events','observation_sequence','bigint',false,null::text),
      ('processed_stripe_events','lease_token','uuid',false,null::text),
      ('processed_stripe_events','lease_expires_at','timestamp with time zone',false,null::text),
      ('processed_stripe_events','completed_at','timestamp with time zone',false,null::text),
      ('account_deletion_fences','started_at','timestamp with time zone',true,'now()')
    ) canonical_columns(table_name,column_name,data_type,not_null,default_expression) loop
      if not exists(select 1 from pg_attribute a where a.attrelid=to_regclass('public.'||item.table_name)
        and a.attname=item.column_name and a.attnum>0 and not a.attisdropped
        and format_type(a.atttypid,a.atttypmod)=item.data_type and a.attnotnull=item.not_null
        and a.attidentity='' and a.attgenerated='' and coalesce(cardinality(a.attacl),0)=0
        and (select pg_get_expr(d.adbin,d.adrelid) from pg_attrdef d where d.adrelid=a.attrelid and d.adnum=a.attnum)
          is not distinct from item.default_expression) then
        raise exception 'monthly_policy_canonical_column_drift';
      end if;
    end loop;
    if exists(select 1 from pg_attribute a where a.attrelid=any(array[
      to_regclass('public.subscriptions'),to_regclass('public.billing_plan_tiers'),
      to_regclass('public.processed_stripe_events'),to_regclass('public.account_deletion_fences')])
      and a.attnum>0 and not a.attisdropped and coalesce(cardinality(a.attacl),0)>0)
      or not exists(select 1 from pg_constraint where conrelid=to_regclass('public.processed_stripe_events')
        and conname='processed_stripe_events_processing_status_check' and contype='c' and convalidated
        and pg_get_constraintdef(oid)='CHECK ((processing_status = ''completed''::text))') then
      raise exception 'monthly_policy_canonical_event_guard_drift';
    end if;
    routine_oid:=to_regprocedure('kova_private.preserve_started_account_deletion()');
    if routine_oid is null or (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='kova_private' and p.proname='preserve_started_account_deletion')<>1
      or not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=routine_oid
        and pg_get_userbyid(p.proowner)='postgres' and p.prosecdef and p.provolatile='v' and l.lanname='plpgsql'
        and p.pronargs=0 and p.pronargdefaults=0 and pg_get_function_result(p.oid)='trigger'
        and cardinality(p.proconfig)=1 and replace(replace(p.proconfig[1],chr(92),''),'"','')='search_path='
        and encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e797425e3b325af46c334a63393c6b7ac07b669f95374ddfcf096134e944f7cf')
      or has_function_privilege('anon',routine_oid,'EXECUTE')
      or has_function_privilege('authenticated',routine_oid,'EXECUTE')
      or exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where p.oid=routine_oid and a.grantee=0 and a.privilege_type='EXECUTE')
      or not exists(select 1 from pg_trigger t where t.tgrelid=to_regclass('public.account_deletion_fences')
        and t.tgname='preserve_started_account_deletion' and t.tgfoid=routine_oid and not t.tgisinternal
        and t.tgtype=27 and t.tgenabled='O' and t.tgnargs=0 and t.tgattr=''::int2vector
        and t.tgqual is null and t.tgconstraint=0)
      or has_table_privilege('service_role','public.account_deletion_fences','DELETE')
      or has_table_privilege('service_role','public.account_deletion_fences','TRUNCATE') then
      raise exception 'monthly_policy_canonical_deletion_guard_drift';
    end if;
  end if;
  for item in select * from (values
    ('subscriptions','id','uuid',true),('subscriptions','user_id','uuid',true),
    ('subscriptions','stripe_subscription_id','text',true),('subscriptions','stripe_customer_id','text',true),
    ('subscriptions','product_id','text',true),('subscriptions','price_id','text',true),
    ('subscriptions','status','text',true),('subscriptions','environment','text',true),
    ('subscriptions','current_period_start','timestamp with time zone',false),
    ('subscriptions','current_period_end','timestamp with time zone',false),
    ('subscriptions','cancel_at_period_end','boolean',false),
    ('subscriptions','created_at','timestamp with time zone',false),('subscriptions','updated_at','timestamp with time zone',false),
    ('subscriptions','last_stripe_event_created_at','timestamp with time zone',false),('subscriptions','last_stripe_event_id','text',false),
    ('billing_plan_tiers','environment','text',true),('billing_plan_tiers','stripe_price_id','text',true),
    ('billing_plan_tiers','lookup_key','text',true),('billing_plan_tiers','tier','text',true),
    ('processed_stripe_events','event_id','text',true),('processed_stripe_events','type','text',true),
    ('processed_stripe_events','environment','text',true),('processed_stripe_events','processed_at','timestamp with time zone',true),
    ('processed_stripe_events','correlation_id','uuid',false),('processed_stripe_events','event_created_at','timestamp with time zone',false),
    ('processed_stripe_events','object_id','text',false),('processed_stripe_events','outcome','text',true),
    ('processed_stripe_events','customer_id','text',false),('processed_stripe_events','subscription_id','text',false),
    ('processed_stripe_events','invoice_id','text',false),('processed_stripe_events','checkout_session_id','text',false),
    ('processed_stripe_events','retryable','boolean',true),('processed_stripe_events','payload_hash','text',false),
    ('account_deletion_fences','user_id','uuid',true),('account_deletion_fences','requested_at','timestamp with time zone',true),
    ('account_deletion_fences','updated_at','timestamp with time zone',true)
  ) required(table_name,column_name,data_type,not_null) loop
    relation_oid:=to_regclass('public.'||item.table_name);
    if relation_oid is null or not exists(select 1 from pg_attribute a where a.attrelid=relation_oid
        and a.attname=item.column_name and a.attnum>0 and not a.attisdropped
        and format_type(a.atttypid,a.atttypmod)=item.data_type and a.attnotnull=item.not_null) then
      raise exception 'monthly_policy_required_column_drift';
    end if;
  end loop;
  for item in select * from (values ('subscriptions',(case when canonical_billing_baseline then 16 else 15 end)),('billing_plan_tiers',4),
    ('processed_stripe_events',(case when canonical_billing_baseline then 19 else 14 end)),
    ('account_deletion_fences',(case when canonical_billing_baseline then 4 else 3 end))) t(table_name,column_count) loop
    relation_oid:=to_regclass('public.'||item.table_name);
    if (select count(*) from pg_attribute where attrelid=relation_oid and attnum>0 and not attisdropped)<>item.column_count
       or not exists(select 1 from pg_class where oid=relation_oid and relkind='r' and relrowsecurity
         and pg_get_userbyid(relowner)='postgres')
       or not has_table_privilege('service_role',relation_oid,'SELECT') then raise exception 'monthly_policy_required_table_drift'; end if;
    if item.table_name<>'billing_plan_tiers' and (not has_table_privilege('service_role',relation_oid,'INSERT')
      or not has_table_privilege('service_role',relation_oid,'UPDATE')
      or (not (canonical_billing_baseline and item.table_name='account_deletion_fences')
        and not has_table_privilege('service_role',relation_oid,'DELETE'))) then
      raise exception 'monthly_policy_required_table_privilege_drift';
    end if;
  end loop;
  for item in select * from (values
    ('subscriptions','PRIMARY KEY (id)'),('subscriptions','UNIQUE (stripe_subscription_id)'),
    ('subscriptions','FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
    ('billing_plan_tiers','PRIMARY KEY (environment, stripe_price_id)'),
    ('processed_stripe_events','PRIMARY KEY (event_id)'),
    ('account_deletion_fences','PRIMARY KEY (user_id)'),
    ('account_deletion_fences','FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE')
  ) keys(table_name,definition) loop
    if not exists(select 1 from pg_constraint where conrelid=to_regclass('public.'||item.table_name)
      and convalidated and pg_get_constraintdef(oid)=item.definition) then raise exception 'monthly_policy_required_key_drift'; end if;
  end loop;
  if not exists(select 1 from pg_attribute where attrelid=to_regclass('auth.users') and attname='id'
      and atttypid='uuid'::regtype and attnotnull and not attisdropped)
     or not exists(select 1 from pg_constraint where conrelid=to_regclass('auth.users') and contype='p'
       and convalidated and pg_get_constraintdef(oid)='PRIMARY KEY (id)') then raise exception 'monthly_policy_auth_identity_drift'; end if;
  for item in select * from (values
    ('billing_user_plan_tier','639638b84c5bee7b2667d08a8d8547363d9ac4eca5ae57b54c3026670454f51c','text'),
    ('effective_user_plan_tier','f53925260a24d426968aa5c7ad4b6b1d98a505f148424a1bdb88f79246d4c47f','text'),
    ('user_subscription_summary','80a0852975e9b08e136a0908e28b318ede9db472349e35c2bd3d8d1d6f4f1cc1','jsonb')
  ) authorities(routine_name,body_sha256,result_type) loop
    routine_oid:=to_regprocedure('public.'||item.routine_name||'(uuid)');
    if routine_oid is null or (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname=item.routine_name)<>1
       or not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=routine_oid
         and pg_get_userbyid(p.proowner)='postgres' and p.prosecdef and p.provolatile='s' and l.lanname='sql'
         and p.pronargdefaults=0 and pg_get_function_result(p.oid)=item.result_type
         and cardinality(p.proconfig)=1 and (case when item.routine_name='user_subscription_summary'
           then replace(replace(p.proconfig[1],chr(92),''),'"','')='search_path='
           else p.proconfig[1]='search_path=public, pg_temp' end)
         and encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=item.body_sha256)
       or not has_function_privilege('service_role',routine_oid,'EXECUTE')
       or has_function_privilege('anon',routine_oid,'EXECUTE')
       or has_function_privilege('authenticated',routine_oid,'EXECUTE') then raise exception 'monthly_policy_tier_authority_drift'; end if;
  end loop;
  if not exists(select 1 from pg_roles where rolname='service_role' and rolbypassrls)
     or not has_schema_privilege('service_role','auth','USAGE') then raise exception 'monthly_policy_service_role_drift'; end if;
end;
$$;

do $$
begin
  if to_regclass('auth.users') is null
     or to_regclass('public.subscriptions') is null
     or to_regclass('public.billing_plan_tiers') is null
     or to_regclass('public.processed_stripe_events') is null
     or to_regclass('public.account_deletion_fences') is null
     or to_regnamespace('kova_private') is null
     or to_regprocedure('public.billing_user_plan_tier(uuid)') is null
     or to_regprocedure('public.effective_user_plan_tier(uuid)') is null
     or to_regprocedure('public.user_subscription_summary(uuid)') is null then
    raise exception 'monthly_policy_baseline_missing';
  end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where (n.nspname='public' and (p.proname like 'kova_policy_%' or p.proname='kova_monthly_subscription_summary'))
         or (n.nspname='kova_private' and p.proname like 'kova_policy_%'))
     or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relname like 'kova_policy_%')
     or exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass and tgname='kova_policy_guard_auth_deletion') then
    raise exception 'monthly_policy_partial_installation_requires_review';
  end if;
end;
$$;

do $$
begin
  if not has_schema_privilege('service_role','kova_private','USAGE') then
    raise exception 'monthly_policy_private_schema_access_missing';
  end if;
end;
$$;

-- MONTHLY_BASELINE_CATALOG_BEGIN
create temporary view kova_monthly_baseline_catalog as
select jsonb_build_object(
  'relations',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,
    'owner',pg_get_userbyid(c.relowner),'kind',c.relkind,'rls',c.relrowsecurity,'forcedRls',c.relforcerowsecurity,'acl',c.relacl::text,
    'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
      'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) order by a.attnum)
      from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
    'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',x.conname,'definition',pg_get_constraintdef(x.oid),
      'validated',x.convalidated) order by x.conname),'[]'::jsonb) from pg_constraint x where x.conrelid=c.oid),
    'triggers',(select coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid),
      'enabled',t.tgenabled,'body',pg_get_functiondef(t.tgfoid)) order by t.tgname),'[]'::jsonb)
      from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal and t.tgname<>'kova_policy_guard_auth_deletion'),
    'policies',(select coalesce(jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,
      'roles',p.polroles::text,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname),'[]'::jsonb)
      from pg_policy p where p.polrelid=c.oid)) order by n.nspname,c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where
      (n.nspname='public' and c.relname in ('subscriptions','billing_plan_tiers','processed_stripe_events','account_deletion_fences'))
      or (n.nspname='auth' and c.relname='users')),
  'authorities',(select jsonb_agg(jsonb_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid),
    'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.proname)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and p.proname in ('billing_user_plan_tier','effective_user_plan_tier','user_subscription_summary')),
  'privateSchemaAcl',(select nspacl::text from pg_namespace where nspname='kova_private')
) as snapshot;
-- MONTHLY_BASELINE_CATALOG_END
create temporary table kova_monthly_install_baseline on commit drop as select snapshot from kova_monthly_baseline_catalog;

-- These records intentionally survive Auth deletion. A retired Customer or
-- deleted account UUID cannot later be adopted by a delayed webhook or signup.
create table public.kova_policy_accounts (
  user_id uuid primary key,
  state text not null default 'active' check(state in ('active','scheduled','finalizing','deleted')),
  scheduled_at timestamptz,
  recover_until timestamptz,
  attempt_id uuid,
  lease_until timestamptz,
  confirmed_at timestamptz,
  deleted_at timestamptz,
  constraint kova_policy_account_window check(
    (state='active' and scheduled_at is null and recover_until is null and attempt_id is null
      and lease_until is null and confirmed_at is null and deleted_at is null)
    or (state='scheduled' and scheduled_at is not null
      and recover_until=scheduled_at+interval '720 hours' and attempt_id is null
      and lease_until is null and confirmed_at is null and deleted_at is null)
    or (state='finalizing' and scheduled_at is not null
      and recover_until=scheduled_at+interval '720 hours' and attempt_id is not null
      and lease_until is not null and deleted_at is null)
    or (state='deleted' and scheduled_at is not null
      and recover_until=scheduled_at+interval '720 hours' and attempt_id is not null
      and confirmed_at is not null and deleted_at is not null)
  )
);
create index kova_policy_due_accounts on public.kova_policy_accounts(recover_until,user_id)
  where state in ('scheduled','finalizing');

create table public.kova_policy_customer_bindings (
  environment text not null check(environment in ('live','sandbox')),
  user_id uuid not null references public.kova_policy_accounts(user_id),
  stripe_customer_id text check(stripe_customer_id ~ '^cus_[A-Za-z0-9_]+$'),
  request_id uuid not null default gen_random_uuid(),
  requested_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  primary key(environment,user_id),
  unique(environment,stripe_customer_id),
  unique(request_id),
  check(retired_at is null or stripe_customer_id is not null)
);
create table public.kova_policy_checkout_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kova_policy_accounts(user_id),
  environment text not null check(environment in ('live','sandbox')),
  customer_id text not null check(customer_id ~ '^cus_[A-Za-z0-9_]+$'),
  price_id text not null check(price_id ~ '^price_[A-Za-z0-9_]+$'),
  coupon_id text check(coupon_id ~ '^[A-Za-z0-9_-]{1,200}$'),
  intro_eligible boolean not null,
  return_url text not null,
  requested_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  state text not null default 'pending' check(state in ('pending','open','completed','expired')),
  session_id text check(session_id ~ '^cs_[A-Za-z0-9_]+$'),
  settled_at timestamptz,
  unique(environment,session_id),
  check(intro_eligible=(coupon_id is not null)),
  check((state in ('completed','expired'))=(settled_at is not null)),
  check(state='pending' or session_id is not null)
);
create unique index kova_policy_one_pending_checkout on public.kova_policy_checkout_claims(user_id)
  where state in ('pending','open');
create index kova_policy_checkout_owner_history on public.kova_policy_checkout_claims(user_id,requested_at desc);
create table public.kova_policy_intro_redemptions (
  user_id uuid primary key references public.kova_policy_accounts(user_id),
  claim_id uuid not null unique references public.kova_policy_checkout_claims(id),
  redeemed_at timestamptz not null default clock_timestamp()
);
create table public.kova_policy_event_receipts (
  environment text not null check(environment in ('live','sandbox')),
  event_id text not null check(event_id ~ '^evt_[A-Za-z0-9_]+$'),
  payload_sha256 text not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
  outcome text not null check(outcome in ('applied','stale_ignored','orphaned','observed','same_state')),
  created_at timestamptz not null default clock_timestamp(),
  primary key(environment,event_id)
);
create table public.kova_policy_subscription_state (
  environment text not null check(environment in ('live','sandbox')),
  subscription_id text not null check(subscription_id ~ '^sub_[A-Za-z0-9_]+$'),
  user_id uuid not null references public.kova_policy_accounts(user_id),
  customer_id text not null check(customer_id ~ '^cus_[A-Za-z0-9_]+$'),
  last_event_created_at timestamptz not null,
  last_event_id text not null,
  last_projection jsonb not null,
  primary key(environment,subscription_id)
);

alter table public.kova_policy_accounts enable row level security;
alter table public.kova_policy_customer_bindings enable row level security;
alter table public.kova_policy_checkout_claims enable row level security;
alter table public.kova_policy_intro_redemptions enable row level security;
alter table public.kova_policy_event_receipts enable row level security;
alter table public.kova_policy_subscription_state enable row level security;
revoke all on public.kova_policy_accounts,public.kova_policy_customer_bindings,
  public.kova_policy_checkout_claims,public.kova_policy_intro_redemptions,
  public.kova_policy_event_receipts,public.kova_policy_subscription_state from public,anon,authenticated;
grant select,insert,update,delete on public.kova_policy_accounts,public.kova_policy_customer_bindings,
  public.kova_policy_checkout_claims,public.kova_policy_intro_redemptions,
  public.kova_policy_event_receipts,public.kova_policy_subscription_state to service_role;

-- service_role intentionally has no broad auth.users SELECT/UPDATE permission.
-- This helper reveals only existence of the caller UUID and takes the FK-safe
-- row lock. Its fixed body and server-only EXECUTE are part of readiness.
create function kova_private.kova_policy_auth_lock(p_user uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_user is null then return false; end if;
  perform 1 from auth.users where id=p_user for key share;
  return found;
end;
$$;

create function kova_private.kova_policy_lock_account(p_user uuid,p_allow_terminal boolean default false)
returns public.kova_policy_accounts language plpgsql security invoker set search_path='' as $$
declare a public.kova_policy_accounts%rowtype;
begin
  if p_user is null then raise exception 'account_policy_principal_invalid'; end if;
  -- Take the Auth row before the account advisory lock. Auth DELETE owns that
  -- row before its BEFORE trigger, and fence/subscription inserts need its FK.
  if not kova_private.kova_policy_auth_lock(p_user) then raise exception 'account_policy_principal_unavailable'; end if;
  -- Same account lock as the canonical Customer/deletion guards. Every lifecycle
  -- transition takes this lock before rows, so network claims and deletion fence.
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,20260903204500));
  select * into a from public.kova_policy_accounts where user_id=p_user for update;
  if not found then
    if exists(select 1 from public.account_deletion_fences where user_id=p_user) then
      raise exception 'account_policy_principal_unavailable';
    end if;
    insert into public.kova_policy_accounts(user_id) values(p_user) returning * into a;
  end if;
  if a.state='deleted' then
    raise exception 'account_policy_principal_unavailable';
  end if;
  if not p_allow_terminal and (a.state<>'active'
     or exists(select 1 from public.account_deletion_fences where user_id=p_user)) then
    raise exception 'account_deletion_pending';
  end if;
  return a;
end;
$$;
create function kova_private.kova_policy_checkout_json(p_claim public.kova_policy_checkout_claims)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('claimId',p_claim.id,'idempotencyKey','kova-checkout:'||p_claim.id,
   'environment',p_claim.environment,'customerId',p_claim.customer_id,'priceId',p_claim.price_id,
   'couponId',p_claim.coupon_id,'returnUrl',p_claim.return_url,'requestedAt',p_claim.requested_at,
   'expiresAt',p_claim.expires_at,'state',p_claim.state,'introEligible',p_claim.intro_eligible,
   'sessionId',p_claim.session_id);
$$;

create function public.kova_policy_claim_customer(p_user uuid,p_environment text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.kova_policy_customer_bindings%rowtype;
begin
  if p_environment is null or p_environment not in ('live','sandbox') then raise exception 'billing_policy_environment_invalid'; end if;
  perform kova_private.kova_policy_lock_account(p_user);
  insert into public.kova_policy_customer_bindings(user_id,environment)
    values(p_user,p_environment) on conflict(environment,user_id) do nothing;
  select * into strict c from public.kova_policy_customer_bindings
    where user_id=p_user and environment=p_environment for update;
  if c.retired_at is not null then raise exception 'billing_policy_customer_retired'; end if;
  return jsonb_build_object('state',case when c.stripe_customer_id is null then 'pending' else 'mapped' end,
    'customerId',c.stripe_customer_id,'requestId',c.request_id,'requestedAt',c.requested_at);
end;
$$;
create function public.kova_policy_complete_customer(p_user uuid,p_environment text,p_request uuid,p_customer text)
returns text language plpgsql security invoker set search_path='' as $$
declare c public.kova_policy_customer_bindings%rowtype; a public.kova_policy_accounts%rowtype;
begin
  if p_environment is null or p_environment not in ('live','sandbox') or p_request is null
     or p_customer is null or p_customer !~ '^cus_[A-Za-z0-9_]+$' then raise exception 'billing_policy_customer_identity_invalid'; end if;
  a:=kova_private.kova_policy_lock_account(p_user,true);
  -- Persist a Customer returned by an already admitted request even if deletion
  -- was scheduled during the network call. This creates no new claim or effect.
  if a.state='finalizing' or exists(select 1 from public.account_deletion_fences where user_id=p_user) then
    raise exception 'account_deletion_pending';
  end if;
  select * into c from public.kova_policy_customer_bindings
    where user_id=p_user and environment=p_environment for update;
  if not found or c.request_id is distinct from p_request or c.retired_at is not null
     or (c.stripe_customer_id is not null and c.stripe_customer_id<>p_customer) then
    raise exception 'billing_policy_customer_identity_mismatch';
  end if;
  if exists(select 1 from public.kova_policy_customer_bindings where environment=p_environment
      and stripe_customer_id=p_customer and user_id<>p_user) then raise exception 'billing_policy_customer_identity_mismatch'; end if;
  update public.kova_policy_customer_bindings set stripe_customer_id=p_customer
    where user_id=p_user and environment=p_environment;
  return p_customer;
end;
$$;
create function public.kova_policy_claim_checkout(p_user uuid,p_environment text,p_price text,p_coupon text,p_return_url text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.kova_policy_checkout_claims%rowtype; customer text; eligible boolean;
begin
  if p_environment is null or p_environment not in ('live','sandbox')
     or p_price is null or p_price !~ '^price_[A-Za-z0-9_]+$'
     or p_coupon is null or p_coupon !~ '^[A-Za-z0-9_-]{1,200}$'
     or p_return_url is null or p_return_url not in (
       'https://kovagpt.com/checkout/return?session_id={CHECKOUT_SESSION_ID}',
       'https://kovagpt-prod-web.purpleglacier-b10c3746.eastus.azurecontainerapps.io/checkout/return?session_id={CHECKOUT_SESSION_ID}') then
    raise exception 'billing_policy_checkout_input_invalid';
  end if;
  perform kova_private.kova_policy_lock_account(p_user);
  if not exists(select 1 from public.billing_plan_tiers where environment=p_environment and stripe_price_id=p_price)
     or (p_environment='live' and p_price not in ('price_1UAzhHAEZlsb6DBYWw2oUCeO','price_1UEw6FAEZlsb6DBYuksCKOBR')) then
    raise exception 'billing_policy_price_unqualified';
  end if;
  select stripe_customer_id into customer from public.kova_policy_customer_bindings
    where user_id=p_user and environment=p_environment and retired_at is null for update;
  if customer is null then raise exception 'billing_policy_customer_mapping_required'; end if;
  select * into c from public.kova_policy_checkout_claims
    where user_id=p_user and state in ('pending','open') for update;
  if found then
    if c.environment<>p_environment or c.customer_id<>customer or c.price_id<>p_price
       or c.return_url<>p_return_url or (c.coupon_id is not null and c.coupon_id<>p_coupon) then
      raise exception 'billing_policy_checkout_reconciliation_pending';
    end if;
    return kova_private.kova_policy_checkout_json(c);
  end if;
  if exists(select 1 from public.subscriptions where user_id=p_user and environment=p_environment
      and status<>'incomplete_expired' and (current_period_end is null or current_period_end>clock_timestamp())) then
    raise exception 'billing_policy_active_subscription_exists';
  end if;
  eligible:=not exists(select 1 from public.kova_policy_intro_redemptions where user_id=p_user);
  insert into public.kova_policy_checkout_claims(user_id,environment,customer_id,price_id,coupon_id,
    intro_eligible,return_url,expires_at)
    values(p_user,p_environment,customer,p_price,case when eligible then p_coupon else null end,
      eligible,p_return_url,date_trunc('second',clock_timestamp())+interval '45 minutes') returning * into c;
  return kova_private.kova_policy_checkout_json(c);
end;
$$;
create function public.kova_policy_attach_checkout(p_user uuid,p_environment text,p_claim uuid,p_session text,p_expires_at timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.kova_policy_checkout_claims%rowtype;
begin
  if p_environment is null or p_environment not in ('live','sandbox') or p_session is null
     or p_session !~ '^cs_[A-Za-z0-9_]+$' or p_expires_at is null then raise exception 'billing_policy_checkout_binding_invalid'; end if;
  perform kova_private.kova_policy_lock_account(p_user,true);
  select * into c from public.kova_policy_checkout_claims where id=p_claim and user_id=p_user and environment=p_environment for update;
  if not found or c.expires_at is distinct from p_expires_at
     or (c.session_id is not null and c.session_id<>p_session) then raise exception 'billing_policy_checkout_identity_mismatch'; end if;
  if exists(select 1 from public.kova_policy_checkout_claims where environment=p_environment
      and session_id=p_session and id<>p_claim) then raise exception 'billing_policy_checkout_identity_mismatch'; end if;
  update public.kova_policy_checkout_claims set session_id=p_session,
    state=case when state='pending' then 'open' else state end where id=p_claim returning * into c;
  return kova_private.kova_policy_checkout_json(c);
end;
$$;
create function public.kova_policy_settle_checkout(p_user uuid,p_environment text,p_claim uuid,p_session text,p_outcome text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.kova_policy_checkout_claims%rowtype;
begin
  if p_outcome is null or p_outcome not in ('completed','expired') then raise exception 'billing_policy_checkout_outcome_invalid'; end if;
  perform kova_private.kova_policy_lock_account(p_user,true);
  select * into c from public.kova_policy_checkout_claims where id=p_claim and user_id=p_user and environment=p_environment for update;
  if not found or c.session_id is null or c.session_id is distinct from p_session then raise exception 'billing_policy_checkout_identity_mismatch'; end if;
  if c.state in ('completed','expired') and c.state<>p_outcome then raise exception 'billing_policy_checkout_terminal_conflict'; end if;
  update public.kova_policy_checkout_claims set state=p_outcome,settled_at=coalesce(settled_at,clock_timestamp())
    where id=p_claim returning * into c;
  if p_outcome='completed' and c.intro_eligible then
    insert into public.kova_policy_intro_redemptions(user_id,claim_id) values(p_user,p_claim) on conflict(user_id) do nothing;
    if not exists(select 1 from public.kova_policy_intro_redemptions where user_id=p_user and claim_id=p_claim) then
      raise exception 'billing_policy_intro_redemption_conflict';
    end if;
  end if;
  return kova_private.kova_policy_checkout_json(c);
end;
$$;
create function public.kova_policy_checkout_status(p_user uuid,p_environment text,p_claim uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.kova_policy_checkout_claims%rowtype;
begin
  perform kova_private.kova_policy_lock_account(p_user,true);
  select * into c from public.kova_policy_checkout_claims where id=p_claim and user_id=p_user and environment=p_environment;
  if not found then raise exception 'billing_policy_checkout_identity_mismatch'; end if;
  return kova_private.kova_policy_checkout_json(c);
end;
$$;
create function public.kova_policy_pending_checkout(p_user uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.kova_policy_checkout_claims%rowtype;
begin
  perform kova_private.kova_policy_lock_account(p_user,true);
  select * into c from public.kova_policy_checkout_claims where user_id=p_user and state in ('pending','open');
  if not found then return null; end if;
  return kova_private.kova_policy_checkout_json(c);
end;
$$;
create function public.kova_policy_customer_for_portal(p_user uuid,p_environment text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c text;
begin
  if p_environment is null or p_environment not in ('live','sandbox') then raise exception 'billing_policy_environment_invalid'; end if;
  perform kova_private.kova_policy_lock_account(p_user);
  select stripe_customer_id into c from public.kova_policy_customer_bindings
    where user_id=p_user and environment=p_environment and retired_at is null;
  return jsonb_build_object('customerId',c);
end;
$$;

create function public.kova_policy_account_status(p_user uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.kova_policy_accounts%rowtype;
begin
  a:=kova_private.kova_policy_lock_account(p_user,true);
  return jsonb_build_object('state',a.state,'scheduledAt',a.scheduled_at,'recoverUntil',a.recover_until);
end;
$$;
create function public.kova_policy_schedule_deletion(p_user uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.kova_policy_accounts%rowtype; stamp timestamptz;
begin
  a:=kova_private.kova_policy_lock_account(p_user,true);
  if a.state='finalizing' then raise exception 'account_policy_finalization_started'; end if;
  if exists(select 1 from public.account_deletion_fences where user_id=p_user) then raise exception 'account_deletion_pending'; end if;
  if a.state='active' then
    stamp:=clock_timestamp();
    update public.kova_policy_accounts set state='scheduled',scheduled_at=stamp,recover_until=stamp+interval '720 hours'
      where user_id=p_user;
  end if;
  return public.kova_policy_account_status(p_user);
end;
$$;
create function public.kova_policy_recover_deletion(p_user uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.kova_policy_accounts%rowtype;
begin
  a:=kova_private.kova_policy_lock_account(p_user,true);
  if a.state='finalizing' or (a.state='scheduled' and a.recover_until<=clock_timestamp())
     or exists(select 1 from public.account_deletion_fences where user_id=p_user) then raise exception 'account_policy_recovery_closed'; end if;
  if a.state='scheduled' then update public.kova_policy_accounts set state='active',scheduled_at=null,recover_until=null where user_id=p_user; end if;
  return public.kova_policy_account_status(p_user);
end;
$$;
create function public.kova_policy_due_deletions(p_limit integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  if p_limit is null or p_limit<1 or p_limit>2 then raise exception 'account_policy_limit_invalid'; end if;
  return coalesce((select jsonb_agg(user_id) from (
    select user_id from public.kova_policy_accounts where
      (state='scheduled' and recover_until<=clock_timestamp()) or
      (state='finalizing' and lease_until<=clock_timestamp())
    order by recover_until,user_id limit p_limit) q),'[]'::jsonb);
end;
$$;
create function public.kova_policy_begin_finalization(p_user uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.kova_policy_accounts%rowtype; customers jsonb;
begin
  a:=kova_private.kova_policy_lock_account(p_user,true);
  if a.state not in ('scheduled','finalizing') or a.recover_until>clock_timestamp() then raise exception 'account_policy_recovery_open'; end if;
  if a.state='finalizing' and a.lease_until>clock_timestamp() then raise exception 'account_policy_finalization_busy'; end if;
  if exists(select 1 from public.kova_policy_customer_bindings where user_id=p_user and stripe_customer_id is null)
     or exists(select 1 from public.kova_policy_checkout_claims where user_id=p_user and state in ('pending','open')) then
    raise exception 'billing_policy_checkout_reconciliation_pending';
  end if;
  -- The durable fence is inserted only after the full recovery window and
  -- unresolved external effects are reconciled. Existing cleanup hooks run here.
  insert into public.account_deletion_fences(user_id) values(p_user) on conflict(user_id) do nothing;
  update public.kova_policy_accounts set state='finalizing',attempt_id=gen_random_uuid(),
    lease_until=clock_timestamp()+interval '120 seconds',confirmed_at=null where user_id=p_user returning * into a;
  select coalesce(jsonb_agg(jsonb_build_object('environment',environment,'customerId',stripe_customer_id,
    'retiredAt',retired_at) order by environment),'[]'::jsonb) into customers
    from public.kova_policy_customer_bindings where user_id=p_user and stripe_customer_id is not null;
  return jsonb_build_object('state','finalizing','attemptId',a.attempt_id,'leaseUntil',a.lease_until,'customers',customers);
end;
$$;
create function public.kova_policy_renew_finalization(p_user uuid,p_attempt uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.kova_policy_accounts%rowtype;
begin
  a:=kova_private.kova_policy_lock_account(p_user,true);
  if a.state<>'finalizing' or p_attempt is null or a.attempt_id is distinct from p_attempt
     or a.lease_until<=clock_timestamp() or not exists(select 1 from public.account_deletion_fences where user_id=p_user) then
    raise exception 'account_policy_lease_stale';
  end if;
  update public.kova_policy_accounts set lease_until=clock_timestamp()+interval '120 seconds'
    where user_id=p_user returning * into a;
  return jsonb_build_object('attemptId',a.attempt_id,'leaseUntil',a.lease_until);
end;
$$;
create function public.kova_policy_ack_customer_retired(p_user uuid,p_environment text,p_customer text,p_attempt uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  perform public.kova_policy_renew_finalization(p_user,p_attempt);
  if p_environment is null or p_environment not in ('live','sandbox') or p_customer is null then raise exception 'account_policy_customer_binding_invalid'; end if;
  update public.kova_policy_customer_bindings set retired_at=coalesce(retired_at,clock_timestamp())
    where user_id=p_user and environment=p_environment and stripe_customer_id=p_customer;
  if not found then raise exception 'account_policy_customer_binding_invalid'; end if;
  return true;
end;
$$;
create function public.kova_policy_confirm_finalization(p_user uuid,p_attempt uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  perform public.kova_policy_renew_finalization(p_user,p_attempt);
  if exists(select 1 from public.kova_policy_customer_bindings where user_id=p_user
      and (stripe_customer_id is null or retired_at is null))
     or exists(select 1 from public.kova_policy_checkout_claims where user_id=p_user and state in ('pending','open')) then
    raise exception 'account_policy_customer_retirement_pending';
  end if;
  update public.kova_policy_accounts set confirmed_at=clock_timestamp() where user_id=p_user;
  return true;
end;
$$;

create function kova_private.kova_policy_guard_auth_deletion()
returns trigger language plpgsql security definer set search_path='' as $$
declare a public.kova_policy_accounts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(old.id::text,20260903204500));
  select * into a from public.kova_policy_accounts where user_id=old.id for update;
  if not found then return old; end if;
  if a.state<>'finalizing' or a.confirmed_at is null or a.lease_until<=clock_timestamp()
     or not exists(select 1 from public.account_deletion_fences where user_id=old.id)
     or exists(select 1 from public.kova_policy_customer_bindings where user_id=old.id
       and (stripe_customer_id is null or retired_at is null))
     or exists(select 1 from public.kova_policy_checkout_claims where user_id=old.id and state in ('pending','open')) then
    raise exception 'account_policy_finalization_unconfirmed';
  end if;
  update public.kova_policy_accounts set state='deleted',deleted_at=clock_timestamp() where user_id=old.id;
  return old;
end;
$$;
create trigger kova_policy_guard_auth_deletion before delete on auth.users
  for each row execute function kova_private.kova_policy_guard_auth_deletion();

create function public.kova_policy_apply_legacy_event(p_environment text,p_event jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_event_id text; customer text; sub_id text; stamp timestamptz; event_type text;
  digest text; projection jsonb; kind text; owner_id uuid; account_state text;
  binding public.kova_policy_customer_bindings%rowtype;
  receipt public.kova_policy_event_receipts%rowtype;
  previous public.kova_policy_subscription_state%rowtype;
  persisted public.subscriptions%rowtype;
  outcome text:='observed'; incoming_status text; incoming_price text; product text;
  period_start timestamptz; period_end timestamptz; cancel_at_end boolean; old_state boolean; owner_exists boolean;
begin
  if p_environment is null or p_environment not in ('live','sandbox') or jsonb_typeof(p_event) is distinct from 'object'
     or octet_length(p_event::text)>16384 or exists(select 1 from jsonb_object_keys(p_event) k
       where k not in ('eventId','type','createdAt','correlationId','objectId','customerId','subscriptionId','invoiceId','checkoutSessionId','outcome','projection')) then
    raise exception 'billing_policy_event_invalid';
  end if;
  v_event_id:=p_event->>'eventId'; customer:=p_event->>'customerId'; sub_id:=p_event->>'subscriptionId'; event_type:=p_event->>'type';
  if v_event_id is null or v_event_id !~ '^evt_[A-Za-z0-9_]+$' or customer is null or customer !~ '^cus_[A-Za-z0-9_]+$'
     or (sub_id is not null and sub_id !~ '^sub_[A-Za-z0-9_]+$') or event_type is null or event_type not in (
      'customer.subscription.created','customer.subscription.updated','customer.subscription.paused','customer.subscription.resumed','customer.subscription.deleted',
      'invoice.paid','invoice.payment_failed','invoice.payment_action_required','invoice.voided','invoice.marked_uncollectible',
      'checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.expired') then raise exception 'billing_policy_event_invalid'; end if;
  begin stamp:=(p_event->>'createdAt')::timestamptz;
  exception when others then raise exception 'billing_policy_event_timestamp_invalid'; end;
  if stamp is null or not isfinite(stamp) then raise exception 'billing_policy_event_timestamp_invalid'; end if;
  -- Delivery correlation is diagnostic, not part of Stripe event identity.
  -- A retry receives a new HTTP correlation ID but must deduplicate normally.
  digest:=encode(sha256(convert_to((p_event-'correlationId')::text,'UTF8')),'hex');
  -- Serialize policy event receipts before owner locks. Billing/account functions
  -- never acquire this event lock, so cross-Customer delivery cannot deadlock.
  perform pg_advisory_xact_lock(20261030,141704);
  select r.* into receipt from public.kova_policy_event_receipts r
    where r.environment=p_environment and r.event_id=v_event_id;
  if found then
    if receipt.payload_sha256<>digest then raise exception 'billing_policy_event_identity_conflict'; end if;
    return jsonb_build_object('duplicate',true,'outcome','already_processed');
  end if;
  if exists(select 1 from public.processed_stripe_events e where e.event_id=v_event_id) then
    raise exception 'billing_policy_event_requires_reconciliation';
  end if;
  select * into binding from public.kova_policy_customer_bindings where environment=p_environment and stripe_customer_id=customer;
  if not found then outcome:='orphaned';
  else
    owner_id:=binding.user_id;
    owner_exists:=kova_private.kova_policy_auth_lock(owner_id);
    perform pg_advisory_xact_lock(hashtextextended(owner_id::text,20260903204500));
    select state into account_state from public.kova_policy_accounts where user_id=owner_id for update;
    select * into binding from public.kova_policy_customer_bindings where environment=p_environment and stripe_customer_id=customer for update;
    if binding.retired_at is not null or account_state in ('finalizing','deleted')
       or not owner_exists
       or exists(select 1 from public.account_deletion_fences where user_id=owner_id) then outcome:='orphaned'; end if;
  end if;
  projection:=p_event->'projection';
  if outcome<>'orphaned' and projection is not null and projection<>'null'::jsonb then
    if jsonb_typeof(projection)<>'object' or sub_id is null
       or projection->>'stripeSubscriptionId' is distinct from sub_id
       or projection->>'customerId' is distinct from customer then raise exception 'billing_policy_projection_identity_mismatch'; end if;
    kind:=projection->>'kind';
    if kind is null or kind not in ('subscription','subscription_deleted','invoice_status') then raise exception 'billing_policy_projection_invalid'; end if;
    if (kind='subscription' and event_type not in ('customer.subscription.created','customer.subscription.updated','customer.subscription.paused','customer.subscription.resumed'))
       or (kind='subscription_deleted' and event_type<>'customer.subscription.deleted')
       or (kind='invoice_status' and event_type not in ('invoice.paid','invoice.payment_failed','invoice.payment_action_required','invoice.voided','invoice.marked_uncollectible')) then
      raise exception 'billing_policy_projection_type_mismatch';
    end if;
    select * into previous from public.kova_policy_subscription_state where environment=p_environment and subscription_id=sub_id for update;
    old_state:=found;
    select * into persisted from public.subscriptions where environment=p_environment and stripe_subscription_id=sub_id for update;
    if found and (persisted.user_id<>owner_id or persisted.stripe_customer_id<>customer) then raise exception 'billing_policy_projection_identity_mismatch'; end if;
    if old_state and (previous.user_id<>owner_id or previous.customer_id<>customer) then raise exception 'billing_policy_projection_identity_mismatch'; end if;
    if persisted.id is not null and persisted.last_stripe_event_created_at is null then
      raise exception 'billing_policy_subscription_baseline_unqualified';
    end if;
    if persisted.id is not null and stamp<persisted.last_stripe_event_created_at then outcome:='stale_ignored';
    elsif persisted.id is not null and stamp=persisted.last_stripe_event_created_at and (not old_state or previous.last_event_created_at is distinct from persisted.last_stripe_event_created_at) then
      raise exception 'billing_policy_event_order_conflict';
    elsif old_state and stamp<previous.last_event_created_at then outcome:='stale_ignored';
    elsif old_state and stamp=previous.last_event_created_at and previous.last_projection<>projection then
      raise exception 'billing_policy_event_order_conflict';
    elsif old_state and stamp=previous.last_event_created_at then outcome:='same_state';
    elsif old_state and previous.last_projection->>'kind'='subscription_deleted' and kind<>'subscription_deleted' then outcome:='stale_ignored';
    elsif persisted.id is not null and persisted.status in ('canceled','incomplete_expired') and kind<>'subscription_deleted' then outcome:='stale_ignored';
    elsif kind='invoice_status' and persisted.id is null then outcome:='observed';
    else
      if kind='subscription' then
        incoming_price:=projection->>'priceId'; product:=projection->>'productId'; incoming_status:=projection->>'status';
        if exists(select 1 from jsonb_object_keys(projection) k where k not in ('kind','stripeSubscriptionId','customerId','productId','priceId','status','periodStart','periodEnd','cancelAtPeriodEnd'))
           or p_environment<>'live' or incoming_price is null or incoming_price not in
             ('price_1UAzhHAEZlsb6DBYWw2oUCeO','price_1UEw6FAEZlsb6DBYuksCKOBR','price_1UAzhRAEZlsb6DBYlafU4mhc')
           or not exists(select 1 from public.billing_plan_tiers where environment=p_environment and stripe_price_id=incoming_price)
           or product is null or product<>(case when incoming_price='price_1UAzhHAEZlsb6DBYWw2oUCeO' then 'prod_VB1Crlvg4utbCe' else 'prod_VB1Cbp01TZ8hOI' end)
           or incoming_status is null or incoming_status not in ('active','canceled','incomplete','incomplete_expired','past_due','paused','trialing','unpaid')
           or jsonb_typeof(projection->'cancelAtPeriodEnd') is distinct from 'boolean' then raise exception 'billing_policy_subscription_invalid'; end if;
        begin period_start:=(projection->>'periodStart')::timestamptz; period_end:=(projection->>'periodEnd')::timestamptz;
        exception when others then raise exception 'billing_policy_subscription_period_invalid'; end;
        if period_start is null or period_end is null or not isfinite(period_start) or not isfinite(period_end) or period_end<=period_start then raise exception 'billing_policy_subscription_period_invalid'; end if;
        cancel_at_end:=(projection->>'cancelAtPeriodEnd')::boolean;
        if persisted.id is null then
          insert into public.subscriptions(user_id,stripe_subscription_id,stripe_customer_id,product_id,price_id,status,
            current_period_start,current_period_end,cancel_at_period_end,environment,last_stripe_event_created_at,last_stripe_event_id)
            values(owner_id,sub_id,customer,product,incoming_price,incoming_status,period_start,period_end,cancel_at_end,p_environment,stamp,v_event_id);
        else
          update public.subscriptions set product_id=product,price_id=incoming_price,status=incoming_status,current_period_start=period_start,
            current_period_end=period_end,cancel_at_period_end=cancel_at_end,last_stripe_event_created_at=stamp,last_stripe_event_id=v_event_id,updated_at=clock_timestamp()
            where id=persisted.id;
        end if;
        outcome:='applied';
      elsif kind='subscription_deleted' then
        if exists(select 1 from jsonb_object_keys(projection) k where k not in ('kind','stripeSubscriptionId','customerId','status'))
           or projection->>'status' is distinct from 'canceled' then raise exception 'billing_policy_subscription_invalid'; end if;
        if persisted.id is not null then
          update public.subscriptions set status='canceled',last_stripe_event_created_at=stamp,last_stripe_event_id=v_event_id,updated_at=clock_timestamp() where id=persisted.id;
        end if;
        outcome:='applied';
      else
        incoming_status:=projection->>'status';
        if exists(select 1 from jsonb_object_keys(projection) k where k not in ('kind','stripeSubscriptionId','customerId','status'))
           or incoming_status is distinct from (case when event_type='invoice.paid' then 'active' when event_type='invoice.payment_action_required' then 'incomplete' else 'past_due' end) then
          raise exception 'billing_policy_invoice_status_invalid';
        end if;
        if persisted.status in ('canceled','incomplete_expired','paused') then outcome:='stale_ignored';
        elsif incoming_status in ('active','past_due') and persisted.status not in ('active','trialing','past_due') then
          -- An invoice can belong to an old billing period. Its normalized
          -- payload contains no current subscription snapshot or period proof.
          -- Only a full subscription observation may establish paid access.
          outcome:='observed';
        else
          update public.subscriptions set status=incoming_status,last_stripe_event_created_at=stamp,last_stripe_event_id=v_event_id,updated_at=clock_timestamp() where id=persisted.id;
          outcome:='applied';
        end if;
      end if;
      if outcome='applied' then
        insert into public.kova_policy_subscription_state(environment,subscription_id,user_id,customer_id,last_event_created_at,last_event_id,last_projection)
          values(p_environment,sub_id,owner_id,customer,stamp,v_event_id,projection)
          on conflict(environment,subscription_id) do update set last_event_created_at=excluded.last_event_created_at,last_event_id=excluded.last_event_id,last_projection=excluded.last_projection;
      end if;
    end if;
  end if;
  insert into public.kova_policy_event_receipts(environment,event_id,payload_sha256,outcome) values(p_environment,v_event_id,digest,outcome);
  insert into public.processed_stripe_events(event_id,type,environment,event_created_at,object_id,outcome,
    customer_id,subscription_id,invoice_id,checkout_session_id,payload_hash,correlation_id)
    values(v_event_id,event_type,p_environment,stamp,p_event->>'objectId',outcome,customer,sub_id,
      p_event->>'invoiceId',p_event->>'checkoutSessionId',digest,(p_event->>'correlationId')::uuid);
  return jsonb_build_object('duplicate',false,'outcome',outcome);
end;
$$;

create function public.kova_monthly_subscription_summary(p_user uuid,p_plus_price text,p_pro_price text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if p_user is null or p_plus_price is distinct from 'price_1UAzhHAEZlsb6DBYWw2oUCeO'
     or p_pro_price is distinct from 'price_1UEw6FAEZlsb6DBYuksCKOBR' then raise exception 'billing_policy_summary_identity_invalid'; end if;
  -- Preserve the established personal/family conflict and trial authorities.
  -- This function cannot infer a paid tier from a Price argument or metadata.
  return public.user_subscription_summary(p_user);
end;
$$;

create function public.kova_policy_readiness()
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare ready boolean:=true; signature text; name text; oid_value oid;
begin
  foreach signature in array array[
    'public.kova_policy_readiness()','public.kova_policy_claim_customer(uuid,text)',
    'public.kova_policy_complete_customer(uuid,text,uuid,text)','public.kova_policy_claim_checkout(uuid,text,text,text,text)',
    'public.kova_policy_attach_checkout(uuid,text,uuid,text,timestamp with time zone)',
    'public.kova_policy_settle_checkout(uuid,text,uuid,text,text)','public.kova_policy_checkout_status(uuid,text,uuid)',
    'public.kova_policy_pending_checkout(uuid)','public.kova_policy_customer_for_portal(uuid,text)',
    'public.kova_policy_apply_legacy_event(text,jsonb)','public.kova_policy_account_status(uuid)',
    'public.kova_policy_schedule_deletion(uuid)','public.kova_policy_recover_deletion(uuid)',
    'public.kova_policy_due_deletions(integer)','public.kova_policy_begin_finalization(uuid)',
    'public.kova_policy_renew_finalization(uuid,uuid)','public.kova_policy_ack_customer_retired(uuid,text,text,uuid)',
    'public.kova_policy_confirm_finalization(uuid,uuid)','public.kova_monthly_subscription_summary(uuid,text,text)',
    'public.billing_user_plan_tier(uuid)','public.effective_user_plan_tier(uuid)','public.user_subscription_summary(uuid)',
    'kova_private.kova_policy_auth_lock(uuid)','kova_private.kova_policy_lock_account(uuid,boolean)',
    'kova_private.kova_policy_checkout_json(public.kova_policy_checkout_claims)','kova_private.kova_policy_guard_auth_deletion()'
  ] loop
    oid_value:=to_regprocedure(signature);
    if oid_value is null then ready:=false;
    elsif not has_function_privilege('service_role',oid_value,'execute') then ready:=false;
    elsif (signature like 'public.kova_%' or signature like 'kova_private.kova_policy_%') and (has_function_privilege('anon',oid_value,'execute')
      or has_function_privilege('authenticated',oid_value,'execute')) then ready:=false; end if;
  end loop;
  foreach name in array array['kova_policy_accounts','kova_policy_customer_bindings','kova_policy_checkout_claims',
    'kova_policy_intro_redemptions','kova_policy_event_receipts','kova_policy_subscription_state'] loop
    oid_value:=to_regclass('public.'||name);
    if oid_value is null then ready:=false;
    elsif not (select relrowsecurity from pg_class where oid=oid_value)
      or not has_table_privilege('service_role',oid_value,'select')
      or not has_table_privilege('service_role',oid_value,'insert')
      or not has_table_privilege('service_role',oid_value,'update')
      or not has_table_privilege('service_role',oid_value,'delete')
      or has_table_privilege('anon',oid_value,'select,insert,update,delete')
      or has_table_privilege('authenticated',oid_value,'select,insert,update,delete') then ready:=false; end if;
  end loop;
  if not has_schema_privilege('service_role','kova_private','USAGE')
     or (select count(*) from public.billing_plan_tiers where environment='live')<>3
     or not exists(select 1 from public.billing_plan_tiers where environment='live' and stripe_price_id='price_1UAzhHAEZlsb6DBYWw2oUCeO' and lookup_key='plus_monthly' and tier='plus')
     or not exists(select 1 from public.billing_plan_tiers where environment='live' and stripe_price_id='price_1UEw6FAEZlsb6DBYuksCKOBR' and lookup_key='pro_monthly' and tier='pro')
     or not exists(select 1 from public.billing_plan_tiers where environment='live' and stripe_price_id='price_1UAzhRAEZlsb6DBYlafU4mhc' and lookup_key='pro_monthly' and tier='pro')
     or not exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass and tgname='kova_policy_guard_auth_deletion'
       and not tgisinternal and tgenabled='O' and tgfoid=to_regprocedure('kova_private.kova_policy_guard_auth_deletion()')) then ready:=false; end if;
  return jsonb_build_object('schemaVersion','monthly-intro-v1','ready',ready,'recoveryHours',720);
end;
$$;

-- New functions are not a browser API. Keep invoker semantics and require the
-- existing protected service role for both routines and underlying RLS tables.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='public' and (p.proname like 'kova_policy_%' or p.proname='kova_monthly_subscription_summary'))
       or (n.nspname='kova_private' and p.proname in ('kova_policy_auth_lock','kova_policy_lock_account','kova_policy_checkout_json','kova_policy_guard_auth_deletion'))
  loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end;
$$;

-- Verify additive installation against the complete pre-change catalog of the
-- existing relations, policies, triggers, ACLs and tier authorities. Persist
-- only its checksum on a new object for guarded, unused-installation removal.
do $$
declare baseline jsonb; observed_catalog jsonb; baseline_sha text; relation_name text; used boolean;
begin
  select snapshot into strict baseline from pg_temp.kova_monthly_install_baseline;
  select snapshot into strict observed_catalog from pg_temp.kova_monthly_baseline_catalog;
  if observed_catalog is distinct from baseline then raise exception 'monthly_policy_existing_catalog_changed'; end if;
  foreach relation_name in array array['kova_policy_accounts','kova_policy_customer_bindings','kova_policy_checkout_claims',
    'kova_policy_intro_redemptions','kova_policy_event_receipts','kova_policy_subscription_state'] loop
    execute format('select exists(select 1 from public.%I)',relation_name) into used;
    if used then raise exception 'monthly_policy_installation_not_empty'; end if;
  end loop;
  baseline_sha:=encode(sha256(convert_to(baseline::text,'UTF8')),'hex');
  execute format('comment on table public.kova_policy_accounts is %L',
    'kova-monthly-intro-v1;unused-uninstall-baseline-sha256='||baseline_sha);
end;
$$;
drop view pg_temp.kova_monthly_baseline_catalog;
commit;
