create table if not exists public.writing_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  content text not null default '' check (char_length(content) <= 500000),
  content_format text not null default 'markdown' check (content_format in ('markdown','plain_text')),
  version integer not null default 1 check (version > 0),
  metadata jsonb not null default '{}'::jsonb check (pg_column_size(metadata) <= 16384),
  archived_at timestamptz,
  last_opened_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.writing_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.writing_documents(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  version integer not null check (version > 0),
  title text not null check (char_length(title) between 1 and 200),
  content text not null check (char_length(content) <= 500000),
  word_count integer not null default 0 check (word_count >= 0),
  source text not null check (source in ('create','autosave','manual','restore','clear','duplicate','import')),
  created_at timestamptz not null default now(),
  unique(document_id, version)
);
create index if not exists writing_documents_owner_updated_idx on public.writing_documents(owner_id, updated_at desc);
create index if not exists writing_documents_owner_archived_idx on public.writing_documents(owner_id, archived_at, updated_at desc);
create index if not exists writing_versions_document_latest_idx on public.writing_document_versions(document_id, version desc);
alter table public.writing_documents enable row level security;
alter table public.writing_document_versions enable row level security;
create policy "Owners manage writing documents" on public.writing_documents for all to authenticated using(auth.uid()=owner_id) with check(auth.uid()=owner_id);
create policy "Owners read writing versions" on public.writing_document_versions for select to authenticated using(auth.uid()=owner_id and exists(select 1 from public.writing_documents d where d.id=document_id and d.owner_id=auth.uid()));
create policy "Owners insert writing versions" on public.writing_document_versions for insert to authenticated with check(auth.uid()=owner_id and exists(select 1 from public.writing_documents d where d.id=document_id and d.owner_id=auth.uid()));
create policy "Owners delete writing versions" on public.writing_document_versions for delete to authenticated using(auth.uid()=owner_id and exists(select 1 from public.writing_documents d where d.id=document_id and d.owner_id=auth.uid()));
revoke all on public.writing_documents, public.writing_document_versions from anon;
grant select,insert,update,delete on public.writing_documents, public.writing_document_versions to authenticated;

create or replace function public.save_writing_document(p_id uuid,p_title text,p_content text,p_expected_version integer,p_source text)
returns public.writing_documents language plpgsql security invoker set search_path=public as $$
declare d public.writing_documents; next_version integer;
begin
  if auth.uid() is null then raise exception 'unauthorized' using errcode='42501'; end if;
  if char_length(trim(p_title)) not between 1 and 200 or char_length(p_content)>500000 then raise exception 'invalid_document'; end if;
  if p_source not in ('autosave','manual','restore','clear','import') then raise exception 'invalid_source'; end if;
  update writing_documents set title=trim(p_title),content=p_content,version=version+1,updated_at=now(),last_opened_at=now()
    where id=p_id and owner_id=auth.uid() and version=p_expected_version returning * into d;
  if not found then
    if exists(select 1 from writing_documents where id=p_id and owner_id=auth.uid()) then raise exception 'version_conflict' using errcode='40001'; end if;
    raise exception 'document_not_found' using errcode='P0002';
  end if;
  insert into writing_document_versions(document_id,owner_id,version,title,content,word_count,source)
    values(d.id,auth.uid(),d.version,d.title,d.content,array_length(regexp_split_to_array(trim(d.content),'\s+'),1),p_source);
  delete from writing_document_versions where document_id=d.id and id in
    (select id from writing_document_versions where document_id=d.id order by version desc offset 50);
  return d;
end $$;
grant execute on function public.save_writing_document(uuid,text,text,integer,text) to authenticated;
