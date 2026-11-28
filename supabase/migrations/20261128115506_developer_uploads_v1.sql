-- Bounded resumable UTF-8 uploads. No provider dispatch or billing.
create table public.developer_uploads_v1 (
 owner_id uuid not null references auth.users(id) on delete cascade,
 project_id uuid not null references public.developer_projects(id) on delete cascade,
 id uuid not null,
 filename text not null check(filename ~ '^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}\.(txt|md|csv|json)$'),
 mime_type text not null check(mime_type in ('text/plain','text/markdown','text/csv','application/json')),
 total_bytes integer not null check(total_bytes between 1 and 32768),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 received_bytes integer not null default 0 check(received_bytes between 0 and total_bytes),
 part_count integer not null default 0 check(part_count between 0 and 64),
 payload bytea,
 state text not null default 'pending' check(state in ('pending','completed','canceled')),
 file_id uuid,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '1 hour',
 primary key(project_id,id), check(expires_at>created_at),
 check((state='pending' and payload is not null and octet_length(payload)=received_bytes and file_id is null) or (state='completed' and payload is null and received_bytes=total_bytes and file_id is not null) or (state='canceled' and payload is null and file_id is null))
);
alter table public.developer_uploads_v1 enable row level security;
revoke all on public.developer_uploads_v1 from public,anon,authenticated;
grant select,insert,update,delete on public.developer_uploads_v1 to service_role;
create index developer_uploads_owner_v1_idx on public.developer_uploads_v1(owner_id,created_at,id);
create index developer_uploads_expiry_v1_idx on public.developer_uploads_v1(expires_at,id);
create view public.developer_upload_export_records_v1 with(security_invoker=true) as
 select owner_id,project_id,id,filename,mime_type,total_bytes,sha256,received_bytes,part_count,replace(encode(payload,'base64'),chr(10),'') as payload_base64,state,file_id,created_at,expires_at from public.developer_uploads_v1;
revoke all on public.developer_upload_export_records_v1 from public,anon,authenticated;
grant select on public.developer_upload_export_records_v1 to service_role;

