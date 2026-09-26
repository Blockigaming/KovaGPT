-- Disposable local target only. Never run against the hosted production project.
-- Supabase assigns pgmq and pg_cron to their own schemas.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgmq;
CREATE EXTENSION IF NOT EXISTS pg_cron;
