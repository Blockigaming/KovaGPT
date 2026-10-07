-- Canonical staging prerequisite repair for oztdrjtdglkizlewnulh only.
-- Requires explicit staging repair authorization. Never run against production.
-- Exact fence DDL/security trigger from the pinned migrations below; no user data reset.
-- Caller must verify the authenticated project binding before setting this guard.
begin;
do $guard$ begin
  if current_setting('s6.staging_project_ref',true) is distinct from 'oztdrjtdglkizlewnulh' then
    raise exception 's6_staging_project_binding_required';
  end if;
  if to_regclass('public.account_deletion_fences') is not null then
    raise exception 's6_fence_already_present_inspect_instead';
  end if;
end $guard$;
-- Coordinate account deletion with asynchronous account exports. The fence is
-- service-only and survives cleanup retries until the auth user is deleted.

create table if not exists public.account_deletion_fences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.account_deletion_fences enable row level security;

revoke all on table public.account_deletion_fences from public, anon, authenticated;
grant all on table public.account_deletion_fences to service_role;

-- Canonical dependency: 20260904233022_durable_chat_context_summaries.sql
create table public.chat_memory_write_epochs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  epoch bigint not null default 1 check (epoch > 0)
);
alter table public.chat_memory_write_epochs enable row level security;
revoke all on public.chat_memory_write_epochs from public,anon,authenticated;
grant all on public.chat_memory_write_epochs to service_role;

-- Canonical dependency: 20260904233022_durable_chat_context_summaries.sql
create table public.chat_context_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id uuid not null,
  requested_revision bigint not null default 1 check (requested_revision > 0),
  requested_digest text not null check (requested_digest ~ '^[a-f0-9]{64}$'),
  requested_start integer not null check (requested_start between 0 and 1000000),
  requested_count integer not null check (requested_count between 4 and 1000000),
  input_messages jsonb not null default '[]'::jsonb check (jsonb_typeof(input_messages) = 'array' and octet_length(input_messages::text) <= 524288),
  input_previous_summary text check (char_length(input_previous_summary) <= 3000),
  status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  next_attempt_at timestamptz not null default now(),
  input_expires_at timestamptz not null default now() + interval '24 hours',
  lease_token uuid,
  lease_expires_at timestamptz,
  completed_summary text check (char_length(completed_summary) <= 3000),
  completed_digest text,
  completed_start integer,
  completed_count integer,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(user_id, chat_id)
);
create index chat_context_summary_due_idx on public.chat_context_summaries(next_attempt_at) where status in ('pending','processing');
alter table public.chat_context_summaries enable row level security;
revoke all on public.chat_context_summaries from public, anon, authenticated;
grant select on public.chat_context_summaries to authenticated;
grant all on public.chat_context_summaries to service_role;
create policy chat_context_summary_owner_read on public.chat_context_summaries for select to authenticated using (user_id = auth.uid());

create or replace function public.delete_chat_memory(p_user_id uuid,p_chat_id text default null)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_user_id is null or (p_chat_id is not null and (length(p_chat_id)=0 or length(p_chat_id)>100)) then raise exception 'invalid_memory_principal'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 20260903204500));
  insert into public.chat_memory_write_epochs(user_id,epoch) values(p_user_id,2)
    on conflict(user_id) do update set epoch=public.chat_memory_write_epochs.epoch+1;
  delete from public.chat_context_summaries where user_id=p_user_id and (p_chat_id is null or chat_id::text=lower(p_chat_id));
  delete from public.chat_memories where user_id=p_user_id and (p_chat_id is null or chat_id=p_chat_id);
  return true;
end $$;
revoke all on function public.delete_chat_memory(uuid,text) from public,anon,authenticated;
grant execute on function public.delete_chat_memory(uuid,text) to service_role;

-- Canonical dependency: 20260904233022_durable_chat_context_summaries.sql
create or replace function kova_private.clear_chat_memory_on_account_deletion()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform public.delete_chat_memory(new.user_id,null);
  return new;
end $$;
revoke all on function kova_private.clear_chat_memory_on_account_deletion() from public,anon,authenticated;
grant execute on function kova_private.clear_chat_memory_on_account_deletion() to service_role;
create trigger clear_chat_memory_on_account_deletion after insert or update on public.account_deletion_fences
  for each row execute function kova_private.clear_chat_memory_on_account_deletion();

