CREATE TABLE IF NOT EXISTS public.chat_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id text NOT NULL,
  title text,
  summary text NOT NULL,
  message_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, chat_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_memories TO authenticated;
GRANT ALL ON public.chat_memories TO service_role;
ALTER TABLE public.chat_memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own memories" ON public.chat_memories FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own memories" ON public.chat_memories FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own memories" ON public.chat_memories FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own memories" ON public.chat_memories FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS chat_memories_user_updated_idx ON public.chat_memories (user_id, updated_at DESC);