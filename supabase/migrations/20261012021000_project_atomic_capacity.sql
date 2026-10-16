-- Serialize every transition into an owner's active project set. A row write
-- provides a common conflict point even under repeatable-read isolation;
-- read-then-insert checks in individual API handlers are only advisory UX.
-- Existing rows are neither changed nor deleted by this migration.
CREATE TABLE public.project_capacity_guards (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  generation boolean NOT NULL DEFAULT false
);
ALTER TABLE public.project_capacity_guards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_capacity_guards FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.enforce_project_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  tier text;
  capacity integer;
  occupied bigint;
BEGIN
  IF NEW.archived_at IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.archived_at IS NULL AND NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.project_capacity_guards(owner_id) VALUES (NEW.owner_id)
  ON CONFLICT (owner_id) DO UPDATE
    SET generation = NOT project_capacity_guards.generation;

  tier := public.effective_user_plan_tier(NEW.owner_id);
  capacity := CASE tier WHEN 'free' THEN 3 WHEN 'plus' THEN 25 WHEN 'pro' THEN 200 ELSE NULL END;
  IF capacity IS NULL THEN
    RAISE EXCEPTION 'Project capacity could not be verified. Try again.' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO occupied FROM public.projects
    WHERE owner_id = NEW.owner_id AND archived_at IS NULL AND id IS DISTINCT FROM NEW.id;
  IF occupied >= capacity THEN
    RAISE EXCEPTION 'Your active project limit has been reached. Archive a project before creating or restoring another.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_project_capacity() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_projects_capacity
  BEFORE INSERT OR UPDATE OF owner_id, archived_at ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.enforce_project_capacity();