-- Canonical dependency: 20260905002122_trusted_contact_lifecycle.sql
create table public.trusted_contacts (
  id uuid primary key,
  inviter_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  inviter_email text not null,
  recipient_email text not null,
  purpose text not null default 'manual_check_in' check(purpose='manual_check_in'),
  policy_version text not null check(policy_version='trusted-contact-consent-v1'),
  inviter_consented_at timestamptz not null default now(),
  recipient_consented_at timestamptz,
  state text not null default 'pending' check(state in ('pending','accepted','declined','revoked')),
  revision bigint not null default 1,
  expires_at timestamptz not null default now()+interval '7 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  token_digest text check(token_digest is null or token_digest ~ '^[a-f0-9]{64}$'),
  token_expires_at timestamptz,
  last_command_id uuid,
  last_actor_id uuid,
  last_action text,
  last_fingerprint text,
  check(inviter_id<>recipient_id)
);
create index trusted_contacts_inviter_idx on public.trusted_contacts(inviter_id,created_at desc);
create index trusted_contacts_recipient_idx on public.trusted_contacts(recipient_id,created_at desc);
alter table public.trusted_contacts enable row level security;
revoke all on public.trusted_contacts from public,anon,authenticated;
grant all on public.trusted_contacts to service_role;
grant select(id,inviter_id,recipient_id,inviter_email,recipient_email,purpose,policy_version,inviter_consented_at,
  recipient_consented_at,state,revision,expires_at,created_at,updated_at) on public.trusted_contacts to authenticated;
create policy trusted_contacts_parties on public.trusted_contacts for select to authenticated
using(auth.uid()=inviter_id or auth.uid()=recipient_id);

-- Canonical dependency: 20260905002122_trusted_contact_lifecycle.sql
create function kova_private.fence_trusted_contacts() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  update public.trusted_contacts set state='revoked',revision=revision+1,token_digest=null,token_expires_at=null,updated_at=now(),
    last_command_id=null,last_actor_id=null,last_action=null,last_fingerprint=null where inviter_id=new.user_id or recipient_id=new.user_id;
  return new;
end $$;
revoke all on function kova_private.fence_trusted_contacts() from public,anon,authenticated;
grant execute on function kova_private.fence_trusted_contacts() to service_role;
create trigger trusted_contacts_account_fence after insert or update on public.account_deletion_fences for each row execute function kova_private.fence_trusted_contacts();

-- Canonical dependency: 20260905013000_developer_prepaid_funding.sql
create table public.developer_credit_offers (
  id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 80),
  environment text not null check(environment in ('sandbox','live')),
  stripe_price_id text not null check(stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  subtotal_amount bigint not null check(subtotal_amount between 1 and 100000000),
  credits_amount bigint not null check(credits_amount>0 and credits_amount<=subtotal_amount),
  refund_reserve bigint not null check(refund_reserve>=0 and refund_reserve<=subtotal_amount),
  dispute_reserve bigint not null check(dispute_reserve>=0 and dispute_reserve<=subtotal_amount),
  maximum_processor_fee bigint not null check(maximum_processor_fee>=0 and maximum_processor_fee<=subtotal_amount),
  tax_mode text not null check(tax_mode in ('automatic','reviewed_exempt')),
  tax_review_reference text not null check(length(tax_review_reference) between 1 and 500),
  approved_by uuid references auth.users(id) on delete set null, approved_at timestamptz not null,
  expires_at timestamptz not null, active boolean not null default false, created_at timestamptz not null default now(),
  check(expires_at>approved_at)
);
create function public.guard_developer_credit_offer() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' or (to_jsonb(new)-'active'-'approved_by') is distinct from (to_jsonb(old)-'active'-'approved_by')
    or (new.approved_by is distinct from old.approved_by and new.approved_by is not null) then
    raise exception 'developer_offer_immutable';
  end if;
  if new.active and not old.active then raise exception 'developer_offer_reactivation_forbidden';end if;
  return new;
end $$;
create trigger developer_credit_offer_immutable before update or delete on public.developer_credit_offers for each row execute function public.guard_developer_credit_offer();

