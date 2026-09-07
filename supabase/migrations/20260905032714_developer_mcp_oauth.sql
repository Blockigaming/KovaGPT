-- Source only: no clients, consent, credentials, funding or OAuth activation are seeded.
create table public.mcp_oauth_clients (
 id uuid primary key, registered_by uuid references auth.users(id) on delete set null,
 metadata jsonb not null check(jsonb_typeof(metadata)='object' and pg_column_size(metadata)<=16384),
 active boolean not null default true, created_at timestamptz not null default now(), expires_at timestamptz not null
);
create table public.mcp_oauth_requests (
 id uuid primary key, client_id uuid not null references public.mcp_oauth_clients(id) on delete cascade,
 owner_id uuid references auth.users(id) on delete cascade,
 request jsonb not null check(jsonb_typeof(request)='object' and pg_column_size(request)<=8192),
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 decision text check(decision in ('approved','denied')), created_at timestamptz not null default now(), expires_at timestamptz not null
);
create index mcp_requests_expiry_idx on public.mcp_oauth_requests(expires_at,id);
create table public.mcp_oauth_grants (
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 client_id uuid not null references public.mcp_oauth_clients(id),
 project_id uuid not null references public.developer_projects(id) on delete cascade,
 key_id uuid not null unique references public.developer_billing_keys(id) on delete cascade,
 resource text not null, scopes text[] not null, review_hash text not null check(review_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(), expires_at timestamptz not null,
 activated_at timestamptz, revoked_at timestamptz
);
create index mcp_grants_owner_idx on public.mcp_oauth_grants(owner_id,id);
create index mcp_grants_client_idx on public.mcp_oauth_grants(client_id,id);
create table public.mcp_oauth_codes (
 id uuid primary key, grant_id uuid not null references public.mcp_oauth_grants(id) on delete cascade,
 digest text not null check(digest ~ '^[a-f0-9]{64}$'), redirect_uri text not null,
 challenge text not null check(challenge ~ '^[A-Za-z0-9_-]{43}$'), expires_at timestamptz not null, consumed_at timestamptz
);
create table public.mcp_oauth_tokens (
 id uuid primary key, grant_id uuid not null references public.mcp_oauth_grants(id) on delete cascade,
 kind text not null check(kind in ('access','refresh')), digest text not null check(digest ~ '^[a-f0-9]{64}$'),
 scopes text[] not null, expires_at timestamptz not null, consumed_at timestamptz
);
create index mcp_tokens_grant_idx on public.mcp_oauth_tokens(grant_id,id);
create index mcp_tokens_expiry_idx on public.mcp_oauth_tokens(expires_at,id) where kind='access';
alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_oauth_requests enable row level security;
alter table public.mcp_oauth_grants enable row level security;
alter table public.mcp_oauth_codes enable row level security;
alter table public.mcp_oauth_tokens enable row level security;
revoke all on public.mcp_oauth_clients,public.mcp_oauth_requests,public.mcp_oauth_grants,public.mcp_oauth_codes,public.mcp_oauth_tokens from public,anon,authenticated;
grant select,insert,update,delete on public.mcp_oauth_clients,public.mcp_oauth_requests,public.mcp_oauth_grants,public.mcp_oauth_codes,public.mcp_oauth_tokens to service_role;

create function kova_private.mcp_owner_current(p_owner uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=p_owner and deleted_at is null and email_confirmed_at is not null
  and is_anonymous is not true and (banned_until is null or banned_until<=now()))
 and not exists(select 1 from public.account_deletion_fences where user_id=p_owner)
 and not exists(select 1 from public.banned_users where user_id=p_owner)
 and not exists(select 1 from public.user_preferences where user_id=p_owner and coalesce((settings->>'lockdown_mode')::boolean,false));
$$;
revoke all on function kova_private.mcp_owner_current(uuid) from public,anon,authenticated;
grant execute on function kova_private.mcp_owner_current(uuid) to service_role;

-- Client/grant revocation disables the ordinary metering key, so it is enforced
-- again by canonical admission and dispatch even after an MCP authentication.
create function kova_private.mcp_disable_grant_key()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
 if tg_op='DELETE' or (new.revoked_at is not null and old.revoked_at is null) then
  update public.developer_billing_keys set enabled=false,revoked_at=coalesce(revoked_at,now()) where id=old.key_id;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function kova_private.mcp_disable_grant_key() from public,anon,authenticated;
create trigger mcp_disable_grant_key before delete or update on public.mcp_oauth_grants for each row execute function kova_private.mcp_disable_grant_key();

create function public.register_mcp_oauth_client(p_id uuid,p_owner uuid,p_metadata jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if p_owner is not null then
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
  if not kova_private.mcp_owner_current(p_owner) then raise exception 'mcp_oauth_access_denied';end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('mcp_oauth_registry',0));
 if p_id is null or p_metadata is null or jsonb_typeof(p_metadata)<>'object' or pg_column_size(p_metadata)>16384
  or length(coalesce(p_metadata->>'client_name','')) not between 1 and 80
  or jsonb_typeof(p_metadata->'redirect_uris') is distinct from 'array' or jsonb_array_length(p_metadata->'redirect_uris') not between 1 and 5
  or p_metadata->>'token_endpoint_auth_method' is distinct from 'none' then raise exception 'mcp_oauth_invalid_client_metadata';end if;
 delete from public.mcp_oauth_clients c where c.id in(select x.id from public.mcp_oauth_clients x where (not x.active or x.expires_at<now()-interval '1 day') and not exists(select 1 from public.mcp_oauth_grants g where g.client_id=x.id) order by x.expires_at,x.id limit 100);
 if (select count(*) from public.mcp_oauth_clients)>=10000 or (select count(*) from public.mcp_oauth_clients where active and expires_at>now())>=1000
  or (p_owner is not null and (select count(*) from public.mcp_oauth_clients where registered_by=p_owner and active and expires_at>now())>=20) then raise exception 'mcp_oauth_capacity';end if;
 insert into public.mcp_oauth_clients(id,registered_by,metadata,expires_at) values(p_id,p_owner,p_metadata,now()+case when p_owner is null then interval '7 days' else interval '1 year' end);
 return jsonb_build_object('client_id',p_id,'client_id_issued_at',extract(epoch from now())::bigint)||p_metadata;
end $$;

create function public.begin_mcp_oauth_request(p_id uuid,p_client uuid,p_request jsonb,p_hash text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare client public.mcp_oauth_clients;
begin
 perform pg_advisory_xact_lock(hashtextextended('mcp_oauth_registry',0));
 select * into client from public.mcp_oauth_clients where id=p_client and active and expires_at>now() for share;
 if not found then raise exception 'mcp_oauth_invalid_client';end if;
 if p_id is null or p_request is null or pg_column_size(p_request)>8192 or p_hash is null or p_hash !~ '^[a-f0-9]{64}$'
  or p_request->>'clientId' is distinct from p_client::text
  or not (client.metadata->'redirect_uris') ? (p_request->>'redirectUri')
  or p_request->>'challenge' is null or p_request->>'challenge' !~ '^[A-Za-z0-9_-]{43}$'
  or jsonb_typeof(p_request->'scopes') is distinct from 'array' or jsonb_array_length(p_request->'scopes') not between 1 and 4
  or exists(select 1 from jsonb_array_elements_text(p_request->'scopes') x where x not in ('chat','image_generation','embeddings','files')) then raise exception 'mcp_oauth_invalid_request';end if;
 delete from public.mcp_oauth_requests where id in(select id from public.mcp_oauth_requests where expires_at<now()-interval '1 day' order by expires_at,id limit 1000);
 if (select count(*) from public.mcp_oauth_requests)>=10000 or (select count(*) from public.mcp_oauth_requests where expires_at>now())>=5000 then raise exception 'mcp_oauth_capacity';end if;
 insert into public.mcp_oauth_requests(id,client_id,request,request_hash,expires_at) values(p_id,p_client,p_request,p_hash,now()+interval '10 minutes');
 return true;
end $$;

create function public.read_mcp_oauth_consent(p_owner uuid,p_request uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.mcp_oauth_requests;c public.mcp_oauth_clients;projects jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 if not kova_private.mcp_owner_current(p_owner) then raise exception 'mcp_oauth_access_denied';end if;
 select * into r from public.mcp_oauth_requests where id=p_request and expires_at>now() for update;
 if not found or (r.owner_id is not null and r.owner_id<>p_owner) then raise exception 'mcp_oauth_invalid_request';end if;
 select * into c from public.mcp_oauth_clients where id=r.client_id and active and expires_at>now();
 if not found then raise exception 'mcp_oauth_invalid_client';end if;
 if r.owner_id is null then update public.mcp_oauth_requests set owner_id=p_owner where id=r.id;end if;
 select coalesce(jsonb_agg(x order by x.id),'[]') into projects from (
  select p.id,p.name,p.account_id,a.currency,least(o.request_limit,l.request_limit) as request_limit,
   least(o.daily_limit,l.daily_limit) as daily_limit,least(o.monthly_limit,l.monthly_limit) as monthly_limit,least(o.concurrent_limit,l.concurrent_limit,8) as concurrent_limit
  from public.developer_projects p join public.developer_account_owners own on own.account_id=p.account_id and own.owner_id=p_owner
  join public.developer_credit_accounts a on a.id=p.account_id and a.suspended_at is null
  join public.developer_billing_limits o on o.account_id=a.id and o.scope_type='organization' and o.scope_id=a.organization_id
  join public.developer_billing_limits l on l.account_id=a.id and l.scope_type='project' and l.scope_id=p.id order by p.id limit 100) x;
 return jsonb_build_object('id',r.id,'requestHash',r.request_hash,'clientId',r.client_id,'clientName',c.metadata->>'client_name','redirectUri',r.request->>'redirectUri',
  'refreshAllowed',(c.metadata->'grant_types') ? 'refresh_token','resource',r.request->>'resource','scopes',r.request->'scopes','decision',r.decision,'projects',projects,'expiresAt',r.expires_at);
end $$;

create function public.decide_mcp_oauth_consent(p_owner uuid,p_request uuid,p_request_hash text,p_approve boolean,p_project uuid,p_scopes text[],p_limits jsonb,p_review_hash text,p_grant uuid,p_key uuid,p_key_digest text,p_code uuid,p_code_digest text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.mcp_oauth_requests;c public.mcp_oauth_clients;a public.developer_credit_accounts;l public.developer_billing_limits;project public.developer_projects;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 if not kova_private.mcp_owner_current(p_owner) then raise exception 'mcp_oauth_access_denied';end if;
 perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
 select * into r from public.mcp_oauth_requests where id=p_request and owner_id=p_owner and expires_at>now() for update;
 if not found or r.decision is not null or r.request_hash is distinct from p_request_hash or p_approve is null then raise exception 'mcp_oauth_invalid_request';end if;
 select * into c from public.mcp_oauth_clients where id=r.client_id and active and expires_at>now() for share;
 if not found then raise exception 'mcp_oauth_invalid_client';end if;
 if not p_approve then
  update public.mcp_oauth_requests set decision='denied' where id=r.id;
  return jsonb_build_object('redirectUri',r.request->>'redirectUri','state',r.request->>'state','denied',true);
 end if;
 select * into project from public.developer_projects where id=p_project;
 if not found or not exists(select 1 from public.developer_account_owners where account_id=project.account_id and owner_id=p_owner) then raise exception 'mcp_oauth_access_denied';end if;
 select * into a from public.developer_credit_accounts where id=project.account_id and suspended_at is null for update;
 if not found then raise exception 'mcp_oauth_access_denied';end if;
 if cardinality(p_scopes) not between 1 and 4 or p_scopes is null
  or exists(select 1 from unnest(p_scopes) s where not (r.request->'scopes') ? s)
  or p_review_hash is null or p_review_hash !~ '^[a-f0-9]{64}$' or p_key_digest is null or p_key_digest !~ '^[a-f0-9]{64}$' or p_code_digest is null or p_code_digest !~ '^[a-f0-9]{64}$'
  or cardinality(p_scopes)<>(select count(distinct x) from unnest(p_scopes) x)
  or p_limits is null or jsonb_typeof(p_limits)<>'object' or not p_limits ?& array['request','daily','monthly','concurrent']
  or exists(select 1 from jsonb_each(p_limits) x where jsonb_typeof(x.value)<>'number') or (p_limits->>'request')::numeric<=0 or (p_limits->>'daily')::numeric<(p_limits->>'request')::numeric
  or (p_limits->>'monthly')::numeric<(p_limits->>'daily')::numeric or (p_limits->>'concurrent')::integer not between 1 and 8 then raise exception 'mcp_oauth_invalid_request';end if;
 for l in select * from public.developer_billing_limits where account_id=a.id and ((scope_type='organization' and scope_id=a.organization_id) or (scope_type='project' and scope_id=project.id)) loop
  if (p_limits->>'request')::numeric>l.request_limit or (p_limits->>'daily')::numeric>l.daily_limit or (p_limits->>'monthly')::numeric>l.monthly_limit or (p_limits->>'concurrent')::integer>l.concurrent_limit then raise exception 'mcp_oauth_invalid_request';end if;
 end loop;
 if (select count(*) from public.developer_billing_limits where account_id=a.id and ((scope_type='organization' and scope_id=a.organization_id) or (scope_type='project' and scope_id=project.id)))<>2 then raise exception 'mcp_oauth_limits_required';end if;
 update public.mcp_oauth_grants set revoked_at=now() where owner_id=p_owner and revoked_at is null and (expires_at<=now() or (activated_at is null and created_at<now()-interval '2 minutes'));
 delete from public.mcp_oauth_grants where id in(select id from public.mcp_oauth_grants where owner_id=p_owner and coalesce(revoked_at,expires_at)<now()-interval '30 days' order by created_at,id limit 100);
 if (select count(*) from public.mcp_oauth_grants where owner_id=p_owner)>=1000 or (select count(*) from public.mcp_oauth_grants)>=50000 then raise exception 'mcp_oauth_capacity';end if;
 if (select count(*) from public.developer_billing_keys where account_id=a.id and revoked_at is null)>=100 then raise exception 'mcp_oauth_capacity';end if;
 insert into public.developer_billing_keys(id,account_id,project_id,enabled,expires_at,capabilities,secret_digest,secret_suffix,name,credential_owner)
  values(p_key,a.id,project.id,true,now()+interval '30 days',p_scopes,p_key_digest,'oauth2',left('MCP: '||(c.metadata->>'client_name'),80),p_owner);
 insert into public.developer_billing_limits values(a.id,'key',p_key,(p_limits->>'request')::numeric,(p_limits->>'daily')::numeric,(p_limits->>'monthly')::numeric,(p_limits->>'concurrent')::integer);
 insert into public.mcp_oauth_grants(id,owner_id,client_id,project_id,key_id,resource,scopes,review_hash,expires_at)
  values(p_grant,p_owner,r.client_id,project.id,p_key,r.request->>'resource',p_scopes,p_review_hash,now()+interval '30 days');
 insert into public.mcp_oauth_codes(id,grant_id,digest,redirect_uri,challenge,expires_at)
  values(p_code,p_grant,p_code_digest,r.request->>'redirectUri',r.request->>'challenge',now()+interval '2 minutes');
 update public.mcp_oauth_requests set decision='approved' where id=r.id;
 return jsonb_build_object('redirectUri',r.request->>'redirectUri','state',r.request->>'state','grantId',p_grant,'denied',false);
end $$;

create function public.exchange_mcp_oauth_token(p_kind text,p_token uuid,p_digest text,p_client uuid,p_resource text,p_redirect text,p_challenge text,p_scopes text[],p_access uuid,p_access_digest text,p_refresh uuid,p_refresh_digest text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare g public.mcp_oauth_grants;code public.mcp_oauth_codes;token public.mcp_oauth_tokens;scopes text[];v_grant uuid;v_owner uuid;refresh_allowed boolean;
begin
 if p_kind='code' then select grant_id into v_grant from public.mcp_oauth_codes where id=p_token;
 elsif p_kind='refresh' then select grant_id into v_grant from public.mcp_oauth_tokens where id=p_token and kind='refresh';
 else raise exception 'mcp_oauth_invalid_request';end if;
 select owner_id into v_owner from public.mcp_oauth_grants where id=v_grant;
 if v_owner is null then return jsonb_build_object('error','invalid_grant');end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text,20260903204500));
 if not kova_private.mcp_owner_current(v_owner) then return jsonb_build_object('error','invalid_grant');end if;
 perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
 select * into g from public.mcp_oauth_grants where id=v_grant and owner_id=v_owner for update;
 if not found or g.revoked_at is not null or g.expires_at<=now() or g.client_id is distinct from p_client or g.resource is distinct from p_resource
  or not exists(select 1 from public.mcp_oauth_clients where id=g.client_id and active and expires_at>now())
  or not exists(select 1 from public.developer_billing_keys k join public.developer_account_owners own on own.account_id=k.account_id
   join public.developer_credit_accounts a on a.id=k.account_id join public.developer_projects p on p.id=k.project_id and p.account_id=k.account_id
   where k.id=g.key_id and k.project_id=g.project_id and k.credential_owner=v_owner and k.enabled and k.revoked_at is null and k.expires_at>now() and own.owner_id=v_owner and a.suspended_at is null)
 then return jsonb_build_object('error','invalid_grant');end if;
 select (metadata->'grant_types') ? 'refresh_token' into refresh_allowed from public.mcp_oauth_clients where id=g.client_id;
 if p_kind='refresh' and not refresh_allowed then return jsonb_build_object('error','unauthorized_client');end if;
 if p_kind='code' then
  select * into code from public.mcp_oauth_codes where id=p_token and grant_id=g.id for update;
  if not found or code.digest is distinct from p_digest or code.redirect_uri is distinct from p_redirect or code.challenge is distinct from p_challenge then return jsonb_build_object('error','invalid_grant');end if;
  if code.consumed_at is not null or code.expires_at<=now() then
   if code.consumed_at is not null or g.activated_at is null then update public.mcp_oauth_grants set revoked_at=now() where id=g.id;end if;
   return jsonb_build_object('error','invalid_grant');
  end if;
  scopes:=g.scopes;
 else
  select * into token from public.mcp_oauth_tokens where id=p_token and grant_id=g.id and kind='refresh' for update;
  if not found or token.digest is distinct from p_digest then return jsonb_build_object('error','invalid_grant');end if;
  if token.consumed_at is not null then
   update public.mcp_oauth_grants set revoked_at=now() where id=g.id;
   return jsonb_build_object('error','invalid_grant');
  end if;
  if token.expires_at<=now() then return jsonb_build_object('error','invalid_grant');end if;
  scopes:=coalesce(p_scopes,token.scopes);
  if cardinality(scopes) not between 1 and 4 or not scopes<@token.scopes then return jsonb_build_object('error','invalid_scope');end if;
 end if;
 if p_access is null or p_refresh is null or p_access=p_refresh or p_access_digest is null or p_access_digest !~ '^[a-f0-9]{64}$'
  or p_refresh_digest is null or p_refresh_digest !~ '^[a-f0-9]{64}$' then raise exception 'mcp_oauth_invalid_request';end if;
 delete from public.mcp_oauth_tokens where grant_id=g.id and kind='access' and expires_at<now()-interval '1 day';
 if (select count(*) from public.mcp_oauth_tokens where grant_id=g.id)>=6000 then
  update public.mcp_oauth_grants set revoked_at=now() where id=g.id;
  return jsonb_build_object('error','invalid_grant');
 end if;
 if p_kind='code' then update public.mcp_oauth_codes set consumed_at=now() where id=code.id;
 else update public.mcp_oauth_tokens set consumed_at=now() where id=token.id;end if;
 insert into public.mcp_oauth_tokens(id,grant_id,kind,digest,scopes,expires_at) values
  (p_access,g.id,'access',p_access_digest,scopes,least(g.expires_at,now()+interval '15 minutes'));
 if refresh_allowed then insert into public.mcp_oauth_tokens(id,grant_id,kind,digest,scopes,expires_at) values(p_refresh,g.id,'refresh',p_refresh_digest,scopes,g.expires_at);end if;
 update public.mcp_oauth_grants set activated_at=coalesce(activated_at,now()) where id=g.id;
 return jsonb_build_object('refreshAllowed',refresh_allowed,'scope',array_to_string(scopes,' '),'expiresIn',least(900,floor(extract(epoch from g.expires_at-now())))::integer);
end $$;

create function public.validate_mcp_oauth_access(p_token uuid,p_digest text,p_resource text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare g public.mcp_oauth_grants;t public.mcp_oauth_tokens;k public.developer_billing_keys;v_owner uuid;c public.mcp_oauth_clients;
begin
 select x.owner_id into v_owner from public.mcp_oauth_tokens y join public.mcp_oauth_grants x on x.id=y.grant_id where y.id=p_token and y.kind='access';
 if v_owner is null then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text,20260903204500));
 if not kova_private.mcp_owner_current(v_owner) then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
 select * into t from public.mcp_oauth_tokens where id=p_token and kind='access' and digest=p_digest and expires_at>now() and consumed_at is null;
 if not found then return null;end if;
 select * into g from public.mcp_oauth_grants where id=t.grant_id and owner_id=v_owner and resource=p_resource and revoked_at is null and expires_at>now();
 if not found or not t.scopes<@g.scopes then return null;end if;
 select * into c from public.mcp_oauth_clients where id=g.client_id and active and expires_at>now();
 if not found then return null;end if;
 -- Browser origins are checked by the API against the exact registered redirect
 -- origins; returning metadata here never grants access before that check.
 select key.* into k from public.developer_billing_keys key join public.developer_account_owners own on own.account_id=key.account_id
  join public.developer_credit_accounts a on a.id=key.account_id join public.developer_projects p on p.id=key.project_id and p.account_id=key.account_id
  where key.id=g.key_id and key.project_id=g.project_id and key.credential_owner=v_owner and key.enabled and key.revoked_at is null and key.expires_at>now() and own.owner_id=v_owner and a.suspended_at is null;
 if not found or not t.scopes<@k.capabilities then return null;end if;
 return jsonb_build_object('id',k.id,'account_id',k.account_id,'project_id',k.project_id,'capabilities',to_jsonb(t.scopes),'ownerId',v_owner,'redirectUris',c.metadata->'redirect_uris');
end $$;

create function public.revoke_mcp_oauth_grant(p_owner uuid,p_grant uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 if not kova_private.auth_user_exists(p_owner) then raise exception 'mcp_oauth_access_denied';end if;
 perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
 update public.mcp_oauth_grants set revoked_at=coalesce(revoked_at,now()) where id=p_grant and owner_id=p_owner;
 return found;
end $$;
create function public.revoke_mcp_oauth_token(p_client uuid,p_token uuid,p_digest text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_grant uuid;v_owner uuid;
begin
 select g.id,g.owner_id into v_grant,v_owner from public.mcp_oauth_tokens t join public.mcp_oauth_grants g on g.id=t.grant_id where t.id=p_token and t.digest=p_digest and g.client_id=p_client;
 if v_owner is null then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text,20260903204500));
 perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
 update public.mcp_oauth_grants set revoked_at=coalesce(revoked_at,now()) where id=v_grant and owner_id=v_owner;
 return found;
end $$;

create view public.mcp_oauth_grant_export_rows with(security_invoker=true) as
 select g.id,g.owner_id,g.project_id,g.client_id,c.metadata->>'client_name' as client_name,
  g.resource,g.scopes,g.created_at,g.expires_at,g.activated_at,g.revoked_at,
  a.currency,l.request_limit,l.daily_limit,l.monthly_limit,l.concurrent_limit
 from public.mcp_oauth_grants g join public.mcp_oauth_clients c on c.id=g.client_id
 join public.developer_projects p on p.id=g.project_id join public.developer_credit_accounts a on a.id=p.account_id
 left join public.developer_billing_limits l on l.account_id=a.id and l.scope_type='key' and l.scope_id=g.key_id;
revoke all on public.mcp_oauth_grant_export_rows from public,anon,authenticated;
grant select on public.mcp_oauth_grant_export_rows to service_role;

revoke all on function public.register_mcp_oauth_client(uuid,uuid,jsonb),public.begin_mcp_oauth_request(uuid,uuid,jsonb,text),
 public.read_mcp_oauth_consent(uuid,uuid),public.decide_mcp_oauth_consent(uuid,uuid,text,boolean,uuid,text[],jsonb,text,uuid,uuid,text,uuid,text),
 public.exchange_mcp_oauth_token(text,uuid,text,uuid,text,text,text,text[],uuid,text,uuid,text),public.validate_mcp_oauth_access(uuid,text,text),
 public.revoke_mcp_oauth_grant(uuid,uuid),public.revoke_mcp_oauth_token(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.register_mcp_oauth_client(uuid,uuid,jsonb),public.begin_mcp_oauth_request(uuid,uuid,jsonb,text),
 public.read_mcp_oauth_consent(uuid,uuid),public.decide_mcp_oauth_consent(uuid,uuid,text,boolean,uuid,text[],jsonb,text,uuid,uuid,text,uuid,text),
 public.exchange_mcp_oauth_token(text,uuid,text,uuid,text,text,text,text[],uuid,text,uuid,text),public.validate_mcp_oauth_access(uuid,text,text),
 public.revoke_mcp_oauth_grant(uuid,uuid),public.revoke_mcp_oauth_token(uuid,uuid,text) to service_role;

create function public.retire_mcp_oauth_client(p_owner uuid,p_client uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 if not kova_private.auth_user_exists(p_owner) then raise exception 'mcp_oauth_access_denied';end if;
 perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
 perform 1 from public.mcp_oauth_clients where id=p_client and registered_by=p_owner for update;
 if not found then raise exception 'mcp_oauth_access_denied';end if;
 update public.mcp_oauth_grants set revoked_at=coalesce(revoked_at,now()) where client_id=p_client;
 update public.mcp_oauth_clients set active=false where id=p_client;
 return true;
end $$;
revoke all on function public.retire_mcp_oauth_client(uuid,uuid) from public,anon,authenticated;
grant execute on function public.retire_mcp_oauth_client(uuid,uuid) to service_role;
create view public.mcp_oauth_client_export_rows with(security_invoker=true) as
 select id,registered_by as owner_id,metadata,created_at,expires_at,active from public.mcp_oauth_clients where registered_by is not null;
revoke all on public.mcp_oauth_client_export_rows from public,anon,authenticated;
grant select on public.mcp_oauth_client_export_rows to service_role;

-- Registered client metadata is immutable. Auth deletion retires its registration
-- and every dependent grant; shared public metadata is retained only for existing
-- connection history and is garbage collected once no grant references it.
create function kova_private.guard_mcp_client() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.id<>old.id or new.metadata is distinct from old.metadata or new.created_at<>old.created_at
  or (new.registered_by is distinct from old.registered_by and new.registered_by is not null)
  or (new.active and not old.active) or new.expires_at>old.expires_at then raise exception 'mcp_oauth_client_immutable';end if;
 if old.registered_by is not null and new.registered_by is null then
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  update public.mcp_oauth_grants set revoked_at=coalesce(revoked_at,now()) where client_id=old.id;
  new.active:=false;new.expires_at:=least(new.expires_at,now());
 end if;
 return new;
end $$;
revoke all on function kova_private.guard_mcp_client() from public,anon,authenticated;
create trigger mcp_client_immutable before update on public.mcp_oauth_clients for each row execute function kova_private.guard_mcp_client();
