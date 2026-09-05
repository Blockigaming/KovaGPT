-- Source-only collaboration. No objects in the locked realtime schema are created.
CREATE TABLE public.canvas_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  private_owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  chat_id text NOT NULL CHECK (char_length(chat_id) BETWEEN 1 AND 256),
  message_id text NOT NULL CHECK (char_length(message_id) BETWEEN 1 AND 256),
  content text NOT NULL CHECK (char_length(content) <= 200000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((private_owner_id IS NULL) <> (project_id IS NULL))
);
CREATE UNIQUE INDEX canvas_personal_identity ON public.canvas_documents(private_owner_id, chat_id, message_id) WHERE project_id IS NULL;
CREATE UNIQUE INDEX canvas_project_identity ON public.canvas_documents(project_id, chat_id, message_id) WHERE project_id IS NOT NULL;
CREATE TABLE public.canvas_revisions (
  document_id uuid NOT NULL REFERENCES public.canvas_documents(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  content text NOT NULL CHECK (char_length(content) <= 200000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(document_id, revision)
);
CREATE TABLE public.canvas_comments (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES public.canvas_documents(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  anchor jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX canvas_comments_document_created ON public.canvas_comments(document_id, created_at, id);
CREATE TABLE public.collaboration_presence (
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  resource_kind text NOT NULL CHECK (resource_kind IN ('project','canvas')),
  resource_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence >= 0),
  expires_at timestamptz NOT NULL,
  closed boolean NOT NULL DEFAULT false,
  PRIMARY KEY(actor_id,session_id)
);
CREATE INDEX collaboration_presence_resource ON public.collaboration_presence(resource_kind,resource_id,expires_at);

-- The private mutation gateway is deliberate: clients receive SELECT only and
-- cannot bypass revision CAS, forge authors/expiry, or move a private audience.
CREATE OR REPLACE FUNCTION kova_private.canvas_access(p_id uuid, p_write boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND deleted_at IS NULL) AND NOT EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=auth.uid()) AND EXISTS (
   SELECT 1 FROM public.canvas_documents d WHERE d.id=p_id AND (
     d.private_owner_id=auth.uid() OR (d.project_id IS NOT NULL AND
       CASE WHEN p_write THEN public.can_edit_project(d.project_id,auth.uid())
       ELSE public.is_project_member(d.project_id,auth.uid()) END))
 )
$$;
REVOKE ALL ON FUNCTION kova_private.canvas_access(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION kova_private.canvas_access(uuid,boolean) TO authenticated,service_role;
ALTER TABLE public.canvas_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_presence ENABLE ROW LEVEL SECURITY;
CREATE POLICY canvas_read ON public.canvas_documents FOR SELECT TO authenticated USING (kova_private.canvas_access(id,false));
CREATE POLICY canvas_revision_read ON public.canvas_revisions FOR SELECT TO authenticated USING (kova_private.canvas_access(document_id,false));
CREATE POLICY canvas_comment_read ON public.canvas_comments FOR SELECT TO authenticated USING (kova_private.canvas_access(document_id,false));
CREATE POLICY collaboration_presence_read ON public.collaboration_presence FOR SELECT TO authenticated USING (
  expires_at>now() AND NOT closed AND (
    (resource_kind='canvas' AND kova_private.canvas_access(resource_id,false)) OR
    (resource_kind='project' AND public.is_project_member(resource_id,auth.uid()))
  )
);
REVOKE ALL ON public.canvas_documents,public.canvas_revisions,public.canvas_comments,public.collaboration_presence FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.canvas_documents,public.canvas_revisions,public.canvas_comments,public.collaboration_presence TO authenticated;
GRANT ALL ON public.canvas_documents,public.canvas_revisions,public.canvas_comments,public.collaboration_presence TO service_role;

-- Canvas accepts complete documents up to 200k characters, including clearing
-- a document. Keep the existing personal history readable by legacy clients.
ALTER TABLE public.chat_message_versions DROP CONSTRAINT IF EXISTS chat_message_versions_content_length;
ALTER TABLE public.chat_message_versions ADD CONSTRAINT chat_message_versions_content_length
  CHECK (char_length(content)<=200000 AND (original_content IS NULL OR char_length(original_content)<=131072));

ALTER TABLE public.project_comments ADD COLUMN deleted_at timestamptz;
-- Tombstones retain only identifiers, so delayed retries cannot recreate a
-- deleted comment and UPDATE notifications can invalidate authorized readers.
REVOKE INSERT,UPDATE,DELETE ON public.project_comments FROM authenticated;

REVOKE INSERT,UPDATE,DELETE ON public.project_notes FROM authenticated;
ALTER TABLE public.project_notes ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision>0);
CREATE FUNCTION kova_private.project_note_revision() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 NEW.revision := CASE WHEN TG_OP='INSERT' THEN 1 ELSE OLD.revision+1 END;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION kova_private.project_note_revision() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER project_note_revision BEFORE INSERT OR UPDATE ON public.project_notes FOR EACH ROW EXECUTE FUNCTION kova_private.project_note_revision();

CREATE FUNCTION kova_private.collaboration_rpc(p_operation text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 uid uuid := auth.uid(); doc public.canvas_documents; pid uuid; cid uuid;
 project_chat public.project_chats; content_value text; message_value text; chat_value text;
 version_value integer; start_value integer; end_value integer; anchor_value jsonb;
 comment_value public.canvas_comments; project_comment_value public.project_comments; heartbeat public.collaboration_presence;
 session_value uuid; sequence_value bigint; kind_value text; result_value jsonb;
 note_value public.project_notes; current_count integer; member_write boolean;
BEGIN
 IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=uid AND deleted_at IS NULL) THEN
   RAISE EXCEPTION 'collaboration_access_denied' USING ERRCODE='42501';
 END IF;
 IF p_operation<>'leave' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,20260903204500));
   IF EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=uid) THEN RAISE EXCEPTION 'collaboration_access_denied' USING ERRCODE='42501'; END IF;
 END IF;
 IF jsonb_typeof(p_data)<>'object' OR octet_length(p_data::text)>850000 THEN
   RAISE EXCEPTION 'collaboration_invalid_input' USING ERRCODE='22023';
 END IF;
 IF p_operation='open' THEN
   pid := nullif(p_data->>'projectId','')::uuid;
   chat_value := btrim(p_data->>'chatId'); message_value := btrim(p_data->>'messageId');
   content_value := coalesce(p_data->>'content','');
   IF char_length(chat_value) NOT BETWEEN 1 AND 256 OR char_length(message_value) NOT BETWEEN 1 AND 256 OR char_length(content_value)>200000 THEN
     RAISE EXCEPTION 'collaboration_invalid_input' USING ERRCODE='22023';
   END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('canvas-open:'||coalesce(pid::text,uid::text),0));
   IF pid IS NOT NULL THEN
     IF NOT public.is_project_member(pid,uid) THEN RAISE EXCEPTION 'collaboration_access_denied' USING ERRCODE='42501'; END IF;
     SELECT * INTO project_chat FROM public.project_chats WHERE id::text=chat_value AND project_id=pid;
     -- Project-origin only. A personal chat cannot silently become a shared Canvas.
     IF project_chat.id IS NULL OR message_value !~ ('^project-'||chat_value||'-[0-9]+$') THEN
       RAISE EXCEPTION 'collaboration_invalid_project_origin' USING ERRCODE='22023';
     END IF;
     version_value := split_part(message_value,'-',7)::integer;
     IF version_value<0 OR version_value>=jsonb_array_length(coalesce(project_chat.snapshot->'messages','[]'::jsonb)) THEN
       RAISE EXCEPTION 'collaboration_invalid_project_origin' USING ERRCODE='22023';
     END IF;
     SELECT * INTO doc FROM public.canvas_documents WHERE project_id=pid AND chat_id=chat_value AND message_id=message_value;
     IF doc.id IS NULL AND NOT public.can_edit_project(pid,uid) THEN
       RAISE EXCEPTION 'canvas_not_created' USING ERRCODE='42501';
     END IF;
   ELSE
     PERFORM pg_advisory_xact_lock(hashtextextended('kova:chat-version:'||uid::text||':'||chat_value||':'||message_value,0));
     SELECT * INTO doc FROM public.canvas_documents WHERE private_owner_id=uid AND chat_id=chat_value AND message_id=message_value;
     -- Only the same owner's personal history is reused. Never migrate it into a Project.
     SELECT content INTO result_value FROM (SELECT to_jsonb(v.content) AS content FROM public.chat_message_versions v
       WHERE owner_id=uid AND chat_id=chat_value AND message_id=message_value AND accepted ORDER BY version DESC LIMIT 1) old;
     IF result_value IS NOT NULL THEN content_value:=result_value#>>'{}'; END IF;
   END IF;
   IF doc.id IS NULL THEN
     SELECT count(*) INTO current_count FROM public.canvas_documents
       WHERE (pid IS NULL AND private_owner_id=uid) OR (pid IS NOT NULL AND project_id=pid);
     IF current_count>=(CASE WHEN pid IS NULL THEN 1000 ELSE 200 END) THEN RAISE EXCEPTION 'canvas_limit' USING ERRCODE='54000'; END IF;
     INSERT INTO public.canvas_documents(private_owner_id,project_id,created_by,chat_id,message_id,content)
       VALUES(CASE WHEN pid IS NULL THEN uid END,pid,uid,chat_value,message_value,content_value) RETURNING * INTO doc;
     IF pid IS NULL THEN
       INSERT INTO public.canvas_revisions(document_id,revision,content,created_at)
         SELECT doc.id,v.version,v.content,v.created_at FROM public.chat_message_versions v
         WHERE owner_id=uid AND chat_id=chat_value AND message_id=message_value ORDER BY version DESC LIMIT 49;
       SELECT coalesce(max(revision),0)+1 INTO version_value FROM public.canvas_revisions WHERE document_id=doc.id;
       UPDATE public.canvas_documents SET revision=version_value WHERE id=doc.id RETURNING * INTO doc;
     END IF;
     INSERT INTO public.canvas_revisions(document_id,revision,content) VALUES(doc.id,doc.revision,doc.content);
   END IF;
   cid:=doc.id;
 ELSIF p_operation IN ('get','save','comment','delete_comment','get_version') THEN
   cid:=(p_data->>'documentId')::uuid;
   IF NOT kova_private.canvas_access(cid,p_operation IN ('save','comment')) THEN
     RAISE EXCEPTION 'collaboration_access_denied' USING ERRCODE='42501';
   END IF;
   SELECT * INTO doc FROM public.canvas_documents WHERE id=cid;
   IF doc.private_owner_id IS NOT NULL THEN
     PERFORM pg_advisory_xact_lock(hashtextextended('kova:chat-version:'||uid::text||':'||doc.chat_id||':'||doc.message_id,0));
   END IF;
   SELECT * INTO doc FROM public.canvas_documents WHERE id=cid FOR UPDATE;
   -- Recheck after waiting for a competing writer.
   IF NOT kova_private.canvas_access(cid,p_operation IN ('save','comment')) THEN
     RAISE EXCEPTION 'collaboration_access_denied' USING ERRCODE='42501';
   END IF;
   IF p_operation='get_version' THEN
     SELECT content INTO content_value FROM public.canvas_revisions WHERE document_id=cid AND revision=(p_data->>'revision')::integer;
     IF content_value IS NULL THEN RAISE EXCEPTION 'canvas_version_missing' USING ERRCODE='P0002'; END IF;
     RETURN jsonb_build_object('content',content_value);
   ELSIF p_operation='save' THEN
     content_value:=p_data->>'content'; version_value:=(p_data->>'expectedRevision')::integer;
     IF content_value IS NULL OR char_length(content_value)>200000 OR version_value IS NULL THEN RAISE EXCEPTION 'collaboration_invalid_input' USING ERRCODE='22023'; END IF;
     -- An exact retry after a lost acknowledgement is idempotent.
     IF doc.revision<>version_value AND NOT(doc.revision=version_value+1 AND doc.content=content_value) THEN
       RAISE EXCEPTION 'canvas_revision_conflict' USING ERRCODE='40001';
     END IF;
     IF doc.content<>content_value THEN
       UPDATE public.canvas_documents SET content=content_value,revision=revision+1,updated_at=now() WHERE id=cid RETURNING * INTO doc;
       INSERT INTO public.canvas_revisions(document_id,revision,content) VALUES(cid,doc.revision,doc.content);
       DELETE FROM public.canvas_revisions WHERE document_id=cid AND revision<=doc.revision-50;
       IF doc.private_owner_id IS NOT NULL THEN
         SELECT coalesce(max(version),0)+1 INTO version_value FROM public.chat_message_versions WHERE owner_id=uid AND chat_id=doc.chat_id AND message_id=doc.message_id;
         UPDATE public.chat_message_versions SET accepted=false WHERE owner_id=uid AND chat_id=doc.chat_id AND message_id=doc.message_id AND accepted;
         INSERT INTO public.chat_message_versions(owner_id,chat_id,message_id,version,source,content,accepted)
           VALUES(uid,doc.chat_id,doc.message_id,version_value,'inline_edit',doc.content,true);
         DELETE FROM public.chat_message_versions WHERE owner_id=uid AND chat_id=doc.chat_id AND message_id=doc.message_id AND version<=version_value-50;
       END IF;
     END IF;
   ELSIF p_operation='comment' THEN
     IF (p_data->>'expectedRevision') IS NULL OR doc.revision<>(p_data->>'expectedRevision')::integer THEN RAISE EXCEPTION 'canvas_revision_conflict' USING ERRCODE='40001'; END IF;
     content_value:=btrim(p_data->>'body');
     IF content_value IS NULL OR char_length(content_value) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'collaboration_invalid_input' USING ERRCODE='22023'; END IF;
     SELECT * INTO comment_value FROM public.canvas_comments WHERE id=(p_data->>'commentId')::uuid;
     IF comment_value.id IS NOT NULL THEN
       IF comment_value.deleted_at IS NOT NULL OR comment_value.document_id<>cid OR comment_value.author_id<>uid OR comment_value.body<>content_value OR (comment_value.anchor->>'start') IS DISTINCT FROM (p_data->>'start') OR (comment_value.anchor->>'end') IS DISTINCT FROM (p_data->>'end') THEN RAISE EXCEPTION 'comment_id_conflict' USING ERRCODE='40001'; END IF;
     ELSE
       IF (SELECT count(*) FROM public.canvas_comments WHERE document_id=cid)>=500 THEN RAISE EXCEPTION 'comment_limit' USING ERRCODE='54000'; END IF;
       start_value:=(p_data->>'start')::integer; end_value:=(p_data->>'end')::integer;
       IF start_value IS NOT NULL OR end_value IS NOT NULL THEN
         IF start_value IS NULL OR end_value IS NULL OR start_value<0 OR end_value<=start_value OR end_value>char_length(doc.content) OR end_value-start_value>500 THEN
           RAISE EXCEPTION 'invalid_comment_anchor' USING ERRCODE='22023';
         END IF;
         anchor_value:=jsonb_build_object('revision',doc.revision,'start',start_value,'end',end_value,
           'quote',substring(doc.content FROM start_value+1 FOR end_value-start_value),
           'prefix',substring(doc.content FROM greatest(1,start_value-31) FOR least(32,start_value)),
           'suffix',substring(doc.content FROM end_value+1 FOR 32));
       END IF;
       INSERT INTO public.canvas_comments(id,document_id,author_id,body,anchor)
         VALUES((p_data->>'commentId')::uuid,cid,uid,content_value,anchor_value);
     END IF;
   ELSIF p_operation='delete_comment' THEN
     UPDATE public.canvas_comments c SET deleted_at=coalesce(deleted_at,now()),body='[deleted]',anchor=NULL WHERE c.id=(p_data->>'commentId')::uuid AND c.document_id=cid
       AND (c.author_id=uid OR doc.private_owner_id=uid OR EXISTS(SELECT 1 FROM public.projects WHERE id=doc.project_id AND owner_id=uid));
     IF NOT FOUND THEN RAISE EXCEPTION 'collaboration_access_denied' USING ERRCODE='42501'; END IF;
   END IF;
 ELSIF p_operation IN ('presence','leave') THEN
   session_value:=(p_data->>'sessionId')::uuid; cid:=(p_data->>'resourceId')::uuid;
   sequence_value:=(p_data->>'sequence')::bigint; kind_value:=p_data->>'kind';
   IF session_value IS NULL OR cid IS NULL OR sequence_value IS NULL OR sequence_value<0 OR kind_value NOT IN ('canvas','project') THEN RAISE EXCEPTION 'collaboration_invalid_input' USING ERRCODE='22023'; END IF;
   IF p_operation='leave' THEN
     PERFORM pg_advisory_xact_lock(hashtextextended('collab-presence:'||uid::text,0));
     IF EXISTS(SELECT 1 FROM public.collaboration_presence WHERE actor_id=uid AND session_id=session_value) OR (SELECT count(*) FROM public.collaboration_presence WHERE actor_id=uid)<64 THEN
       INSERT INTO public.collaboration_presence VALUES(uid,session_value,kind_value,cid,sequence_value,now(),true)
         ON CONFLICT(actor_id,session_id) DO UPDATE SET closed=true,expires_at=now();
     END IF;
     RETURN jsonb_build_object('peers',0);
   END IF;
   IF NOT (CASE WHEN kind_value='canvas' THEN kova_private.canvas_access(cid,false) ELSE public.is_project_member(cid,uid) END) THEN
     RAISE EXCEPTION 'collaboration_access_denied' USING ERRCODE='42501';
   END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('collab-presence:'||uid::text,0));
   DELETE FROM public.collaboration_presence WHERE actor_id=uid AND expires_at<now()-interval '5 minutes';
   SELECT * INTO heartbeat FROM public.collaboration_presence WHERE actor_id=uid AND session_id=session_value;
   IF heartbeat.session_id IS NOT NULL AND (heartbeat.resource_kind<>kind_value OR heartbeat.resource_id<>cid) THEN RAISE EXCEPTION 'collaboration_invalid_input' USING ERRCODE='22023'; END IF;
   IF heartbeat.session_id IS NULL THEN
     IF (SELECT count(*) FROM public.collaboration_presence WHERE actor_id=uid)>=64 OR (SELECT count(*) FROM public.collaboration_presence WHERE actor_id=uid AND NOT closed AND expires_at>now())>=8 THEN RAISE EXCEPTION 'presence_limit' USING ERRCODE='54000'; END IF;
     INSERT INTO public.collaboration_presence VALUES(uid,session_value,kind_value,cid,sequence_value,now()+interval '45 seconds',false);
   ELSIF NOT heartbeat.closed AND sequence_value>heartbeat.sequence THEN
     UPDATE public.collaboration_presence SET sequence=sequence_value,expires_at=now()+interval '45 seconds' WHERE actor_id=uid AND session_id=session_value;
   END IF;
   SELECT count(DISTINCT actor_id) INTO current_count FROM public.collaboration_presence p
     WHERE resource_kind=kind_value AND resource_id=cid AND NOT closed AND expires_at>now() AND actor_id<>uid
       AND (kind_value='canvas' AND EXISTS(SELECT 1 FROM public.canvas_documents d WHERE d.id=cid AND (d.private_owner_id=p.actor_id OR EXISTS(SELECT 1 FROM public.projects j WHERE j.id=d.project_id AND (j.owner_id=p.actor_id OR EXISTS(SELECT 1 FROM public.project_members m WHERE m.project_id=j.id AND m.user_id=p.actor_id)))))
         OR kind_value='project' AND EXISTS(SELECT 1 FROM public.projects j WHERE j.id=cid AND (j.owner_id=p.actor_id OR EXISTS(SELECT 1 FROM public.project_members m WHERE m.project_id=j.id AND m.user_id=p.actor_id))));
   RETURN jsonb_build_object('peers',least(current_count,100));
 ELSIF p_operation IN ('project_comments','project_comment','project_comment_delete') THEN
   pid:=(p_data->>'projectId')::uuid;
   IF NOT public.is_project_member(pid,uid) THEN RAISE EXCEPTION 'collaboration_access_denied' USING ERRCODE='42501'; END IF;
   IF p_operation='project_comment' THEN
     IF NOT public.can_edit_project(pid,uid) THEN RAISE EXCEPTION 'collaboration_access_denied' USING ERRCODE='42501'; END IF;
     content_value:=btrim(p_data->>'body');
     IF content_value IS NULL OR char_length(content_value) NOT BETWEEN 1 AND 4000 OR char_length(coalesce(p_data->>'anchor',''))>200 OR jsonb_typeof(p_data->'mentions')<>'array' OR jsonb_array_length(p_data->'mentions')>20 THEN RAISE EXCEPTION 'collaboration_invalid_input' USING ERRCODE='22023'; END IF;
     IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_data->'mentions') mention WHERE NOT EXISTS(SELECT 1 FROM public.projects p WHERE p.id=pid AND p.owner_id=mention::uuid) AND NOT EXISTS(SELECT 1 FROM public.project_members m WHERE m.project_id=pid AND m.user_id=mention::uuid)) THEN RAISE EXCEPTION 'collaboration_invalid_mentions' USING ERRCODE='22023'; END IF;
     PERFORM pg_advisory_xact_lock(hashtextextended('project-comment:'||pid::text,0));
     SELECT * INTO project_comment_value FROM public.project_comments WHERE id=(p_data->>'commentId')::uuid;
     IF project_comment_value.id IS NOT NULL THEN
       IF project_comment_value.deleted_at IS NOT NULL OR project_comment_value.project_id<>pid OR project_comment_value.author_id<>uid OR project_comment_value.body<>content_value OR project_comment_value.anchor IS DISTINCT FROM (p_data->>'anchor') OR project_comment_value.mentions IS DISTINCT FROM (p_data->'mentions') THEN RAISE EXCEPTION 'comment_id_conflict' USING ERRCODE='40001'; END IF;
     ELSE
       INSERT INTO public.project_comments(id,project_id,author_id,body,anchor,mentions) VALUES((p_data->>'commentId')::uuid,pid,uid,content_value,p_data->>'anchor',p_data->'mentions');
       INSERT INTO public.project_activity(project_id,actor_id,kind,summary) VALUES(pid,uid,'comment_added','Added a project comment');
     END IF;
   ELSIF p_operation='project_comment_delete' THEN
     UPDATE public.project_comments c SET deleted_at=coalesce(deleted_at,now()),body='[deleted]',anchor=NULL,mentions='[]'::jsonb WHERE c.id=(p_data->>'commentId')::uuid AND c.project_id=pid AND (author_id=uid OR EXISTS(SELECT 1 FROM public.projects p WHERE p.id=pid AND p.owner_id=uid));
     IF NOT FOUND THEN RAISE EXCEPTION 'collaboration_access_denied' USING ERRCODE='42501'; END IF;
   END IF;
   RETURN coalesce((SELECT jsonb_agg(c ORDER BY created_at DESC,id DESC) FROM (SELECT id,project_id,author_id,body,anchor,mentions,created_at,updated_at FROM public.project_comments WHERE project_id=pid AND deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 100)c),'[]'::jsonb);
 ELSIF p_operation IN ('note_get','note_save') THEN
   pid:=(p_data->>'projectId')::uuid;
   IF NOT public.is_project_member(pid,uid) OR (p_operation='note_save' AND NOT public.can_edit_project(pid,uid)) THEN RAISE EXCEPTION 'collaboration_access_denied' USING ERRCODE='42501'; END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('collab-notes:'||pid::text,0));
   SELECT * INTO note_value FROM public.project_notes WHERE project_id=pid FOR UPDATE;
   IF p_operation='note_save' THEN
     content_value:=p_data->>'content'; version_value:=(p_data->>'expectedRevision')::integer;
     IF content_value IS NULL OR char_length(content_value)>200000 OR version_value IS NULL THEN RAISE EXCEPTION 'collaboration_invalid_input' USING ERRCODE='22023'; END IF;
     IF coalesce(note_value.revision,0)<>version_value THEN
       IF note_value.revision=version_value+1 AND note_value.content=content_value THEN RETURN to_jsonb(note_value); END IF;
       RAISE EXCEPTION 'note_revision_conflict' USING ERRCODE='40001';
     END IF;
     INSERT INTO public.project_notes(project_id,content,updated_by) VALUES(pid,content_value,uid)
       ON CONFLICT(project_id) DO UPDATE SET content=excluded.content,updated_by=uid RETURNING * INTO note_value;
     INSERT INTO public.project_activity(project_id,actor_id,kind,summary) VALUES(pid,uid,'note','Updated notes');
   END IF;
   IF note_value.id IS NULL THEN RETURN jsonb_build_object('project_id',pid,'content','','revision',0); END IF;
   RETURN to_jsonb(note_value);
 ELSE RAISE EXCEPTION 'collaboration_invalid_operation' USING ERRCODE='22023';
 END IF;
 member_write:=kova_private.canvas_access(cid,true);
 RETURN jsonb_build_object('document',to_jsonb(doc),'canEdit',member_write,
   'canManageComments',coalesce(doc.private_owner_id=uid,false) OR EXISTS(SELECT 1 FROM public.projects WHERE id=doc.project_id AND owner_id=uid),
   'deletedCommentIds',coalesce((SELECT jsonb_agg(id) FROM public.canvas_comments WHERE document_id=cid AND deleted_at IS NOT NULL),'[]'::jsonb),
   'versions',coalesce((SELECT jsonb_agg(v ORDER BY revision DESC) FROM (SELECT revision,created_at FROM public.canvas_revisions WHERE document_id=cid ORDER BY revision DESC LIMIT 50) v),'[]'::jsonb),
   'comments',coalesce((SELECT jsonb_agg(c ORDER BY created_at DESC,id DESC) FROM (SELECT id,author_id,body,anchor,created_at FROM public.canvas_comments WHERE document_id=cid AND deleted_at IS NULL
     AND (p_data->>'beforeId' IS NULL OR (created_at,id)<((p_data->>'beforeCreatedAt')::timestamptz,(p_data->>'beforeId')::uuid))
     ORDER BY created_at DESC,id DESC LIMIT 100) c),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION kova_private.collaboration_rpc(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION kova_private.collaboration_rpc(text,jsonb) TO authenticated;
CREATE FUNCTION public.collaboration_rpc(p_operation text,p_data jsonb)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT kova_private.collaboration_rpc(p_operation,p_data) $$;
REVOKE ALL ON FUNCTION public.collaboration_rpc(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.collaboration_rpc(text,jsonb) TO authenticated;

-- Legacy personal version writes invalidate the new revision instead of silently
-- overwriting a Canvas opened by another device. Project documents never import them.
CREATE FUNCTION kova_private.canvas_legacy_version_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE doc public.canvas_documents;
BEGIN
 IF NOT NEW.accepted THEN RETURN NEW; END IF;
 UPDATE public.canvas_documents SET content=NEW.content,revision=revision+1,updated_at=now()
 WHERE private_owner_id=NEW.owner_id AND chat_id=NEW.chat_id AND message_id=NEW.message_id AND content<>NEW.content RETURNING * INTO doc;
 IF doc.id IS NOT NULL THEN
   INSERT INTO public.canvas_revisions VALUES(doc.id,doc.revision,doc.content,now());
   DELETE FROM public.canvas_revisions WHERE document_id=doc.id AND revision<=doc.revision-50;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION kova_private.canvas_legacy_version_changed() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER canvas_legacy_version_changed AFTER INSERT OR UPDATE OF accepted,content ON public.chat_message_versions FOR EACH ROW EXECUTE FUNCTION kova_private.canvas_legacy_version_changed();

-- INSERT/UPDATE notifications only are consumed. DELETE events are deliberately
-- not subscribed: Supabase cannot apply row authorization to deleted old payloads.
DO $$ DECLARE name text; BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
   FOREACH name IN ARRAY ARRAY['canvas_documents','canvas_comments','collaboration_presence','project_notes','project_comments'] LOOP
     IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=name) THEN
       EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',name);
     END IF;
   END LOOP;
 END IF;
END $$;
