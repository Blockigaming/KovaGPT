begin;

-- The original volatile defaults evaluated clock_timestamp() independently.
-- A millisecond tick between the two evaluations could make expires_at greater
-- than created_at + five minutes and reject an otherwise valid session insert.
-- statement_timestamp() is stable for the whole INSERT statement.
alter table public.work_browser_sessions
  alter column created_at set default statement_timestamp(),
  alter column expires_at set default (statement_timestamp() + interval '5 minutes');

commit;
