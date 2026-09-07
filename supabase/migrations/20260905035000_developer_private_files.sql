-- Private bounded text documents; source only. No bucket, data, price or activation is seeded.
create table public.developer_files (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 project_id uuid not null references public.developer_projects(id) on delete cascade,
 filename text not null check(filename ~ '^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}\.(txt|md|csv|json)$'),
 mime_type text not null check(mime_type in ('text/plain','text/markdown','text/csv','application/json')),
 content text not null check(octet_length(content) between 1 and 32768),
 byte_size integer generated always as (octet_length(content)) stored,
 content_digest text not null check(content_digest ~ '^[a-f0-9]{64}$'),
 request_digest text not null check(request_digest ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '30 days',
 unique(owner_id,project_id,request_digest), check(expires_at>created_at)
);
create function public.set_developer_file_digest() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' then raise exception 'developer_file_immutable';end if;
 new.content_digest:=encode(sha256(convert_to(new.content,'UTF8')),'hex');return new;
end $$;
revoke all on function public.set_developer_file_digest() from public,anon,authenticated;
grant execute on function public.set_developer_file_digest() to service_role;
create trigger developer_file_immutable_digest before insert or update on public.developer_files for each row execute function public.set_developer_file_digest();
alter table public.developer_files enable row level security;
revoke all on public.developer_files from public,anon,authenticated;
grant select,insert,delete on public.developer_files to service_role;
create index developer_files_owner_idx on public.developer_files(owner_id,created_at,id);
create index developer_files_expiry_idx on public.developer_files(expires_at,id);
create view public.developer_file_export_records with(security_invoker=true) as
 select id,owner_id,project_id,filename,mime_type,content,byte_size,content_digest,created_at,expires_at from public.developer_files;
revoke all on public.developer_file_export_records from public,anon,authenticated;
grant select on public.developer_file_export_records to service_role;

create function public.manage_developer_files(p_owner uuid,p_key uuid,p_project uuid,p_operation text,p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare f public.developer_files%rowtype; page integer; result jsonb; expected_mime text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 if not kova_private.auth_user_exists(p_owner) or exists(select 1 from public.account_deletion_fences where user_id=p_owner)
  or exists(select 1 from public.banned_users where user_id=p_owner)
  or exists(select 1 from public.user_preferences where user_id=p_owner and coalesce((settings->>'lockdown_mode')::boolean,false)) then raise exception 'developer_owner_unavailable' using errcode='42501'; end if;
 if p_input is null or jsonb_typeof(p_input)<>'object' or pg_column_size(p_input)>131072 then raise exception 'developer_input_invalid'; end if;
 if p_project is not null and not exists(select 1 from public.developer_projects p join public.developer_account_owners a on a.account_id=p.account_id where p.id=p_project and a.owner_id=p_owner) then raise exception 'developer_scope_required' using errcode='42501';end if;
 if p_key is not null then
  if p_project is null or not exists(select 1 from public.developer_billing_keys k join public.developer_account_owners a on a.account_id=k.account_id
   where k.id=p_key and k.project_id=p_project and a.owner_id=p_owner and k.enabled and k.revoked_at is null and k.expires_at>now() and 'files'=any(k.capabilities)) then raise exception 'developer_scope_required' using errcode='42501';end if;
 end if;
 delete from public.developer_files where owner_id=p_owner and expires_at<=now();
 if p_operation='create' then
  if p_key is null or p_project is null then raise exception 'developer_scope_required' using errcode='42501';end if;
  if exists(select 1 from public.developer_projects p join public.developer_credit_accounts a on a.id=p.account_id where p.id=p_project and a.suspended_at is not null) then raise exception 'developer_account_unavailable';end if;
  expected_mime:=case lower(split_part(p_input->>'filename','.',array_length(string_to_array(p_input->>'filename','.'),1))) when 'txt' then 'text/plain' when 'md' then 'text/markdown' when 'csv' then 'text/csv' when 'json' then 'application/json' end;
  if p_input->>'filename' is null or p_input->>'filename' !~ '^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}\.(txt|md|csv|json)$'
   or p_input->>'mimeType' is distinct from expected_mime or jsonb_typeof(p_input->'text') is distinct from 'string'
   or octet_length(p_input->>'text') not between 1 and 32768 or p_input->>'requestDigest' is null or p_input->>'requestDigest' !~ '^[a-f0-9]{64}$' then raise exception 'developer_file_invalid';end if;
  if expected_mime='application/json' then perform (p_input->>'text')::jsonb;end if;
  select * into f from public.developer_files where owner_id=p_owner and project_id=p_project and request_digest=p_input->>'requestDigest';
  if found then
   if f.filename is distinct from p_input->>'filename' or f.mime_type is distinct from p_input->>'mimeType' or f.content is distinct from p_input->>'text' then raise exception 'developer_idempotency_conflict';end if;
   return to_jsonb(f)-'content'-'request_digest'-'owner_id';
  end if;
  if (select count(*) from public.developer_files where owner_id=p_owner)>=100 or (select coalesce(sum(byte_size),0) from public.developer_files where owner_id=p_owner)+octet_length(p_input->>'text')>2097152 then raise exception 'developer_file_quota_exceeded';end if;
  insert into public.developer_files(owner_id,project_id,filename,mime_type,content,request_digest)
   values(p_owner,p_project,p_input->>'filename',p_input->>'mimeType',p_input->>'text',p_input->>'requestDigest') returning * into f;
  return to_jsonb(f)-'content'-'request_digest'-'owner_id';
 elsif p_operation='list' then
  page:=coalesce((p_input->>'page')::integer,0);if page not between 0 and 4 then raise exception 'developer_page_invalid';end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc,t.id),'[]'::jsonb) into result from
   (select id,project_id,filename,mime_type,byte_size,content_digest,created_at,expires_at from public.developer_files where owner_id=p_owner and (p_project is null or project_id=p_project) order by created_at desc,id offset page*25 limit 26) t;
  return jsonb_build_object('data',case when jsonb_array_length(result)>25 then result-25 else result end,'page',page,'hasMore',jsonb_array_length(result)>25,'maximumFiles',100,'maximumBytes',2097152);
 elsif p_operation in ('get','delete') then
  select * into f from public.developer_files where id=(p_input->>'id')::uuid and owner_id=p_owner and (p_project is null or project_id=p_project);
  if not found then raise exception 'developer_file_not_found';end if;
  if p_operation='delete' then delete from public.developer_files where id=f.id;return jsonb_build_object('id',f.id,'deleted',true);end if;
  return to_jsonb(f)-'request_digest'-'owner_id';
 else raise exception 'developer_operation_invalid';end if;
