-- Temporary, service-role-only credential import endpoint. Install only for the
-- approved transfer to the existing production project. It does not start cron.
-- Drop this function immediately after the two credentials are imported.
create function public.kova_configure_worker_clock(
  p_scheduled_secret text, p_email_secret text
) returns boolean
language plpgsql security definer set search_path=''
as $bootstrap$
begin
  if p_scheduled_secret is null or p_email_secret is null
     or length(p_scheduled_secret) not between 32 and 4096
     or length(p_email_secret) not between 32 and 4096
     or p_scheduled_secret ~ E'[\\r\\n]' or p_email_secret ~ E'[\\r\\n]' then
    raise exception 'worker_clock_credentials_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('kova-worker-clock-import',0));
  if exists(select 1 from vault.secrets
     where name in ('kova-clock-scheduled-secret','kova-clock-email-secret')) then
    raise exception 'worker_clock_credentials_already_exist';
  end if;
  perform vault.create_secret(p_scheduled_secret,'kova-clock-scheduled-secret');
  perform vault.create_secret(p_email_secret,'kova-clock-email-secret');
  return true;
end
$bootstrap$;
revoke all on function public.kova_configure_worker_clock(text,text)
  from public,anon,authenticated;
grant execute on function public.kova_configure_worker_clock(text,text) to service_role;

-- After successful import, as postgres:
-- drop function public.kova_configure_worker_clock(text,text);
