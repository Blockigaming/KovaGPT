-- Production hardening already applied out-of-band, captured as source of truth.
-- Idempotent and non-destructive.

-- 1. No table-maintenance privileges for client roles.
do $$
declare r record;
begin
  for r in
    select format('public.%I', c.relname) as tbl
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p')
  loop
    execute format('revoke truncate, trigger, references on %s from anon, authenticated', r.tbl);
  end loop;
end
$$;

-- 2. Sequences: clients may draw values but never rewrite counters.
do $$
declare r record;
begin
  for r in
    select format('public.%I', c.relname) as seq
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'S'
  loop
    execute format('revoke update on sequence %s from anon, authenticated', r.seq);
  end loop;
end
$$;

-- 3. New objects are private by default; access must be granted explicitly.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;

-- 4. Server-only tables: no client grants, explicit deny policies.
do $$
declare t text;
begin
  foreach t in array array[
    'banned_users','ai_generation_events','pending_tool_actions',
    'plaid_items','processed_stripe_events'
  ] loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('revoke all on public.%I from anon, authenticated', t);
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists "%s_no_client_access" on public.%I', t, t);
      execute format(
        'create policy "%s_no_client_access" on public.%I as restrictive to anon, authenticated using (false) with check (false)',
        t, t
      );
    end if;
  end loop;
end
$$;

-- 5. Least-privilege grants on connector/token tables.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='google_oauth_tokens') then
    revoke all on public.google_oauth_tokens from anon, authenticated;
    grant delete on public.google_oauth_tokens to authenticated;
  end if;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='connected_account_audit_log') then
    revoke all on public.connected_account_audit_log from anon, authenticated;
    grant select on public.connected_account_audit_log to authenticated;
  end if;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='feature_flags') then
    revoke all on public.feature_flags from anon, authenticated;
  end if;
end
$$;