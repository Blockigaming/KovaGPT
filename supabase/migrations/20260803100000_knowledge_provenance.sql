create table if not exists public.knowledge_relationships (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check(source_type in('project','research','writing_document','agent_definition')),
  source_id uuid not null, target_type text not null check(target_type in('project','research','writing_document','agent_definition')),
  target_id uuid not null, relationship_type text not null check(char_length(relationship_type) between 1 and 80),
  confidence numeric(4,3) not null check(confidence between 0 and 1),
  derivation_method text not null check(derivation_method in('user-created','directly-extracted','imported','system-linked','model-suggested')),
  evidence_metadata jsonb not null default '{}' check(octet_length(evidence_metadata::text)<=2048),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), archived_at timestamptz,
  approved_at timestamptz, rejected_at timestamptz,
  check(source_type<>target_type or source_id<>target_id),
  check(not(approved_at is not null and rejected_at is not null)),
  unique(owner_id,source_type,source_id,target_type,target_id,relationship_type)
);
alter table public.knowledge_relationships enable row level security;
create policy "Owners manage knowledge relationships" on public.knowledge_relationships for all to authenticated using(auth.uid()=owner_id) with check(auth.uid()=owner_id);
revoke all on public.knowledge_relationships from anon;
grant select,insert,update,delete on public.knowledge_relationships to authenticated;
create index if not exists knowledge_relationships_owner_source_idx on public.knowledge_relationships(owner_id,source_type,source_id,updated_at desc);
create index if not exists knowledge_relationships_owner_target_idx on public.knowledge_relationships(owner_id,target_type,target_id,updated_at desc);
