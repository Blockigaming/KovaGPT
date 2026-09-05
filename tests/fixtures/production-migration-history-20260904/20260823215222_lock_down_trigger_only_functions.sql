-- Reviewed structural history fixture, never a live migration command.
-- Replayed only in the generated disposable local upgrade project.

-- Trigger functions are invoked by their triggers and must not be exposed as RPCs.
alter function public.enforce_family_member_cap() set search_path = public, pg_temp;
revoke all on function public.enforce_family_member_cap() from public, anon, authenticated;
grant execute on function public.enforce_family_member_cap() to service_role;

alter function public.enforce_supported_agent_job_kind() set search_path = public, pg_temp;
revoke all on function public.enforce_supported_agent_job_kind() from public, anon, authenticated;
grant execute on function public.enforce_supported_agent_job_kind() to service_role;

alter function public.set_feedback_submission_updated_at() set search_path = public, pg_temp;
revoke all on function public.set_feedback_submission_updated_at() from public, anon, authenticated;
grant execute on function public.set_feedback_submission_updated_at() to service_role;
;
