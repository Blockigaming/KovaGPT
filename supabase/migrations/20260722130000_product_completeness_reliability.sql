-- Product-completeness and reliability checkpoint data model.
-- Stores only safe user-owned metadata; admin access is checked through app_admin_roles.

create table if not exists public.onboarding_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_step text not null default 'welcome' check (current_step in ('welcome','appearance','response_preferences','projects','library_files','search_research','temporary_chat','connected_apps','scheduled_tasks','complete')),
  completed_steps text[] not null default '{}',
  completed_at timestamptz,
  skipped_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('task_result','task_failure','connector_reauth','shared_chat','project_invitation','project_role_change','billing_issue','usage_threshold','deep_research_complete','file_processing','security_alert')),
  title text not null,
  safe_preview text not null,
  action_url text,
  source_entity text,
  delivery_state text not null default 'delivered' check (delivery_state in ('pending','delivered','failed','expired')),
  read_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  in_app_enabled boolean not null default true,
  account_email_enabled boolean not null default true,
  verified_email text,
  categories jsonb not null default '{"tasks":true,"projects":true,"connectors":true,"billing":true,"security":true}'::jsonb,
  time_zone text not null default 'UTC',
  updated_at timestamptz not null default now()
);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  category text not null check (category in ('account_access','billing','technical_issue','data_privacy','safety_concern','feature_request','connector_issue','scheduled_task_issue')),
  subject text not null,
  description text not null,
  include_diagnostics boolean not null default false,
  safe_diagnostics jsonb not null default '{}'::jsonb,
  correlation_id text not null,
  status text not null default 'submitted' check (status in ('submitted','failed','retry','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.feedback_submissions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  message_id text,
  rating text check (rating in ('up','down')),
  reason text check (reason in ('incorrect','harmful','citation_issue','tool_failure','ui_issue','feature_request','other')),
  comment text,
  attach_context boolean not null default false,
  context_excerpt text,
  duplicate_key text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, duplicate_key)
);

create table if not exists public.safety_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete set null,
  target_type text not null check (target_type in ('shared_chat','shared_artifact','project_invitation','generated_content','harassment_spam','impersonation','privacy_issue','unsafe_content','other')),
  target_id text not null,
  reason text not null,
  explanation text,
  status text not null default 'submitted' check (status in ('submitted','triaged','actioned','dismissed')),
  duplicate_key text not null,
  created_at timestamptz not null default now(),
  unique (reporter_id, duplicate_key)
);

create table if not exists public.app_admin_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  permissions text[] not null default '{}',
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  account_status text not null check (account_status in ('active','email_verification_required','restricted','temporarily_suspended','permanently_banned','deletion_pending','deleted')),
  safe_reason text not null,
  private_notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.system_notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  safe_body text not null,
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.onboarding_progress enable row level security;
alter table public.app_notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.support_tickets enable row level security;
alter table public.feedback_submissions enable row level security;
alter table public.safety_reports enable row level security;
alter table public.app_admin_roles enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.system_notices enable row level security;

create policy "Users manage their onboarding" on public.onboarding_progress for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users read their notifications" on public.app_notifications for select using (auth.uid() = owner_id);
create policy "Users update their notifications" on public.app_notifications for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "Users delete their notifications" on public.app_notifications for delete using (auth.uid() = owner_id);
create policy "Users manage notification preferences" on public.notification_preferences for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users create support tickets" on public.support_tickets for insert with check (auth.uid() = owner_id or owner_id is null);
create policy "Users read their support tickets" on public.support_tickets for select using (auth.uid() = owner_id);
create policy "Users create feedback" on public.feedback_submissions for insert with check (auth.uid() = owner_id or owner_id is null);
create policy "Users read their feedback" on public.feedback_submissions for select using (auth.uid() = owner_id);
create policy "Users create safety reports" on public.safety_reports for insert with check (auth.uid() = reporter_id or reporter_id is null);
create policy "Users read their safety reports" on public.safety_reports for select using (auth.uid() = reporter_id);
create policy "Users read own admin role" on public.app_admin_roles for select using (auth.uid() = user_id);
create policy "Admins read moderation actions" on public.moderation_actions for select using (exists (select 1 from public.app_admin_roles r where r.user_id = auth.uid() and 'abuse_reports' = any(r.permissions)));
create policy "Admins read system notices" on public.system_notices for select using (exists (select 1 from public.app_admin_roles r where r.user_id = auth.uid() and 'system_notices' = any(r.permissions)));

create index if not exists app_notifications_owner_created_idx on public.app_notifications(owner_id, created_at desc);
create index if not exists support_tickets_owner_created_idx on public.support_tickets(owner_id, created_at desc);
create index if not exists safety_reports_target_idx on public.safety_reports(target_type, target_id);
create index if not exists moderation_actions_target_idx on public.moderation_actions(target_user_id, created_at desc);
