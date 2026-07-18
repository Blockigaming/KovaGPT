
create extension if not exists vector;

create table if not exists public.project_file_chunks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  file_id uuid not null references public.project_files(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  embedding vector(1536) not null,
  created_at timestamptz not null default now()
);

create index if not exists project_file_chunks_project_idx
  on public.project_file_chunks(project_id);
create index if not exists project_file_chunks_file_idx
  on public.project_file_chunks(file_id);
create index if not exists project_file_chunks_embedding_idx
  on public.project_file_chunks using hnsw (embedding vector_cosine_ops);

grant select on public.project_file_chunks to authenticated;
grant all on public.project_file_chunks to service_role;

alter table public.project_file_chunks enable row level security;

drop policy if exists "Members can read project chunks" on public.project_file_chunks;
create policy "Members can read project chunks"
  on public.project_file_chunks for select
  to authenticated
  using (public.is_project_member(project_id, auth.uid()));

create or replace function public.match_project_chunks (
  _project_id uuid,
  query_embedding vector(1536),
  match_count int default 6
) returns table (
  id uuid,
  file_id uuid,
  content text,
  similarity float
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.file_id, c.content,
         1 - (c.embedding <=> query_embedding) as similarity
  from public.project_file_chunks c
  where c.project_id = _project_id
    and public.is_project_member(_project_id, auth.uid())
  order by c.embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
$$;

grant execute on function public.match_project_chunks(uuid, vector, int) to authenticated;
