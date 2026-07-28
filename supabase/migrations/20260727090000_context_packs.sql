-- Reusable, owner-scoped context collections. Items are snapshots selected by the owner;
-- no cross-user resource is dereferenced by this table.
create table if not exists public.context_packs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 500),
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists context_packs_user_updated_idx on public.context_packs(user_id, updated_at desc);
alter table public.context_packs enable row level security;
create policy "context_packs_select_own" on public.context_packs for select to authenticated using (auth.uid() = user_id);
create policy "context_packs_insert_own" on public.context_packs for insert to authenticated with check (auth.uid() = user_id);
create policy "context_packs_update_own" on public.context_packs for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "context_packs_delete_own" on public.context_packs for delete to authenticated using (auth.uid() = user_id);
