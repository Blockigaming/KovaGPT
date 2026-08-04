create table public.github_oauth_states(id uuid primary key default gen_random_uuid(),state_hash text not null unique,owner_id uuid not null references auth.users(id) on delete cascade,code_verifier_ciphertext text not null,redirect_uri text not null,expires_at timestamptz not null,used_at timestamptz,created_at timestamptz not null default now());
alter table public.github_oauth_states enable row level security;
-- OAuth states are service-only and intentionally have no browser policies.
create index github_oauth_states_expiry_idx on public.github_oauth_states(expires_at) where used_at is null;
