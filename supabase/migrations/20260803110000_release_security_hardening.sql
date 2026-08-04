-- Release hardening for legacy SECURITY DEFINER routines. Forward-only: no data changes.
alter function public.enqueue_email(text,jsonb) set search_path = public, pg_temp;
alter function public.read_email_batch(text,integer,integer) set search_path = public, pg_temp;
alter function public.delete_email(text,bigint) set search_path = public, pg_temp;
alter function public.move_to_dlq(text,text,bigint,jsonb) set search_path = public, pg_temp;
alter function public.try_increment_daily_usage(uuid,text,integer,integer) set search_path = public, pg_temp;
alter function public.try_add_storage_bytes(uuid,bigint,bigint) set search_path = public, pg_temp;
alter function public.is_family_member(uuid,uuid) set search_path = public, pg_temp;
alter function public.family_owner_of(uuid) set search_path = public, pg_temp;

alter table public.processed_stripe_events add column if not exists processed_at timestamptz;
alter table public.processed_stripe_events add column if not exists correlation_id uuid;
create index if not exists processed_stripe_events_created_at_idx on public.processed_stripe_events(created_at);
revoke all on public.processed_stripe_events from anon, authenticated;
