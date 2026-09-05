-- Reviewed structural history fixture, never a live migration command.
-- Replayed only in the generated disposable local upgrade project.

-- Client roles must never alter table structure, create triggers, add references,
-- or bypass RLS through TRUNCATE. Preserve only separately granted DML.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;

-- Prevent the same privileges from being granted to client roles on future tables
-- created by the migration owner.
alter default privileges in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;
;
