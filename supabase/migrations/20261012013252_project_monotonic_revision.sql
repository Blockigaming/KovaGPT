-- Generated with Supabase CLI 2.111.0; not applied to shared or production databases.
-- Scope: projects only. Do not change shared touch_updated_at behavior.
-- Every UPDATE (including pin/archive/deletion request) advances the token,
-- even within one transaction or when a stored timestamp is ahead of the clock.
BEGIN;
CREATE OR REPLACE FUNCTION public.touch_project_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT isfinite(OLD.updated_at) THEN
    RAISE EXCEPTION 'Project revision must be finite';
  END IF;
  NEW.updated_at := greatest(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.touch_project_revision() FROM PUBLIC;
DROP TRIGGER trg_projects_updated_at ON public.projects;
CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.touch_project_revision();
COMMIT;
