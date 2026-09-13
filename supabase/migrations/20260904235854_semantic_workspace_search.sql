-- Search reads source rows under CURRENT caller RLS. No source text is copied
-- into the durable index or queue. Provider activation is a separate owner gate.
create view public.workspace_search_sources with (security_invoker=true) as
select d.*, md5(d.title || E'\n' || d.body) as source_digest from (
  select 'projects'::text source_table, id source_id, owner_id, id project_id,
    'project'::text kind, left(name,200) title, left(coalesce(description,''),4000) body,
    '/projects/'||id::text href, updated_at from public.projects
  union all
  select 'project_chats', c.id, p.owner_id, c.project_id, 'project_chat', left(c.title,200),
    ''::text, '/projects/'||c.project_id::text||'/chat/'||c.id::text, c.updated_at
    from public.project_chats c join public.projects p on p.id=c.project_id
  union all
  select 'project_files', f.id, p.owner_id, f.project_id, 'file', left(f.name,200),
    left(coalesce(f.mime_type,''),4000), '/projects/'||f.project_id::text, f.created_at
    from public.project_files f join public.projects p on p.id=f.project_id where f.status='ready'
  union all
  select 'project_memory', m.id, p.owner_id, m.project_id, 'memory', left(m.content,80),
    left(m.content,4000), '/memory', m.created_at
    from public.project_memory m join public.projects p on p.id=m.project_id
  union all
  select 'user_library_items', id, user_id, null::uuid,
    case when item_type='image' then 'image' when item_type in ('document','code','website_draft','chat_artifact') then 'artifact' else 'file' end,
    left(title,200), left(coalesce(content_text,''),4000), '/library', updated_at
    from public.user_library_items
  union all
  select 'context_packs', id, user_id, null::uuid, 'context_pack', left(name,200),
    left(description,4000), '/context-packs', updated_at from public.context_packs
  union all
  select 'deep_research_runs', id, user_id, project_id, 'research', left(query,200),
    left(coalesce(report,query),4000), '/research-planner', updated_at from public.deep_research_runs
  union all
  select 'scheduled_tasks', id, user_id, null::uuid, 'automation', left(title,200),
    left(prompt,4000), '/scheduled-tasks', updated_at from public.scheduled_tasks
  union all
  select 'prompt_templates', id, user_id, project_id, 'prompt', left(name,200),
    left(body,4000), '/prompt-studio', updated_at from public.prompt_templates
  union all
  select 'goals', id, owner_id, project_id, 'goal', left(title,200),
    left(description,4000), '/goals', updated_at from public.goals
) d;
revoke all on public.workspace_search_sources from public,anon;
grant select on public.workspace_search_sources to authenticated,service_role;

-- A bounded exact cosine index avoids changing the existing vector extension
-- schema. Arrays use the same 1536-dimension embedding contract as Project RAG.
create table public.workspace_search_index (
  id uuid primary key default gen_random_uuid(),
  source_table text not null,
  source_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_digest text not null,
  revision bigint not null default 1,
  state text not null default 'pending' check(state in ('pending','processing','ready','failed')),
  embedding real[] check(embedding is null or (array_ndims(embedding) is not distinct from 1 and array_length(embedding,1) is not distinct from 1536)),
  embedding_model text,
  attempts integer not null default 0 check(attempts between 0 and 3),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  unique(source_table,source_id)
);
create index workspace_search_owner_idx on public.workspace_search_index(owner_id);
create index workspace_search_due_idx on public.workspace_search_index(next_attempt_at,id) where state in ('pending','processing');
alter table public.workspace_search_index enable row level security;
revoke all on public.workspace_search_index from public,anon,authenticated;
grant select on public.workspace_search_index to authenticated;
grant all on public.workspace_search_index to service_role;
create policy workspace_search_current_access on public.workspace_search_index for select to authenticated
using(exists(select 1 from public.workspace_search_sources s where s.source_table=workspace_search_index.source_table
  and s.source_id=workspace_search_index.source_id and s.source_digest=workspace_search_index.source_digest));

