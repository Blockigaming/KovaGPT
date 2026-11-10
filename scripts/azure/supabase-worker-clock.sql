-- Operator configuration, not an application schema migration.
-- Run as postgres only after the two existing credentials have been copied to
-- the existing production Supabase Vault. No credential belongs in this file.
-- Leave the Azure jobs running until BOTH HTTP responses are verified; then
-- suspend those jobs. Rollback: cron.unschedule('kova-worker-clock') and resume
-- the existing Azure jobs. Existing server-side leases prevent duplicate claims.
do $preflight$
begin
  if not exists(select 1 from pg_extension where extname='pg_cron')
     or not exists(select 1 from pg_extension where extname='pg_net')
     or not exists(select 1 from pg_extension where extname='pgcrypto') then
    raise exception 'worker_clock_extensions_missing';
  end if;
  if (select count(*) from vault.decrypted_secrets
      where name in ('kova-clock-scheduled-secret','kova-clock-email-secret')
        and length(decrypted_secret)>=32
        and decrypted_secret !~ E'[\\r\\n]')<>2 then
    raise exception 'worker_clock_credentials_missing';
  end if;
  if exists(select 1 from cron.job where jobname='kova-worker-clock') then
    raise exception 'worker_clock_already_configured';
  end if;
end
$preflight$;

select cron.schedule('kova-worker-clock','* * * * *',$clock$
do $run$
declare
  scheduled_secret text;
  email_secret text;
  run_id text := gen_random_uuid()::text;
  issued_at text := to_char(clock_timestamp() at time zone 'UTC',
                            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  signature text;
begin
  -- Fixed destination and paths: this scheduler cannot act as an HTTP proxy.
  select decrypted_secret into strict scheduled_secret
    from vault.decrypted_secrets where name='kova-clock-scheduled-secret';
  select decrypted_secret into strict email_secret
    from vault.decrypted_secrets where name='kova-clock-email-secret';
  if length(scheduled_secret)<32 or length(email_secret)<32
     or scheduled_secret ~ E'[\\r\\n]' or email_secret ~ E'[\\r\\n]' then
    raise exception 'worker_clock_credentials_invalid';
  end if;
  signature := encode(extensions.hmac(
    convert_to('kova-email-worker-v1'||chr(10)||'POST'||chr(10)||
      '/api/internal/email-dispatch'||chr(10)||run_id||chr(10)||issued_at||chr(10)||'{}','UTF8'),
    convert_to(email_secret,'UTF8'),'sha256'),'hex');
  perform net.http_post(
    url:='https://kovagpt.com/api/internal/scheduled-execution',
    body:='{}'::jsonb,
    headers:=jsonb_build_object('Authorization','Bearer '||scheduled_secret,
      'Content-Type','application/json'),timeout_milliseconds:=120000);
  perform net.http_post(
    url:='https://kovagpt.com/api/internal/email-dispatch',
    body:='{}'::jsonb,
    headers:=jsonb_build_object('Content-Type','application/json',
      'X-Kova-Email-Run-Id',run_id,'X-Kova-Email-Issued-At',issued_at,
      'X-Kova-Email-Signature',signature),timeout_milliseconds:=120000);
end
$run$;
$clock$);