create function public.manage_developer_uploads_v1(p_owner uuid,p_key uuid,p_project uuid,p_operation text,p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare u public.developer_uploads_v1%rowtype; target uuid; chunk bytea; off integer; total integer; mime text; result jsonb; content text; expected_keys text[];
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 if not kova_private.auth_user_exists(p_owner) or exists(select 1 from public.account_deletion_fences where user_id=p_owner)
 or exists(select 1 from public.banned_users where user_id=p_owner)
 or exists(select 1 from public.user_preferences where user_id=p_owner and coalesce((settings->>'lockdown_mode')::boolean,false)) then raise exception 'developer_owner_unavailable' using errcode='42501';end if;
 if p_key is null or p_project is null or not exists(select 1 from public.developer_billing_keys k join public.developer_account_owners a on a.account_id=k.account_id join public.developer_projects p on p.id=k.project_id and p.account_id=k.account_id
 where k.id=p_key and k.project_id=p_project and a.owner_id=p_owner and k.enabled and k.revoked_at is null and k.expires_at>now() and 'files'=any(k.capabilities)) then raise exception 'developer_scope_required' using errcode='42501';end if;
 if p_operation in ('create','append','complete') and exists(select 1 from public.developer_projects p join public.developer_credit_accounts a on a.id=p.account_id where p.id=p_project and a.suspended_at is not null) then raise exception 'developer_account_unavailable';end if;
 expected_keys:=case p_operation when 'create' then array['id','filename','mime_type','total_bytes','sha256'] when 'append' then array['id','offset','data'] when 'list' then array[]::text[] when 'get' then array['id'] when 'cancel' then array['id'] when 'complete' then array['id'] else null end;
 if expected_keys is null or p_input is null or jsonb_typeof(p_input)<>'object' or pg_column_size(p_input)>16384 or not (p_input ?& expected_keys) or exists(select 1 from jsonb_object_keys(p_input) k where not(k=any(expected_keys))) then raise exception 'developer_upload_invalid';end if;
 delete from public.developer_uploads_v1 where owner_id=p_owner and expires_at<=now();
 if p_operation='list' then
 select coalesce(jsonb_agg((to_jsonb(t)-'owner_id'-'payload')||jsonb_build_object('object','upload') order by t.created_at desc,t.id),'[]'::jsonb) into result from public.developer_uploads_v1 t where owner_id=p_owner and project_id=p_project;
 return jsonb_build_object('data',result,'object','list');end if;
 if jsonb_typeof(p_input->'id') is distinct from 'string' or p_input->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'developer_upload_invalid';end if;
 target:=(p_input->>'id')::uuid;
 select * into u from public.developer_uploads_v1 where project_id=p_project and owner_id=p_owner and id=target;
 if p_operation='create' then
 mime:=case split_part(p_input->>'filename','.',array_length(string_to_array(p_input->>'filename','.'),1)) when 'txt' then 'text/plain' when 'md' then 'text/markdown' when 'csv' then 'text/csv' when 'json' then 'application/json' end;
 if jsonb_typeof(p_input->'filename') is distinct from 'string' or p_input->>'filename' !~ '^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}\.(txt|md|csv|json)$' or mime is null or p_input->>'mime_type' is distinct from mime or jsonb_typeof(p_input->'total_bytes') is distinct from 'number' or p_input->>'total_bytes' !~ '^[0-9]{1,5}$' or jsonb_typeof(p_input->'sha256') is distinct from 'string' or p_input->>'sha256' !~ '^[a-f0-9]{64}$' then raise exception 'developer_upload_invalid';end if;
 total:=(p_input->>'total_bytes')::integer;if total not between 1 and 32768 then raise exception 'developer_upload_invalid';end if;
 if u.id is not null then
 if u.filename is distinct from p_input->>'filename' or u.mime_type is distinct from mime or u.total_bytes<>total or u.sha256 is distinct from p_input->>'sha256' then raise exception 'developer_idempotency_conflict';end if;
 else
 if (select count(*) from public.developer_uploads_v1 where owner_id=p_owner)>=32 or (select count(*) from public.developer_uploads_v1 where owner_id=p_owner and state='pending')>=8 then raise exception 'developer_upload_quota_exceeded';end if;
 insert into public.developer_uploads_v1(owner_id,project_id,id,filename,mime_type,total_bytes,sha256,payload) values(p_owner,p_project,target,p_input->>'filename',mime,total,p_input->>'sha256',''::bytea) returning * into u;
 end if;
 elsif u.id is null then raise exception 'developer_upload_not_found';
 elsif p_operation='append' then
 if u.state<>'pending' then raise exception 'developer_upload_state_conflict';end if;
 if jsonb_typeof(p_input->'offset') is distinct from 'number' or p_input->>'offset' !~ '^[0-9]{1,5}$' or jsonb_typeof(p_input->'data') is distinct from 'string' or length(p_input->>'data') not between 4 and 10924 or p_input->>'data' !~ '^[A-Za-z0-9+/]+={0,2}$' then raise exception 'developer_upload_invalid';end if;
 off:=(p_input->>'offset')::integer;
 begin chunk:=decode(p_input->>'data','base64');exception when others then raise exception 'developer_upload_invalid';end;
 if octet_length(chunk) not between 1 and 8192 or replace(encode(chunk,'base64'),chr(10),'') is distinct from p_input->>'data' or off+octet_length(chunk)>u.total_bytes then raise exception 'developer_upload_invalid';end if;
 if off<u.received_bytes then
 if off+octet_length(chunk)>u.received_bytes or substring(u.payload from off+1 for octet_length(chunk))<>chunk then raise exception 'developer_idempotency_conflict';end if;
 elsif off<>u.received_bytes then raise exception 'developer_upload_offset_conflict';
 else
 if u.part_count>=64 then raise exception 'developer_upload_quota_exceeded';end if;
 update public.developer_uploads_v1 set payload=payload||chunk,received_bytes=received_bytes+octet_length(chunk),part_count=part_count+1 where project_id=p_project and id=target returning * into u;
 end if;
 elsif p_operation='complete' then
 if u.state='canceled' then raise exception 'developer_upload_state_conflict';end if;
 if u.state='pending' then
 if u.received_bytes<>u.total_bytes or encode(sha256(u.payload),'hex')<>u.sha256 then raise exception 'developer_upload_digest_conflict';end if;
 begin content:=convert_from(u.payload,'UTF8');if u.mime_type='application/json' then perform content::jsonb;end if;exception when others then raise exception 'developer_upload_invalid';end;
 result:=public.manage_developer_files(p_owner,p_key,p_project,'create',jsonb_build_object('filename',u.filename,'mimeType',u.mime_type,'text',content,'requestDigest',encode(sha256(convert_to('developer-upload'||chr(10)||u.id::text,'UTF8')),'hex')));
 update public.developer_uploads_v1 set state='completed',payload=null,file_id=(result->>'id')::uuid where project_id=p_project and id=target returning * into u;
 end if;
 elsif p_operation='cancel' then
 if u.state='completed' then raise exception 'developer_upload_state_conflict';end if;
 update public.developer_uploads_v1 set state='canceled',payload=null where project_id=p_project and id=target returning * into u;
 end if;
 return (to_jsonb(u)-'owner_id'-'payload')||jsonb_build_object('object','upload');
end $$;
revoke all on function public.manage_developer_uploads_v1(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.manage_developer_uploads_v1(uuid,uuid,uuid,text,jsonb) to service_role;
create function public.expire_developer_uploads_v1(p_limit integer default 100) returns integer language plpgsql security invoker set search_path='' as $$
declare owner uuid; removed integer;
begin
 select owner_id into owner from public.developer_uploads_v1 where expires_at<=now() order by expires_at,id limit 1;
 if owner is null then return 0;end if;
 perform pg_advisory_xact_lock(hashtextextended(owner::text,20260903204500));
 delete from public.developer_uploads_v1 where (project_id,id) in (select project_id,id from public.developer_uploads_v1 where owner_id=owner and expires_at<=now() order by expires_at,id limit least(greatest(p_limit,1),100));
 get diagnostics removed=row_count;return removed;
end $$;
revoke all on function public.expire_developer_uploads_v1(integer) from public,anon,authenticated;
grant execute on function public.expire_developer_uploads_v1(integer) to service_role;