create function kova_private.invalidate_workspace_search() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare live_digest text; live_owner uuid;
begin
  if tg_op='DELETE' then
    delete from public.workspace_search_index where source_table=tg_table_name and source_id=old.id;
    return old;
  end if;
  select s.source_digest,s.owner_id into live_digest,live_owner from public.workspace_search_sources s
    where s.source_table=tg_table_name and s.source_id=new.id;
  if live_digest is null then
    delete from public.workspace_search_index where source_table=tg_table_name and source_id=new.id;
  else
    update public.workspace_search_index set source_digest=live_digest,owner_id=live_owner,
      revision=revision+1,state='pending',embedding=null,embedding_model=null,attempts=0,
      lease_token=null,lease_until=null,next_attempt_at=now()
    where source_table=tg_table_name and source_id=new.id
      and (source_digest is distinct from live_digest or owner_id is distinct from live_owner);
  end if;
  return new;
end $$;

create function kova_private.fence_workspace_search_account() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  delete from public.workspace_search_index where owner_id=new.user_id;
  return new;
end $$;
revoke all on function kova_private.fence_workspace_search_account() from public,anon,authenticated;
create trigger workspace_search_account_fence after insert on public.account_deletion_fences
for each row execute function kova_private.fence_workspace_search_account();
revoke all on function kova_private.invalidate_workspace_search() from public,anon,authenticated;
do $$ declare source_name text; begin
  foreach source_name in array array['projects','project_chats','project_files','project_memory','user_library_items',
    'context_packs','deep_research_runs','scheduled_tasks','prompt_templates','goals'] loop
    execute format('create trigger workspace_search_invalidation after update or delete on public.%I for each row execute function kova_private.invalidate_workspace_search()',source_name);
  end loop;
end $$;

create function public.claim_workspace_search_jobs(p_model text)
returns table(id uuid,revision bigint,lease_token uuid,input_text text)
language plpgsql security invoker set search_path=pg_catalog,public set statement_timeout='5s' as $$
begin
  if p_model is null or length(p_model) not between 1 and 120 then raise exception 'invalid_embedding_model'; end if;
  -- One bounded global claim at a time, including owner admission limits.
  perform pg_advisory_xact_lock(932140927);
  -- Derivatives are discarded immediately during account deletion. A canceled
  -- deletion permits fresh indexing, but cannot restore an old lease.
  delete from public.workspace_search_index i using public.account_deletion_fences f where i.owner_id=f.user_id;
  insert into public.workspace_search_index(source_table,source_id,owner_id,source_digest)
    select s.source_table,s.source_id,s.owner_id,s.source_digest from public.workspace_search_sources s
    where not exists(select 1 from public.workspace_search_index i where i.source_table=s.source_table and i.source_id=s.source_id)
      and kova_private.auth_user_exists(s.owner_id)
      and not exists(select 1 from public.account_deletion_fences f where f.user_id=s.owner_id)
      and (select count(*) from public.workspace_search_index i where i.owner_id=s.owner_id)<1950
    order by s.updated_at desc,s.source_table,s.source_id limit 50 on conflict do nothing;
  update public.workspace_search_index set state='failed',lease_token=null,lease_until=null
    where state='processing' and lease_until<=now() and attempts>=3;
  update public.workspace_search_index set state='pending',embedding=null,embedding_model=null,attempts=0,revision=workspace_search_index.revision+1,next_attempt_at=now()
    where workspace_search_index.id in (select i.id from public.workspace_search_index i
      where i.state='ready' and i.embedding_model is distinct from p_model order by i.id limit 4);
  return query with candidates as (
    select i.id,s.title||E'\n'||s.body input_text from public.workspace_search_index i
    join public.workspace_search_sources s on s.source_table=i.source_table and s.source_id=i.source_id and s.source_digest=i.source_digest
    where i.attempts<3 and i.next_attempt_at<=now()
      and (i.state='pending' or (i.state='processing' and i.lease_until<=now()))
    order by i.next_attempt_at,i.id for update of i skip locked limit 4
  ), claimed as (
    update public.workspace_search_index i set state='processing',attempts=i.attempts+1,
      lease_token=gen_random_uuid(),lease_until=now()+interval '120 seconds',embedding_model=p_model
    from candidates c where i.id=c.id returning i.id,i.revision,i.lease_token
  ) select c.id,c.revision,c.lease_token,j.input_text from claimed c join candidates j on j.id=c.id;
end $$;

