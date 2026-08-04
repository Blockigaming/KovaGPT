CREATE TABLE IF NOT EXISTS public.writing_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'Untitled document',
  content text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  last_opened_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.writing_documents TO authenticated;
GRANT ALL ON public.writing_documents TO service_role;

ALTER TABLE public.writing_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own writing documents"
ON public.writing_documents FOR ALL TO authenticated
USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE INDEX IF NOT EXISTS writing_documents_owner_updated_idx
ON public.writing_documents (owner_id, updated_at DESC);

CREATE TRIGGER writing_documents_touch
BEFORE UPDATE ON public.writing_documents
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.writing_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.writing_documents(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  version integer NOT NULL,
  word_count integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'autosave',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.writing_document_versions TO authenticated;
GRANT ALL ON public.writing_document_versions TO service_role;

ALTER TABLE public.writing_document_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own writing versions"
ON public.writing_document_versions FOR ALL TO authenticated
USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE INDEX IF NOT EXISTS writing_document_versions_doc_idx
ON public.writing_document_versions (document_id, version DESC);

CREATE OR REPLACE FUNCTION public.save_writing_document(
  p_id uuid,
  p_title text,
  p_content text,
  p_expected_version integer,
  p_source text
)
RETURNS public.writing_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  doc public.writing_documents;
  words integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO doc FROM public.writing_documents
  WHERE id = p_id AND owner_id = auth.uid()
  FOR UPDATE;

  IF doc.id IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF doc.version <> p_expected_version THEN
    RAISE EXCEPTION 'version_conflict';
  END IF;

  words := CASE WHEN btrim(p_content) = '' THEN 0
                ELSE array_length(regexp_split_to_array(btrim(p_content), '\s+'), 1) END;

  UPDATE public.writing_documents
  SET title = p_title,
      content = p_content,
      version = doc.version + 1,
      last_opened_at = now(),
      updated_at = now()
  WHERE id = p_id AND owner_id = auth.uid()
  RETURNING * INTO doc;

  INSERT INTO public.writing_document_versions
    (document_id, owner_id, title, content, version, word_count, source)
  VALUES (doc.id, doc.owner_id, doc.title, doc.content, doc.version, words, coalesce(p_source, 'autosave'));

  RETURN doc;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_writing_document(uuid, text, text, integer, text) TO authenticated;

ALTER TABLE public.subscriptions
ADD COLUMN IF NOT EXISTS last_stripe_event_created_at timestamptz;