-- Developer delegation never grants ownership of the underlying connector.
create table public.developer_mcp_connections_v1 (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.developer_projects(id) on delete cascade,
  api_key_id uuid not null references public.developer_billing_keys(id) on delete cascade,
  linked_account_id uuid not null references public.integration_linked_accounts(id) on delete cascade,
  server_id text not null check(server_id ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  tool_name text not null check(tool_name ~ '^[A-Za-z0-9_.-]{1,128}$'),
  binding_hash text not null check(binding_hash ~ '^[A-Za-z0-9_-]{43}$'),
  key_digest text not null check(key_digest ~ '^[a-f0-9]{64}$'),
  credential_digest text not null check(credential_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null,
  expires_at timestamptz not null check(expires_at>created_at and expires_at<=created_at+interval '1 day'),
  revoked_at timestamptz
);
alter table public.developer_mcp_connections_v1 enable row level security;
revoke all on table public.developer_mcp_connections_v1 from public,anon,authenticated;
grant select,insert,update,delete on table public.developer_mcp_connections_v1 to service_role;
create index developer_mcp_connections_owner_project_idx on public.developer_mcp_connections_v1(owner_id,project_id,expires_at);
create index developer_mcp_connections_key_idx on public.developer_mcp_connections_v1(api_key_id,expires_at);

create function public.manage_developer_mcp_connections_v1(p_owner uuid,p_project uuid,p_key uuid,p_operation text,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  acct uuid; keyrow public.developer_billing_keys%rowtype; linked public.integration_linked_accounts%rowtype;
  g public.developer_mcp_connections_v1%rowtype; now_at timestamptz; result jsonb; target uuid;
begin
  if p_owner is null or p_project is null or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>4096
  then raise exception 'developer_mcp_connection_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
  now_at:=clock_timestamp();
  select p.account_id into acct from public.developer_projects p join public.developer_account_owners a on a.account_id=p.account_id where p.id=p_project and a.owner_id=p_owner;
  if acct is null or not kova_private.auth_user_exists(p_owner) then raise exception 'developer_scope_required' using errcode='42501'; end if;
  -- Owner revocation remains available even when execution is suspended.
  if p_operation='revoke' and p_key is null then
    update public.developer_mcp_connections_v1 set revoked_at=coalesce(revoked_at,now_at) where id=(p_input->>'id')::uuid and owner_id=p_owner and project_id=p_project returning * into g;
    if not found then raise exception 'developer_mcp_connection_not_found'; end if;
    return jsonb_build_object('id',g.id,'revoked_at',g.revoked_at);
  end if;
  if exists(select 1 from public.account_deletion_fences where user_id=p_owner)
    or exists(select 1 from public.banned_users where user_id=p_owner)
    or exists(select 1 from public.user_preferences where user_id=p_owner and coalesce((settings->>'lockdown_mode')::boolean,false))
    or not exists(select 1 from public.developer_credit_accounts where id=acct and suspended_at is null)
  then raise exception 'developer_scope_required' using errcode='42501'; end if;
  if p_key is null and p_operation='owner_list' then
    return jsonb_build_object('accounts',coalesce((select jsonb_agg(to_jsonb(a)) from (select id,provider_account_id as server_id,account_label from public.integration_linked_accounts where owner_id=p_owner and workspace_id is null and provider_id='custom-mcp' and status='connected' and deleted_at is null and 'mcp:reviewed-tool:read'=any(granted_scopes) and (token_expires_at is null or token_expires_at>now_at) order by id limit 30) a),'[]'::jsonb),
      'keys',coalesce((select jsonb_agg(to_jsonb(k)) from (select id,name from public.developer_billing_keys where account_id=acct and project_id=p_project and enabled and revoked_at is null and expires_at>now_at and 'mcp_read'=any(capabilities) order by id limit 100) k),'[]'::jsonb),
      'grants',coalesce((select jsonb_agg(to_jsonb(r)) from (select id,api_key_id,linked_account_id,server_id,tool_name,created_at,expires_at,revoked_at from public.developer_mcp_connections_v1 where owner_id=p_owner and project_id=p_project order by created_at desc limit 100) r),'[]'::jsonb));
  end if;
  target:=case when p_key is null and p_operation='grant' then (p_input->>'keyId')::uuid else p_key end;
  select * into keyrow from public.developer_billing_keys where id=target and account_id=acct and project_id=p_project and enabled and revoked_at is null and expires_at>now_at and 'mcp_read'=any(capabilities) and secret_digest is not null;
  if not found then raise exception 'developer_scope_required' using errcode='42501'; end if;
  if p_key is null and p_operation='grant' then
    if p_input->'approved' is distinct from 'true'::jsonb or coalesce(p_input->>'binding','') !~ '^[A-Za-z0-9_-]{43}$' or coalesce(p_input->>'tool','') !~ '^[A-Za-z0-9_.-]{1,128}$' then raise exception 'developer_mcp_connection_invalid'; end if;
    select * into linked from public.integration_linked_accounts where id=(p_input->>'linkedAccountId')::uuid and owner_id=p_owner and workspace_id is null and provider_id='custom-mcp' and provider_account_id=p_input->>'serverId' and status='connected' and deleted_at is null and 'mcp:reviewed-tool:read'=any(granted_scopes) and (token_expires_at is null or token_expires_at>now_at);
    if not found then raise exception 'developer_mcp_connection_not_found'; end if;
    delete from public.developer_mcp_connections_v1 where owner_id=p_owner and expires_at<=now_at-interval '7 days';
    if (select count(*) from public.developer_mcp_connections_v1 where owner_id=p_owner)>=100 or (select count(*) from public.developer_mcp_connections_v1 where owner_id=p_owner and project_id=p_project and revoked_at is null and expires_at>now_at)>=10 then raise exception 'developer_mcp_connection_quota_exceeded'; end if;
    insert into public.developer_mcp_connections_v1(id,owner_id,project_id,api_key_id,linked_account_id,server_id,tool_name,binding_hash,key_digest,credential_digest,created_at,expires_at)
      values((p_input->>'id')::uuid,p_owner,p_project,target,linked.id,linked.provider_account_id,p_input->>'tool',p_input->>'binding',keyrow.secret_digest,encode(sha256(convert_to(linked.access_token_ciphertext,'UTF8')),'hex'),now_at,least(now_at+interval '1 day',keyrow.expires_at,coalesce(linked.token_expires_at,'infinity'::timestamptz))) returning * into g;
    return jsonb_build_object('id',g.id,'server_id',g.server_id,'tool_name',g.tool_name,'expires_at',g.expires_at);
  elsif p_key is not null and p_operation='list' then
    select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into result from (select d.id,d.server_id,d.tool_name,d.binding_hash,d.expires_at from public.developer_mcp_connections_v1 d join public.integration_linked_accounts a on a.id=d.linked_account_id and a.owner_id=d.owner_id and a.provider_account_id=d.server_id where d.owner_id=p_owner and d.project_id=p_project and d.api_key_id=p_key and d.key_digest=keyrow.secret_digest and d.revoked_at is null and d.expires_at>now_at and a.workspace_id is null and a.provider_id='custom-mcp' and a.status='connected' and a.deleted_at is null and 'mcp:reviewed-tool:read'=any(a.granted_scopes) and (a.token_expires_at is null or a.token_expires_at>now_at) and d.credential_digest=encode(sha256(convert_to(a.access_token_ciphertext,'UTF8')),'hex') order by d.created_at desc limit 10) r;
    return result;
  elsif p_key is not null and p_operation='authorize' then
    select * into g from public.developer_mcp_connections_v1 where id=(p_input->>'id')::uuid and owner_id=p_owner and project_id=p_project and api_key_id=p_key and key_digest=keyrow.secret_digest and revoked_at is null and expires_at>now_at and tool_name=p_input->>'tool';
    if not found then raise exception 'developer_mcp_connection_not_found'; end if;
    select * into linked from public.integration_linked_accounts where id=g.linked_account_id and owner_id=p_owner and workspace_id is null and provider_id='custom-mcp' and provider_account_id=g.server_id and status='connected' and deleted_at is null and 'mcp:reviewed-tool:read'=any(granted_scopes) and (token_expires_at is null or token_expires_at>now_at) and g.credential_digest=encode(sha256(convert_to(access_token_ciphertext,'UTF8')),'hex');
    if not found then raise exception 'developer_mcp_connection_not_found'; end if;
    return jsonb_build_object('id',g.id,'server_id',g.server_id,'tool_name',g.tool_name,'binding_hash',g.binding_hash,'credential',linked.access_token_ciphertext);
  end if;
  raise exception 'developer_mcp_connection_invalid';
end;
$$;
revoke all on function public.manage_developer_mcp_connections_v1(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.manage_developer_mcp_connections_v1(uuid,uuid,uuid,text,jsonb) to service_role;
