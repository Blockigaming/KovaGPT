
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS archived_at timestamptz;

DO $$ BEGIN
  CREATE TYPE public.project_task_status AS ENUM ('todo','doing','done');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.project_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  content text NOT NULL DEFAULT '',
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_notes TO authenticated;
GRANT ALL ON public.project_notes TO service_role;
ALTER TABLE public.project_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notes_select_members" ON public.project_notes FOR SELECT TO authenticated
  USING (public.is_project_member(project_id, auth.uid()));
CREATE POLICY "notes_write_editors" ON public.project_notes FOR ALL TO authenticated
  USING (public.can_edit_project(project_id, auth.uid()))
  WITH CHECK (public.can_edit_project(project_id, auth.uid()));
CREATE TRIGGER project_notes_touch BEFORE UPDATE ON public.project_notes FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.project_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  status public.project_task_status NOT NULL DEFAULT 'todo',
  due_date date,
  position integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_tasks_project_idx ON public.project_tasks(project_id, position);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_tasks TO authenticated;
GRANT ALL ON public.project_tasks TO service_role;
ALTER TABLE public.project_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tasks_select_members" ON public.project_tasks FOR SELECT TO authenticated
  USING (public.is_project_member(project_id, auth.uid()));
CREATE POLICY "tasks_write_editors" ON public.project_tasks FOR ALL TO authenticated
  USING (public.can_edit_project(project_id, auth.uid()))
  WITH CHECK (public.can_edit_project(project_id, auth.uid()));
CREATE TRIGGER project_tasks_touch BEFORE UPDATE ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.project_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  size_bytes bigint NOT NULL DEFAULT 0,
  kind text NOT NULL DEFAULT 'file',
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_files_project_idx ON public.project_files(project_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_files TO authenticated;
GRANT ALL ON public.project_files TO service_role;
ALTER TABLE public.project_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "files_select_members" ON public.project_files FOR SELECT TO authenticated
  USING (public.is_project_member(project_id, auth.uid()));
CREATE POLICY "files_write_editors" ON public.project_files FOR ALL TO authenticated
  USING (public.can_edit_project(project_id, auth.uid()))
  WITH CHECK (public.can_edit_project(project_id, auth.uid()));

CREATE TABLE IF NOT EXISTS public.project_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_memory_project_idx ON public.project_memory(project_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_memory TO authenticated;
GRANT ALL ON public.project_memory TO service_role;
ALTER TABLE public.project_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "memory_select_members" ON public.project_memory FOR SELECT TO authenticated
  USING (public.is_project_member(project_id, auth.uid()));
CREATE POLICY "memory_write_editors" ON public.project_memory FOR ALL TO authenticated
  USING (public.can_edit_project(project_id, auth.uid()))
  WITH CHECK (public.can_edit_project(project_id, auth.uid()));

CREATE TABLE IF NOT EXISTS public.project_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  kind text NOT NULL,
  summary text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_activity_project_idx ON public.project_activity(project_id, created_at DESC);
GRANT SELECT, INSERT ON public.project_activity TO authenticated;
GRANT ALL ON public.project_activity TO service_role;
ALTER TABLE public.project_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "activity_select_members" ON public.project_activity FOR SELECT TO authenticated
  USING (public.is_project_member(project_id, auth.uid()));
CREATE POLICY "activity_insert_members" ON public.project_activity FOR INSERT TO authenticated
  WITH CHECK (public.is_project_member(project_id, auth.uid()) AND actor_id = auth.uid());

DROP POLICY IF EXISTS "project_files_read" ON storage.objects;
CREATE POLICY "project_files_read" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'project-files' AND
  public.is_project_member(((storage.foldername(name))[1])::uuid, auth.uid())
);

DROP POLICY IF EXISTS "project_files_write" ON storage.objects;
CREATE POLICY "project_files_write" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'project-files' AND
  public.can_edit_project(((storage.foldername(name))[1])::uuid, auth.uid())
);

DROP POLICY IF EXISTS "project_files_delete" ON storage.objects;
CREATE POLICY "project_files_delete" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'project-files' AND
  public.can_edit_project(((storage.foldername(name))[1])::uuid, auth.uid())
);
