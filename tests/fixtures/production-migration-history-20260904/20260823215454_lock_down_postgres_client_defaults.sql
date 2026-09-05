-- Reviewed structural history fixture, never a live migration command.
-- Replayed only in the generated disposable local upgrade project.

-- Remove powerful privileges from all existing public objects.
revoke maintain on all tables in schema public from anon, authenticated;
revoke update on all sequences in schema public from anon, authenticated;

-- Prevent recurrence for objects created by the postgres migration role.
alter default privileges in schema public
  revoke truncate, trigger, references, maintain on tables from anon, authenticated;
alter default privileges in schema public
  revoke update on sequences from anon, authenticated;
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public
  grant execute on functions to service_role;
;
