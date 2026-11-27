-- Staged source. Materialize and replay before enabling the developer vector store gate.
-- Explicit caller-provided embeddings; no automatic upstream calls or invented prices.
create table public.developer_vector_stores_v1 (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.developer_projects(id) on delete cascade,
  name text not null check(length(name) between 1 and 80),
  model text not null check(length(model) between 2 and 80 and model ~ '^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$'),
  dimensions integer not null check(dimensions between 1 and 1536),
  request_digest text not null check(request_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '30 days',
  unique(owner_id,project_id,request_digest),
  check(expires_at>created_at)
);
create table public.developer_vector_entries_v1 (
  store_id uuid not null references public.developer_vector_stores_v1(id) on delete cascade,
  entry_id text not null check(entry_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  file_id uuid references public.developer_files(id) on delete cascade,
  content text not null check(octet_length(content) between 1 and 2048),
  embedding double precision[] not null check(cardinality(embedding) between 1 and 1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(store_id,entry_id)
);
create index developer_vector_stores_owner_v1_idx on public.developer_vector_stores_v1(owner_id,project_id);
create index developer_vector_stores_expiry_v1_idx on public.developer_vector_stores_v1(expires_at,id);
create index developer_vector_entries_file_v1_idx on public.developer_vector_entries_v1(file_id);
alter table public.developer_vector_stores_v1 enable row level security;
alter table public.developer_vector_entries_v1 enable row level security;
revoke all on public.developer_vector_stores_v1,public.developer_vector_entries_v1 from public,anon,authenticated;
grant select,insert,delete on public.developer_vector_stores_v1 to service_role;
grant select,insert,update,delete on public.developer_vector_entries_v1 to service_role;

create function public.developer_normalize_vector_v1(p_vector jsonb,p_dimensions integer)
returns double precision[] language plpgsql immutable security invoker set search_path='' as $$
declare raw double precision[]; norm double precision;
begin
  if p_dimensions is null or p_dimensions not between 1 and 1536
    or jsonb_typeof(p_vector) is distinct from 'array'
  then raise exception 'developer_vector_invalid'; end if;
  if jsonb_array_length(p_vector)<>p_dimensions
    or exists(select 1 from jsonb_array_elements(p_vector) v where jsonb_typeof(v)<>'number')
  then raise exception 'developer_vector_invalid'; end if;
  if exists(select 1 from jsonb_array_elements_text(p_vector) v
      where abs(v::numeric)>1000000 or (v::numeric<>0 and abs(v::numeric)<0.000000000001))
    or not exists(select 1 from jsonb_array_elements_text(p_vector) v where abs(v::numeric)>=0.000000001)
  then raise exception 'developer_vector_invalid'; end if;
  select array_agg(v::double precision order by n) into raw
    from jsonb_array_elements_text(p_vector) with ordinality as t(v,n);
  select sqrt(sum(v*v)) into norm from unnest(raw) as t(v);
  if norm is null or norm<=0 then raise exception 'developer_vector_invalid'; end if;
  return array(select v/norm from unnest(raw) with ordinality as t(v,n) order by n);
end $$;
revoke all on function public.developer_normalize_vector_v1(jsonb,integer) from public,anon,authenticated;
grant execute on function public.developer_normalize_vector_v1(jsonb,integer) to service_role;

create function public.manage_developer_vector_stores_v1(
  p_owner uuid,p_key uuid,p_project uuid,p_operation text,p_input jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  s public.developer_vector_stores_v1%rowtype;
  e public.developer_vector_entries_v1%rowtype;
  q double precision[];
  result jsonb;
  page integer;
  max_results integer;
  requested_file uuid;
  old_bytes integer;
  owner_entries bigint;
  owner_dimensions bigint;
  owner_bytes bigint;
  store_entries bigint;
  batch_entry jsonb;
  batch_result jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
  if p_owner is null or not kova_private.auth_user_exists(p_owner)
    or exists(select 1 from public.account_deletion_fences where user_id=p_owner)
    or exists(select 1 from public.banned_users where user_id=p_owner)
    or exists(select 1 from public.user_preferences where user_id=p_owner and coalesce((settings->>'lockdown_mode')::boolean,false))
  then raise exception 'developer_owner_unavailable' using errcode='42501'; end if;
  if p_key is null or p_project is null or not exists(
    select 1 from public.developer_billing_keys k
    join public.developer_account_owners a on a.account_id=k.account_id
    join public.developer_projects p on p.id=k.project_id and p.account_id=k.account_id
    join public.developer_credit_accounts c on c.id=k.account_id
    where k.id=p_key and p.id=p_project and a.owner_id=p_owner
      and k.enabled and k.revoked_at is null and k.expires_at>now()
      and 'files'=any(k.capabilities) and 'embeddings'=any(k.capabilities)
      and c.suspended_at is null
  ) then raise exception 'developer_scope_required' using errcode='42501'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' or pg_column_size(p_input)>65536
  then raise exception 'developer_vector_invalid'; end if;

  delete from public.developer_vector_stores_v1 where owner_id=p_owner and expires_at<=now();
  delete from public.developer_vector_entries_v1 v
    using public.developer_vector_stores_v1 owned,public.developer_files linked
    where v.store_id=owned.id and owned.owner_id=p_owner
      and v.file_id=linked.id and linked.expires_at<=now();

  if p_operation='create' then
    if length(coalesce(btrim(p_input->>'name'),'')) not between 1 and 80
      or length(coalesce(p_input->>'model','')) not between 2 and 80
      or p_input->>'model' !~ '^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$'
      or jsonb_typeof(p_input->'dimensions') is distinct from 'number'
      or (p_input->>'dimensions')::numeric<>trunc((p_input->>'dimensions')::numeric)
      or (p_input->>'dimensions')::numeric not between 1 and 1536
      or coalesce(p_input->>'request_digest','') !~ '^[a-f0-9]{64}$'
    then raise exception 'developer_vector_invalid'; end if;
    select * into s from public.developer_vector_stores_v1
      where owner_id=p_owner and project_id=p_project and request_digest=p_input->>'request_digest';
    if found then
      if s.name<>btrim(p_input->>'name') or s.model<>p_input->>'model'
        or s.dimensions<>(p_input->>'dimensions')::integer
      then raise exception 'developer_vector_conflict'; end if;
    else
      if (select count(*) from public.developer_vector_stores_v1 where owner_id=p_owner)>=10
      then raise exception 'developer_vector_quota_exceeded'; end if;
      insert into public.developer_vector_stores_v1(owner_id,project_id,name,model,dimensions,request_digest)
      values(p_owner,p_project,btrim(p_input->>'name'),p_input->>'model',(p_input->>'dimensions')::integer,p_input->>'request_digest')
      returning * into s;
    end if;
    return jsonb_build_object('object','vector_store')||(to_jsonb(s)-'owner_id'-'request_digest');
  elsif p_operation='list' then
    select coalesce(jsonb_agg(to_jsonb(t)-'owner_id'-'request_digest' order by t.created_at desc,t.id),'[]'::jsonb)
      into result from public.developer_vector_stores_v1 t where t.owner_id=p_owner and t.project_id=p_project;
    return jsonb_build_object('object','list','data',result);
  end if;

  select * into s from public.developer_vector_stores_v1
    where id=(p_input->>'store_id')::uuid and owner_id=p_owner and project_id=p_project and expires_at>now();
  if not found then raise exception 'developer_vector_not_found'; end if;
  if p_operation='get' then
    return jsonb_build_object('object','vector_store')||(to_jsonb(s)-'owner_id'-'request_digest');
  elsif p_operation='delete' then
    delete from public.developer_vector_stores_v1 where id=s.id;
    return jsonb_build_object('id',s.id,'deleted',true);
  elsif p_operation='list_entries' then
    page:=coalesce((p_input->>'page')::integer,0);
    if page not between 0 and 19 then raise exception 'developer_vector_invalid'; end if;
    select coalesce(jsonb_agg(to_jsonb(t) order by t.entry_id),'[]'::jsonb) into result from
      (select entry_id,file_id,content,created_at,updated_at from public.developer_vector_entries_v1
        where store_id=s.id order by entry_id offset page*25 limit 26) t;
    return jsonb_build_object('object','list','data',case when jsonb_array_length(result)>25 then result-25 else result end,
      'page',page,'has_more',jsonb_array_length(result)>25);
  elsif p_operation='upsert_batch' then
    if p_input->>'model' is distinct from s.model or jsonb_typeof(p_input->'entries') is distinct from 'array'
    then raise exception 'developer_vector_invalid'; end if;
    if jsonb_array_length(p_input->'entries') not between 1 and 8
      or octet_length((p_input->'entries')::text)>60000
      or (select count(distinct v->>'entry_id') from jsonb_array_elements(p_input->'entries') v)<>jsonb_array_length(p_input->'entries')
    then raise exception 'developer_vector_invalid'; end if;
    result:='[]'::jsonb;
    for batch_entry in select value from jsonb_array_elements(p_input->'entries') loop
      if jsonb_typeof(batch_entry) is distinct from 'object' then raise exception 'developer_vector_invalid'; end if;
      if exists(select 1 from jsonb_object_keys(batch_entry) k where k not in ('entry_id','vector','text','file_id'))
      then raise exception 'developer_vector_invalid'; end if;
      -- Reuse all single-entry authorization, content, dimension and quota checks.
      -- Any exception aborts the enclosing statement, including earlier entries.
      batch_result:=public.manage_developer_vector_stores_v1(p_owner,p_key,p_project,'upsert',
        batch_entry||jsonb_build_object('store_id',s.id,'model',s.model));
      result:=result||jsonb_build_array(batch_result);
    end loop;
    return jsonb_build_object('object','list','data',result);
  elsif p_operation in ('get_entry','delete_entry','upsert') then
    if coalesce(p_input->>'entry_id','') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
    then raise exception 'developer_vector_invalid'; end if;
    select * into e from public.developer_vector_entries_v1
      where store_id=s.id and entry_id=p_input->>'entry_id';
    if p_operation='get_entry' then
      if not found then raise exception 'developer_vector_not_found'; end if;
      return jsonb_build_object('object','vector_entry')||to_jsonb(e);
    elsif p_operation='delete_entry' then
      if not found then raise exception 'developer_vector_not_found'; end if;
      delete from public.developer_vector_entries_v1 where store_id=s.id and entry_id=e.entry_id;
      return jsonb_build_object('entry_id',e.entry_id,'deleted',true);
    end if;
    old_bytes:=case when found then octet_length(e.content) else null end;
    if p_input->>'model' is distinct from s.model
      or jsonb_typeof(p_input->'text') is distinct from 'string'
      or octet_length(p_input->>'text') not between 1 and 2048
    then raise exception 'developer_vector_invalid'; end if;
    q:=public.developer_normalize_vector_v1(p_input->'vector',s.dimensions);
    requested_file:=(p_input->>'file_id')::uuid;
    if requested_file is not null and not exists(
      select 1 from public.developer_files f where f.id=requested_file and f.owner_id=p_owner
        and f.project_id=p_project and f.expires_at>now() and strpos(f.content,p_input->>'text')>0
    ) then raise exception 'developer_vector_not_found'; end if;
    select count(*) into store_entries from public.developer_vector_entries_v1 where store_id=s.id;
    select count(*),coalesce(sum(cardinality(v.embedding)),0),coalesce(sum(octet_length(v.content)),0)
      into owner_entries,owner_dimensions,owner_bytes from public.developer_vector_entries_v1 v
      join public.developer_vector_stores_v1 owned on owned.id=v.store_id where owned.owner_id=p_owner;
    if (old_bytes is null and (store_entries>=500 or owner_entries>=2000 or owner_dimensions+s.dimensions>1536000))
      or owner_bytes-coalesce(old_bytes,0)+octet_length(p_input->>'text')>4194304
    then raise exception 'developer_vector_quota_exceeded'; end if;
    insert into public.developer_vector_entries_v1(store_id,entry_id,file_id,content,embedding)
      values(s.id,p_input->>'entry_id',requested_file,p_input->>'text',q)
      on conflict(store_id,entry_id) do update set file_id=excluded.file_id,content=excluded.content,
        embedding=excluded.embedding,updated_at=clock_timestamp()
      returning * into e;
    return jsonb_build_object('object','vector_entry')||(to_jsonb(e)-'embedding');
  elsif p_operation='search' then
    if p_input->>'model' is distinct from s.model
      or jsonb_typeof(p_input->'limit') is distinct from 'number'
      or (p_input->>'limit')::numeric<>trunc((p_input->>'limit')::numeric)
      or (p_input->>'limit')::numeric not between 1 and 20
    then raise exception 'developer_vector_invalid'; end if;
    max_results:=(p_input->>'limit')::integer;
    q:=public.developer_normalize_vector_v1(p_input->'vector',s.dimensions);
    select coalesce(jsonb_agg(to_jsonb(r) order by r.score desc,r.entry_id),'[]'::jsonb) into result
      from (
        select v.entry_id,v.file_id,v.content,
          greatest(-1.0::float8,least(1.0::float8,
            (select sum(v.embedding[i]*q[i]) from generate_subscripts(q,1) as ix(i)))) as score
        from public.developer_vector_entries_v1 v where v.store_id=s.id
          and (v.file_id is null or exists(select 1 from public.developer_files f
            where f.id=v.file_id and f.owner_id=p_owner and f.project_id=p_project and f.expires_at>now()))
        order by score desc,v.entry_id limit max_results
      ) r;
    return jsonb_build_object('object','list','search_type','cosine','data',result);
  else raise exception 'developer_operation_invalid'; end if;
end $$;
revoke all on function public.manage_developer_vector_stores_v1(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.manage_developer_vector_stores_v1(uuid,uuid,uuid,text,jsonb) to service_role;

create function public.expire_developer_vector_stores_v1(p_limit integer default 100)
returns integer language plpgsql security invoker set search_path='' as $$
declare owner uuid; removed integer;
begin
  select owner_id into owner from public.developer_vector_stores_v1 where expires_at<=now() order by expires_at,id limit 1;
  if owner is null then return 0; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner::text,20260903204500));
  delete from public.developer_vector_stores_v1 where id in(
    select id from public.developer_vector_stores_v1 where owner_id=owner and expires_at<=now()
      order by expires_at,id limit least(greatest(p_limit,1),100));
  get diagnostics removed=row_count;
  return removed;
end $$;
revoke all on function public.expire_developer_vector_stores_v1(integer) from public,anon,authenticated;
grant execute on function public.expire_developer_vector_stores_v1(integer) to service_role;

create view public.developer_vector_export_records_v1 with(security_invoker=true) as
  select s.id as store_id,s.owner_id,s.project_id,s.name,s.model,s.dimensions,s.created_at,s.expires_at,
    e.entry_id,e.file_id,e.content,e.embedding,e.updated_at
  from public.developer_vector_stores_v1 s left join public.developer_vector_entries_v1 e on e.store_id=s.id;
revoke all on public.developer_vector_export_records_v1 from public,anon,authenticated;
grant select on public.developer_vector_export_records_v1 to service_role;
