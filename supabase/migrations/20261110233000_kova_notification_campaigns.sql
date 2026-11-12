-- Server-owned release announcements. No campaign is active by default.
-- A release operator must explicitly activate a campaign only after its feature
-- is deployed and the linked destination is verified.
create table if not exists public.kova_notification_campaigns (
 id uuid primary key default gen_random_uuid(),
 event_id text not null check (event_id in (
 'whats_new','new_features','try_feature','check_this_out','interface_updated',
 'tour_available','image_tools_new','animation_tools_new','reference_images_new',
 'templates_new','sketch_new','search_updated','library_search_new','projects_new',
 'interactive_answers_new','connections_new','sharing_new','scheduling_new',
 'notification_controls_new','appearance_options_new','app_update',
 'feature_changing','feature_retired'
 )),
 release_id text not null check (release_id ~ '^[a-zA-Z0-9_.-]{1,80}$'),
 title text not null check (length(title) between 1 and 120),
 body text not null check (length(body) between 1 and 700),
 action_path text check(action_path is null or (action_path like '/%' and action_path not like '//%' and length(action_path)<320)),
 allowed_tiers text[] not null default array['free','plus','pro']::text[]
    check(allowed_tiers <@ array['free','plus','pro']::text[] and cardinality(allowed_tiers) between 1 and 3),
 starts_at timestamptz not null default now(),
 ends_at timestamptz not null,
 enabled boolean not null default false,
 created_at timestamptz not null default now(),
 unique(event_id,release_id),
 check(ends_at>starts_at)
);
create index if not exists kova_notification_campaigns_active_window
 on public.kova_notification_campaigns(starts_at,ends_at) where enabled;
alter table public.kova_notification_campaigns enable row level security;
revoke all on public.kova_notification_campaigns from public,anon,authenticated;
grant all on public.kova_notification_campaigns to service_role;

create table if not exists public.kova_notification_campaign_dismissals (
 campaign_id uuid not null references public.kova_notification_campaigns(id) on delete cascade,
 user_id uuid not null,
 dismissed_at timestamptz not null default now(),
 primary key (campaign_id,user_id)
);
create index if not exists kova_notification_campaign_dismissals_owner
 on public.kova_notification_campaign_dismissals(user_id);
alter table public.kova_notification_campaign_dismissals enable row level security;
revoke all on public.kova_notification_campaign_dismissals from public,anon,authenticated;
grant all on public.kova_notification_campaign_dismissals to service_role;