end $$;
revoke all on function public.manage_developer_files(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.manage_developer_files(uuid,uuid,uuid,text,jsonb) to service_role;

create function public.expire_developer_files(p_limit integer default 100) returns integer
language plpgsql security invoker set search_path='' as $$
declare owner uuid; removed integer;
begin
 select owner_id into owner from public.developer_files where expires_at<=now() order by expires_at,id limit 1;
 if owner is null then return 0;end if;
 -- One owner lock per invocation avoids a cross-owner maintenance lock cycle.
 perform pg_advisory_xact_lock(hashtextextended(owner::text,20260903204500));
 delete from public.developer_files where id in (select id from public.developer_files where owner_id=owner and expires_at<=now() order by expires_at,id limit least(greatest(p_limit,1),100));
 get diagnostics removed=row_count;return removed;
end $$;
revoke all on function public.expire_developer_files(integer) from public,anon,authenticated;
grant execute on function public.expire_developer_files(integer) to service_role;

-- Verify file scope and immutable snapshots under the same account lock immediately before the ordinary billing dispatch.
create function public.dispatch_developer_billing_with_files(p_request uuid,p_lease uuid,p_files jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.developer_api_requests%rowtype; owner uuid; item jsonb;
begin
 select own.owner_id into owner from public.developer_api_requests req join public.developer_account_owners own on own.account_id=req.account_id where req.id=p_request and req.lease_token=p_lease;
 if owner is null then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(owner::text,20260903204500));
 if not kova_private.auth_user_exists(owner) or exists(select 1 from public.account_deletion_fences where user_id=owner) then return false;end if;
 select * into r from public.developer_api_requests where id=p_request and lease_token=p_lease and settlement_state='reserved';
 if not found or jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) not between 1 and 4 then return false;end if;
 if not exists(select 1 from public.developer_billing_keys where id=r.api_key_id and 'files'=any(capabilities)) then return false;end if;
 for item in select value from jsonb_array_elements(p_files) loop
  if not exists(select 1 from public.developer_files where id=(item->>'id')::uuid and owner_id=owner and project_id=r.project_id and content_digest=item->>'digest' and expires_at>now()) then return false;end if;
 end loop;
 return public.dispatch_developer_billing(p_request,p_lease);
end $$;
revoke all on function public.dispatch_developer_billing_with_files(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dispatch_developer_billing_with_files(uuid,uuid,jsonb) to service_role;

create or replace function public.manage_developer_workspace(p_owner uuid,p_operation text,p_input jsonb)
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
      or jsonb_typeof(p_input->'scopes') is distinct from 'array' or jsonb_array_length(p_input->'scopes') not between 1 and 5
      or exists(select 1 from jsonb_array_elements_text(p_input->'scopes') s where s not in ('chat','streaming','image_generation','embeddings','files')) then raise exception 'developer_key_invalid';end if;
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
