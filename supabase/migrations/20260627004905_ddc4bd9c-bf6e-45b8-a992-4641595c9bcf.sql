UPDATE public.email_send_state SET batch_size = 40, send_delay_ms = 50, updated_at = now();
SELECT cron.alter_job(jobid, schedule := '10 seconds') FROM cron.job WHERE jobname = 'process-email-queue';