create function public.settle_workspace_search_job(p_id uuid,p_revision bigint,p_lease uuid,p_model text,p_embedding real[])
returns boolean language plpgsql security invoker set search_path=pg_catalog,public set statement_timeout='5s' as $$
declare job public.workspace_search_index%rowtype;
begin
  select * into job from public.workspace_search_index where id=p_id for update;
  if job.id is null or job.revision is distinct from p_revision or job.lease_token is distinct from p_lease
    or job.state<>'processing' or job.lease_until<=now() or job.embedding_model is distinct from p_model then return false; end if;
  if exists(select 1 from public.account_deletion_fences f where f.user_id=job.owner_id)
    or not exists(select 1 from public.workspace_search_sources s where s.source_table=job.source_table
      and s.source_id=job.source_id and s.source_digest=job.source_digest and s.owner_id=job.owner_id) then
    delete from public.workspace_search_index where id=p_id; return false;
  end if;
  if p_embedding is not null and (array_ndims(p_embedding) is distinct from 1 or array_length(p_embedding,1) is distinct from 1536
    or exists(select 1 from unnest(p_embedding) v where v is null or v::text in ('NaN','Infinity','-Infinity'))
    or (select sum(v::double precision*v::double precision) from unnest(p_embedding) v)=0) then raise exception 'invalid_workspace_embedding'; end if;
  update public.workspace_search_index set state=case when p_embedding is not null then 'ready' when attempts>=3 then 'failed' else 'pending' end,
    embedding=p_embedding,lease_token=null,lease_until=null,next_attempt_at=now()+interval '1 minute'*attempts
    where id=p_id;
  return true;
end $$;

create function public.search_workspace_sources(p_query text,p_embedding real[] default null,p_model text default null)
returns table(source_table text,source_id uuid,kind text,title text,snippet text,href text,project_id uuid,updated_at timestamptz,score double precision,semantic boolean)
language plpgsql security invoker set search_path=pg_catalog,public set statement_timeout='5s' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_query is null or length(btrim(p_query)) not between 2 and 500 then raise exception 'invalid_search_query'; end if;
  if p_embedding is not null and (array_ndims(p_embedding) is distinct from 1 or array_length(p_embedding,1) is distinct from 1536
    or exists(select 1 from unnest(p_embedding) v where v is null or v::text in ('NaN','Infinity','-Infinity'))
    or (select sum(v::double precision*v::double precision) from unnest(p_embedding) v)=0) then raise exception 'invalid_workspace_embedding'; end if;
  return query with current_sources as materialized (
    select s.* from public.workspace_search_sources s order by s.updated_at desc,s.source_table,s.source_id limit 2000
  ), ranked as (
    select s.*, case when p_embedding is not null and i.embedding is not null then
      (select sum(a::double precision*b::double precision)/nullif(sqrt(sum(a::double precision*a::double precision)*sum(b::double precision*b::double precision)),0)
        from unnest(i.embedding,p_embedding) v(a,b)) else null end similarity,
      ts_rank_cd(to_tsvector('simple',s.title||' '||s.body),plainto_tsquery('simple',p_query))::double precision lexical
    from current_sources s left join public.workspace_search_index i
      on i.source_table=s.source_table and i.source_id=s.source_id and i.source_digest=s.source_digest
        and i.state='ready' and i.embedding_model=p_model
  ) select r.source_table,r.source_id,r.kind,r.title,left(r.body,240),r.href,r.project_id,r.updated_at,
    coalesce(r.similarity,0)+least(r.lexical,1),r.similarity is not null
    from ranked r where r.lexical>0 or r.similarity>=0.25
    order by coalesce(r.similarity,0)+least(r.lexical,1) desc,r.updated_at desc,r.source_table,r.source_id limit 30;
end $$;
revoke all on function public.claim_workspace_search_jobs(text) from public,anon,authenticated;
revoke all on function public.settle_workspace_search_job(uuid,bigint,uuid,text,real[]) from public,anon,authenticated;
revoke all on function public.search_workspace_sources(text,real[],text) from public,anon;
grant execute on function public.claim_workspace_search_jobs(text) to service_role;
grant execute on function public.settle_workspace_search_job(uuid,bigint,uuid,text,real[]) to service_role;
grant execute on function public.search_workspace_sources(text,real[],text) to authenticated;