-- Canonical dependency: 20260905013000_developer_prepaid_funding.sql
create table public.developer_funding_attempts (
  id uuid primary key default gen_random_uuid(), account_id uuid not null references public.developer_credit_accounts(id),
  owner_id uuid references auth.users(id) on delete set null, request_key text not null check(length(request_key) between 1 and 128),
  offer_id uuid not null references public.developer_credit_offers(id), offer_snapshot jsonb not null,
  state text not null default 'creating' check(state in ('creating','open','paid','expired','reconciliation_required')),
  checkout_session_id text unique, checkout_url text, checkout_expires_at timestamptz not null default now()+interval '1 hour',
  checkout_create_started_at timestamptz,checkout_create_parameters jsonb,
  checkout_discovery_cursor text,checkout_discovery_found_id text,
  revision bigint not null default 1, checked_revision bigint not null default 0,
  lease_token uuid,lease_expires_at timestamptz,lease_revision bigint,last_checked_at timestamptz,
  retry_after timestamptz,
  last_error_code text check(last_error_code ~ '^[a-z_]{3,80}$'),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(account_id,request_key)
);
create index developer_funding_pending_idx on public.developer_funding_attempts(last_checked_at nulls first,id);
create index developer_funding_account_history_idx on public.developer_funding_attempts(account_id,created_at desc,id);

-- Canonical dependency: 20260905013000_developer_prepaid_funding.sql
create function public.guard_developer_funding_account_deletion() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,20260903204500));
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  if exists(select 1 from public.developer_funding_attempts where owner_id=new.user_id and state in ('creating','open','reconciliation_required')) then
    raise exception 'developer_payment_reconciliation_pending';
  end if;
  return new;
end $$;
create trigger developer_funding_deletion_barrier before insert or update on public.account_deletion_fences for each row execute function public.guard_developer_funding_account_deletion();

-- Canonical dependency: 20260915011500_retire_deep_research_workspace_search.sql
create or replace view public.workspace_search_sources with (security_invoker=true) as
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
  select 'scheduled_tasks', id, user_id, null::uuid, 'automation', left(title,200),
    left(prompt,4000), '/scheduled-tasks', updated_at from public.scheduled_tasks
  union all
  select 'prompt_templates', id, user_id, project_id, 'prompt', left(name,200),
    left(body,4000), '/prompt-studio', updated_at from public.prompt_templates
  union all
  select 'goals', id, owner_id, project_id, 'goal', left(title,200),
    left(description,4000), '/goals', updated_at from public.goals
) d;

revoke all on public.workspace_search_sources from public, anon;
grant select on public.workspace_search_sources to authenticated, service_role;

-- Canonical dependency: 20260904235854_semantic_workspace_search.sql
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

-- Canonical dependency: 20260904235854_semantic_workspace_search.sql
create function kova_private.fence_workspace_search_account() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  delete from public.workspace_search_index where owner_id=new.user_id;
  return new;
end $$;
revoke all on function kova_private.fence_workspace_search_account() from public,anon,authenticated;
create trigger workspace_search_account_fence after insert on public.account_deletion_fences
for each row execute function kova_private.fence_workspace_search_account();

-- Exact service-only privileges from 20260905013000_developer_prepaid_funding.sql,
-- restricted to the two dependency tables/functions restored here (no funding activation).
alter table public.developer_credit_offers enable row level security;
alter table public.developer_funding_attempts enable row level security;
revoke all on public.developer_credit_offers,public.developer_funding_attempts from public,anon,authenticated;
grant all on public.developer_credit_offers,public.developer_funding_attempts to service_role;
revoke all on function public.guard_developer_funding_account_deletion(),public.guard_developer_credit_offer() from public,anon,authenticated;
grant execute on function public.guard_developer_funding_account_deletion(),public.guard_developer_credit_offer() to service_role;

-- Canonical: 20260905030947_irreversible_account_deletion.sql
-- Fence insertion removes memory/search data through the canonical triggers above.
-- Treat every existing/new fence as irreversible; only final Auth deletion clears it.
alter table public.account_deletion_fences
  add column started_at timestamptz not null default now();

create function kova_private.preserve_started_account_deletion()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(old.user_id::text,20260903204500));
  if tg_op='UPDATE' then
    if new.user_id is distinct from old.user_id or new.started_at is distinct from old.started_at
      or new.requested_at is distinct from old.requested_at then
      raise exception 'account_deletion_irreversible' using errcode='42501';
    end if;
    return new;
  end if;
  -- The Auth FK cascade runs after its parent row has disappeared. No service
  -- operation may clear the fence while that identity still exists.
  if exists(select 1 from auth.users where id=old.user_id) then
    raise exception 'account_deletion_irreversible' using errcode='42501';
  end if;
  return old;
end $$;
revoke all on function kova_private.preserve_started_account_deletion() from public,anon,authenticated;
create trigger preserve_started_account_deletion before update or delete on public.account_deletion_fences
  for each row execute function kova_private.preserve_started_account_deletion();
revoke delete,truncate on public.account_deletion_fences from service_role;

commit;
