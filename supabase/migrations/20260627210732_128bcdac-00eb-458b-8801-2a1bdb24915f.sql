
CREATE TABLE public.scheduled_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  run_at TIMESTAMPTZ NOT NULL,
  repeat TEXT NOT NULL DEFAULT 'none',
  status TEXT NOT NULL DEFAULT 'scheduled',
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  last_result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT scheduled_tasks_repeat_check CHECK (repeat IN ('none','daily','weekly','monthly')),
  CONSTRAINT scheduled_tasks_status_check CHECK (status IN ('scheduled','running','paused','completed','failed'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_tasks TO authenticated;
GRANT ALL ON public.scheduled_tasks TO service_role;

ALTER TABLE public.scheduled_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own scheduled tasks"
  ON public.scheduled_tasks FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX scheduled_tasks_user_idx ON public.scheduled_tasks(user_id, run_at);

CREATE TRIGGER scheduled_tasks_touch_updated_at
  BEFORE UPDATE ON public.scheduled_tasks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
