-- Conversational Kovas are independent from saved Work agents. Every published
-- definition is an immutable, explicitly shared snapshot, never a creator grant.
CREATE TABLE public.custom_kovas(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 revision bigint NOT NULL DEFAULT 1,head_version uuid,publication_version uuid,visibility text NOT NULL DEFAULT 'private' CHECK(visibility IN('private','link','public')),
 publication_epoch uuid NOT NULL DEFAULT gen_random_uuid(),link_hash text,blocked boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,owner_id)
);
CREATE TABLE public.custom_kova_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kova_id uuid NOT NULL,owner_id uuid NOT NULL,version integer NOT NULL,
 config jsonb NOT NULL,knowledge jsonb NOT NULL DEFAULT '[]',size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 262144),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(kova_id,owner_id) REFERENCES public.custom_kovas(id,owner_id) ON DELETE CASCADE,
 UNIQUE(kova_id,version),UNIQUE(kova_id,id)
);
ALTER TABLE public.custom_kovas ADD CONSTRAINT custom_kova_head_fk FOREIGN KEY(id,head_version) REFERENCES public.custom_kova_versions(kova_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.custom_kovas ADD CONSTRAINT custom_kova_publication_fk FOREIGN KEY(id,publication_version) REFERENCES public.custom_kova_versions(kova_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE public.custom_kova_link_grants(
 kova_id uuid NOT NULL REFERENCES public.custom_kovas(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 publication_epoch uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(kova_id,user_id)
);
CREATE TABLE public.custom_kova_mutations(
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,mutation_id uuid NOT NULL,request_hash text NOT NULL,result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,mutation_id)
);
CREATE TABLE public.custom_kova_reports(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kova_id uuid NOT NULL REFERENCES public.custom_kovas(id) ON DELETE CASCADE,
 reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,version_id uuid NOT NULL,version_name text NOT NULL CHECK(length(version_name) BETWEEN 1 AND 120),reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 status text NOT NULL DEFAULT 'open' CHECK(status IN('open','reviewed')),created_at timestamptz NOT NULL DEFAULT now(),reviewed_at timestamptz
);
CREATE TABLE public.custom_kova_moderation_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kova_id uuid NOT NULL REFERENCES public.custom_kovas(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,action text NOT NULL CHECK(action IN('block','restore','review')),reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX custom_kovas_owner_idx ON public.custom_kovas(owner_id,id);
CREATE INDEX custom_kovas_public_idx ON public.custom_kovas(id) WHERE visibility='public' AND NOT blocked;
CREATE INDEX custom_kova_reports_queue_idx ON public.custom_kova_reports(status,created_at,id);
ALTER TABLE public.custom_kovas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_kova_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_kova_link_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_kova_mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_kova_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_kova_moderation_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.custom_kovas,public.custom_kova_versions,public.custom_kova_link_grants,public.custom_kova_mutations,public.custom_kova_reports,public.custom_kova_moderation_events FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.custom_kovas,public.custom_kova_versions,public.custom_kova_link_grants,public.custom_kova_mutations,public.custom_kova_reports,public.custom_kova_moderation_events TO service_role;
CREATE FUNCTION kova_private.custom_kova_principal_current(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user AND deleted_at IS NULL AND email_confirmed_at IS NOT NULL AND NOT coalesce(is_anonymous,false) AND (banned_until IS NULL OR banned_until<=now()))
 AND NOT EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_user)
 AND NOT EXISTS(SELECT 1 FROM public.banned_users WHERE user_id=p_user);
$$;
REVOKE ALL ON FUNCTION kova_private.custom_kova_principal_current(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION kova_private.custom_kova_principal_current(uuid) TO service_role;
CREATE FUNCTION kova_private.custom_kova_owner_current()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT kova_private.custom_kova_principal_current((SELECT auth.uid()))$$;
REVOKE ALL ON FUNCTION kova_private.custom_kova_owner_current() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION kova_private.custom_kova_owner_current() TO authenticated;
GRANT SELECT ON public.custom_kovas,public.custom_kova_versions TO authenticated;
CREATE POLICY custom_kova_owner_read ON public.custom_kovas FOR SELECT TO authenticated USING(owner_id=(SELECT auth.uid()) AND (SELECT kova_private.custom_kova_owner_current()));
CREATE POLICY custom_kova_version_owner_read ON public.custom_kova_versions FOR SELECT TO authenticated USING(owner_id=(SELECT auth.uid()) AND (SELECT kova_private.custom_kova_owner_current()));

CREATE FUNCTION kova_private.custom_kova_readable(p_actor uuid,p_kova public.custom_kovas)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT kova_private.custom_kova_principal_current(p_kova.owner_id) AND NOT p_kova.blocked AND (
  p_actor=p_kova.owner_id OR (p_kova.publication_version IS NOT NULL AND (p_kova.visibility='public' OR (p_kova.visibility='link' AND EXISTS(
   SELECT 1 FROM public.custom_kova_link_grants WHERE kova_id=p_kova.id AND user_id=p_actor AND publication_epoch=p_kova.publication_epoch)))));
$$;
REVOKE ALL ON FUNCTION kova_private.custom_kova_readable(uuid,public.custom_kovas) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION kova_private.custom_kova_readable(uuid,public.custom_kovas) TO service_role;

CREATE FUNCTION public.read_custom_kovas(p_actor uuid,p_scope text,p_id uuid DEFAULT NULL,p_after uuid DEFAULT NULL,p_version uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE k public.custom_kovas;v public.custom_kova_versions;rows jsonb;
BEGIN
 IF p_scope IS NULL OR p_scope NOT IN('directory','owned','read','versions','version','knowledge') THEN RAISE EXCEPTION 'custom_kova_invalid' USING ERRCODE='22023';END IF;
 IF p_scope<>'directory' AND NOT kova_private.custom_kova_principal_current(p_actor) THEN RAISE EXCEPTION 'custom_kova_denied' USING ERRCODE='42501';END IF;
 IF p_scope IN('directory','owned') THEN
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') INTO rows FROM(
   SELECT c.id,c.owner_id=p_actor AS owned,c.revision,c.visibility,c.blocked,x.id AS version_id,x.config-'instructions'-'knowledge' AS config
   FROM public.custom_kovas c JOIN public.custom_kova_versions x ON x.id=CASE WHEN p_scope='owned' THEN c.head_version ELSE c.publication_version END
   WHERE (p_after IS NULL OR c.id>p_after) AND CASE WHEN p_scope='owned' THEN c.owner_id=p_actor ELSE c.visibility='public' AND NOT c.blocked AND kova_private.custom_kova_principal_current(c.owner_id) END
   ORDER BY c.id LIMIT 21)r;
  RETURN jsonb_build_object('rows',rows);
 END IF;
 IF p_scope='knowledge' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') INTO rows FROM(
   SELECT id,title,length(content_text) AS characters FROM public.user_library_items WHERE user_id=p_actor AND content_text IS NOT NULL AND length(content_text)>0 AND (p_after IS NULL OR id>p_after) ORDER BY id LIMIT 21)r;
  RETURN jsonb_build_object('rows',rows);
 END IF;
 SELECT * INTO k FROM public.custom_kovas WHERE id=p_id;
 IF NOT FOUND OR (k.owner_id<>p_actor AND NOT kova_private.custom_kova_readable(p_actor,k)) THEN RAISE EXCEPTION 'custom_kova_unavailable' USING ERRCODE='42501';END IF;
 IF p_scope='versions' THEN
  IF k.owner_id<>p_actor THEN RAISE EXCEPTION 'custom_kova_denied' USING ERRCODE='42501';END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.version DESC),'[]') INTO rows FROM(
   SELECT id,version,created_at,size_bytes FROM public.custom_kova_versions WHERE kova_id=k.id ORDER BY version DESC LIMIT 20)r;
  RETURN jsonb_build_object('rows',rows);
 END IF;
 IF p_scope='version' AND k.owner_id<>p_actor THEN RAISE EXCEPTION 'custom_kova_denied' USING ERRCODE='42501';END IF;
 SELECT * INTO v FROM public.custom_kova_versions WHERE kova_id=k.id AND id=CASE WHEN p_scope='version' THEN p_version WHEN k.owner_id=p_actor THEN k.head_version ELSE k.publication_version END;
 IF NOT FOUND THEN RAISE EXCEPTION 'custom_kova_version_retired' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('id',k.id,'owned',k.owner_id=p_actor,'revision',k.revision,'visibility',k.visibility,'blocked',k.blocked,'versionId',v.id,'publicationVersion',k.publication_version,
  'config',CASE WHEN k.owner_id=p_actor THEN v.config ELSE v.config-'instructions'-'knowledge' END,
  'knowledge',CASE WHEN k.owner_id=p_actor THEN v.knowledge ELSE (SELECT coalesce(jsonb_agg(jsonb_build_object('title',x->>'title','characters',length(x->>'content'))),'[]') FROM jsonb_array_elements(v.knowledge)x) END);
END;$$;

CREATE FUNCTION public.resolve_custom_kova(p_actor uuid,p_id uuid,p_version uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE k public.custom_kovas;v public.custom_kova_versions;
BEGIN
 IF NOT kova_private.custom_kova_principal_current(p_actor) THEN RAISE EXCEPTION 'custom_kova_denied' USING ERRCODE='42501';END IF;
 SELECT * INTO k FROM public.custom_kovas WHERE id=p_id;
 IF NOT FOUND OR NOT kova_private.custom_kova_readable(p_actor,k) THEN RAISE EXCEPTION 'custom_kova_unavailable' USING ERRCODE='42501';END IF;
 IF k.owner_id<>p_actor AND p_version IS NOT NULL AND p_version<>k.publication_version THEN RAISE EXCEPTION 'custom_kova_version_retired' USING ERRCODE='42501';END IF;
 SELECT * INTO v FROM public.custom_kova_versions WHERE kova_id=k.id AND id=coalesce(p_version,CASE WHEN k.owner_id=p_actor THEN k.head_version ELSE k.publication_version END);
 IF NOT FOUND THEN RAISE EXCEPTION 'custom_kova_version_retired' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('id',k.id,'versionId',v.id,'publicationEpoch',k.publication_epoch,'config',v.config,'knowledge',v.knowledge);
END;$$;

CREATE FUNCTION public.mutate_custom_kova(p_actor uuid,p_id uuid,p_mutation uuid,p_revision bigint,p_action text,p_payload jsonb,p_storage_limit bigint,p_requested_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE k public.custom_kovas;v public.custom_kova_versions;prior public.custom_kova_versions;receipt public.custom_kova_mutations;fingerprint text;configuration jsonb;knowledge jsonb:='[]';item jsonb;source public.user_library_items;snapshot jsonb;bytes bigint;result jsonb;new_id uuid;version_id uuid;next_version integer;source_owner uuid;actor_lock uuid;
BEGIN
 IF p_requested_at IS NULL OR p_requested_at<now()-interval '7 days' OR p_requested_at>now()+interval '5 minutes' THEN RAISE EXCEPTION 'custom_kova_request_expired' USING ERRCODE='22023';END IF;
 IF p_actor IS NULL OR p_mutation IS NULL OR p_revision IS NULL OR p_revision<0 OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_action IS NULL OR p_action NOT IN('create','save','restore','deleteVersion','publish','unpublish','delete','fork','claimLink','report') THEN RAISE EXCEPTION 'custom_kova_invalid' USING ERRCODE='22023';END IF;
 SELECT owner_id INTO source_owner FROM public.custom_kovas WHERE id=p_id;
 FOR actor_lock IN SELECT DISTINCT x FROM unnest(ARRAY[p_actor,source_owner])x WHERE x IS NOT NULL ORDER BY x LOOP PERFORM pg_advisory_xact_lock(hashtextextended(actor_lock::text,20260903204500));END LOOP;
 IF NOT kova_private.custom_kova_principal_current(p_actor) THEN RAISE EXCEPTION 'custom_kova_denied' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text,73101));
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('id',p_id,'revision',p_revision,'action',p_action,'payload',p_payload,'requestedAt',p_requested_at)::text,'UTF8')),'hex');
 SELECT * INTO receipt FROM public.custom_kova_mutations WHERE owner_id=p_actor AND mutation_id=p_mutation;
 IF FOUND THEN IF receipt.request_hash<>fingerprint THEN RAISE EXCEPTION 'custom_kova_idempotency_conflict' USING ERRCODE='40001';END IF;RETURN receipt.result;END IF;
 DELETE FROM public.custom_kova_mutations WHERE owner_id=p_actor AND mutation_id IN(SELECT mutation_id FROM public.custom_kova_mutations WHERE owner_id=p_actor AND created_at<now()-interval '8 days' ORDER BY created_at LIMIT 100);
 IF (SELECT count(*) FROM public.custom_kova_mutations WHERE owner_id=p_actor)>=10000 THEN RAISE EXCEPTION 'custom_kova_receipt_limit' USING ERRCODE='54000';END IF;
 IF p_action<>'create' THEN
  SELECT * INTO k FROM public.custom_kovas WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR NOT kova_private.custom_kova_principal_current(k.owner_id) THEN RAISE EXCEPTION 'custom_kova_unavailable' USING ERRCODE='42501';END IF;
  IF p_action<>'claimLink' AND k.revision<>p_revision THEN RAISE EXCEPTION 'custom_kova_conflict' USING ERRCODE='40001';END IF;
  IF p_action NOT IN('fork','claimLink','report') AND k.owner_id<>p_actor THEN RAISE EXCEPTION 'custom_kova_denied' USING ERRCODE='42501';END IF;
 END IF;
 IF p_action IN('create','fork') THEN
  IF (SELECT count(*) FROM public.custom_kovas WHERE owner_id=p_actor)>=100 THEN RAISE EXCEPTION 'custom_kova_capacity' USING ERRCODE='54000';END IF;
  IF p_action='create' AND (p_revision<>0 OR p_id IS NOT NULL) THEN RAISE EXCEPTION 'custom_kova_invalid' USING ERRCODE='22023';END IF;
  IF p_action='fork' THEN
   IF NOT kova_private.custom_kova_readable(p_actor,k) OR (k.owner_id<>p_actor AND NOT coalesce((SELECT (config->>'allowFork')::boolean FROM public.custom_kova_versions WHERE id=k.publication_version),false)) OR p_payload->>'consent' IS DISTINCT FROM (CASE WHEN k.owner_id=p_actor THEN k.head_version ELSE k.publication_version END)::text THEN RAISE EXCEPTION 'custom_kova_copy_denied' USING ERRCODE='42501';END IF;
   SELECT * INTO prior FROM public.custom_kova_versions WHERE id=CASE WHEN k.owner_id=p_actor THEN k.head_version ELSE k.publication_version END;
   configuration:=jsonb_set(prior.config,'{knowledge}',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind','text','title',x->>'title','content',x->>'content')),'[]') FROM jsonb_array_elements(prior.knowledge)x));
   configuration:=jsonb_set(configuration,'{name}',to_jsonb(left(configuration->>'name',110)||' copy'));
   knowledge:=prior.knowledge;
  ELSE configuration:=p_payload->'config';END IF;
  INSERT INTO public.custom_kovas(owner_id) VALUES(p_actor) RETURNING * INTO k;
 END IF;
 IF p_action IN('create','fork','save','restore') THEN
  IF p_action='save' THEN configuration:=p_payload->'config';END IF;
  IF p_action='restore' THEN
   SELECT * INTO prior FROM public.custom_kova_versions WHERE kova_id=k.id AND id=(p_payload->>'versionId')::uuid;
   IF NOT FOUND THEN RAISE EXCEPTION 'custom_kova_version_retired' USING ERRCODE='42501';END IF;
   configuration:=prior.config;knowledge:=prior.knowledge;
  END IF;
  IF jsonb_typeof(configuration) IS DISTINCT FROM 'object' OR coalesce(length(configuration->>'name'),0) NOT BETWEEN 1 AND 120 OR coalesce(length(configuration->>'instructions'),0) NOT BETWEEN 1 AND 12000 OR jsonb_typeof(configuration->'knowledge') IS DISTINCT FROM 'array' OR jsonb_array_length(configuration->'knowledge')>10 OR coalesce(configuration->>'mode','') NOT IN('instant','medium','thinking','high','extra_high','pro','kova_5_5','kova_5_4','kova_o3') THEN RAISE EXCEPTION 'custom_kova_invalid' USING ERRCODE='22023';END IF;
  IF (SELECT count(*) FROM public.custom_kova_versions WHERE kova_id=k.id)>=20 THEN RAISE EXCEPTION 'custom_kova_version_limit' USING ERRCODE='54000';END IF;
  IF p_action IN('create','save') THEN
   FOR item IN SELECT value FROM jsonb_array_elements(configuration->'knowledge') LOOP
    IF item->>'kind'='library' THEN
     SELECT * INTO source FROM public.user_library_items WHERE id=(item->>'id')::uuid AND user_id=p_actor FOR SHARE;
     IF NOT FOUND OR source.content_text IS NULL OR length(source.content_text)<1 OR length(source.content_text)>30000 THEN RAISE EXCEPTION 'custom_kova_knowledge_unavailable' USING ERRCODE='42501';END IF;
     snapshot:=jsonb_build_object('title',left(source.title,200),'content',source.content_text);
    ELSIF item->>'kind'='text' AND length(item->>'title') BETWEEN 1 AND 200 AND length(item->>'content') BETWEEN 1 AND 30000 THEN snapshot:=jsonb_build_object('title',item->>'title','content',item->>'content');
    ELSE RAISE EXCEPTION 'custom_kova_knowledge_invalid' USING ERRCODE='22023';END IF;
    knowledge:=knowledge||jsonb_build_array(snapshot);
   END LOOP;
  END IF;
  IF (SELECT coalesce(sum(length(x->>'content')),0) FROM jsonb_array_elements(knowledge)x)>180000 THEN RAISE EXCEPTION 'custom_kova_knowledge_limit' USING ERRCODE='54000';END IF;
  bytes:=octet_length(configuration::text)+octet_length(knowledge::text);
  IF bytes>262144 OR p_storage_limit IS NULL OR NOT public.try_add_storage_bytes(p_actor,bytes,p_storage_limit) THEN RAISE EXCEPTION 'custom_kova_storage_limit' USING ERRCODE='54000';END IF;
  SELECT coalesce(max(version),0)+1 INTO next_version FROM public.custom_kova_versions WHERE kova_id=k.id;
  INSERT INTO public.custom_kova_versions(kova_id,owner_id,version,config,knowledge,size_bytes) VALUES(k.id,p_actor,next_version,configuration,knowledge,bytes) RETURNING id INTO version_id;
  UPDATE public.custom_kovas SET head_version=version_id,revision=CASE WHEN p_action IN('create','fork') THEN revision ELSE revision+1 END,updated_at=now() WHERE id=k.id RETURNING * INTO k;
 ELSIF p_action='deleteVersion' THEN
  version_id:=(p_payload->>'versionId')::uuid;
  IF version_id=k.head_version OR version_id=k.publication_version THEN RAISE EXCEPTION 'custom_kova_version_in_use' USING ERRCODE='42501';END IF;
  DELETE FROM public.custom_kova_versions WHERE kova_id=k.id AND id=version_id RETURNING size_bytes INTO bytes;
  IF FOUND THEN UPDATE public.user_storage SET bytes_used=greatest(0,bytes_used-bytes),updated_at=now() WHERE user_id=p_actor;END IF;
  UPDATE public.custom_kovas SET revision=revision+1,updated_at=now() WHERE id=k.id RETURNING * INTO k;
 ELSIF p_action='publish' THEN
  IF k.blocked OR p_payload->>'versionId' IS DISTINCT FROM k.head_version::text OR p_payload->>'consent' IS DISTINCT FROM k.head_version::text OR coalesce(p_payload->>'visibility','') NOT IN('link','public') THEN RAISE EXCEPTION 'custom_kova_publish_denied' USING ERRCODE='42501';END IF;
  IF p_payload->>'visibility'='link' AND (p_payload->>'linkHash' IS NULL OR (p_payload->>'linkHash')!~'^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'custom_kova_invalid' USING ERRCODE='22023';END IF;
  UPDATE public.custom_kovas SET publication_version=head_version,visibility=p_payload->>'visibility',link_hash=CASE WHEN p_payload->>'visibility'='link' THEN p_payload->>'linkHash' ELSE NULL END,publication_epoch=gen_random_uuid(),revision=revision+1,updated_at=now() WHERE id=k.id RETURNING * INTO k;
  DELETE FROM public.custom_kova_link_grants WHERE kova_id=k.id;
 ELSIF p_action='unpublish' THEN
  UPDATE public.custom_kovas SET publication_version=NULL,visibility='private',link_hash=NULL,publication_epoch=gen_random_uuid(),revision=revision+1,updated_at=now() WHERE id=k.id RETURNING * INTO k;
  DELETE FROM public.custom_kova_link_grants WHERE kova_id=k.id;
 ELSIF p_action='delete' THEN
  SELECT coalesce(sum(size_bytes),0) INTO bytes FROM public.custom_kova_versions WHERE kova_id=k.id;
  DELETE FROM public.custom_kovas WHERE id=k.id;
  UPDATE public.user_storage SET bytes_used=greatest(0,bytes_used-bytes),updated_at=now() WHERE user_id=p_actor;
 ELSIF p_action='claimLink' THEN
  IF k.blocked OR k.visibility<>'link' OR k.publication_version IS NULL OR p_payload->>'linkHash' IS DISTINCT FROM k.link_hash THEN RAISE EXCEPTION 'custom_kova_link_unavailable' USING ERRCODE='42501';END IF;
  IF (SELECT count(*) FROM public.custom_kova_link_grants WHERE kova_id=k.id)>=10000 AND NOT EXISTS(SELECT 1 FROM public.custom_kova_link_grants WHERE kova_id=k.id AND user_id=p_actor) THEN RAISE EXCEPTION 'custom_kova_capacity' USING ERRCODE='54000';END IF;
  INSERT INTO public.custom_kova_link_grants(kova_id,user_id,publication_epoch) VALUES(k.id,p_actor,k.publication_epoch) ON CONFLICT(kova_id,user_id) DO UPDATE SET publication_epoch=excluded.publication_epoch,created_at=now();
 ELSIF p_action='report' THEN
  IF NOT kova_private.custom_kova_readable(p_actor,k) OR k.publication_version IS NULL OR coalesce(length(p_payload->>'reason'),0) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'custom_kova_report_denied' USING ERRCODE='42501';END IF;
  DELETE FROM public.custom_kova_reports WHERE kova_id=k.id AND status='reviewed' AND reviewed_at<now()-interval '30 days';
  IF (SELECT count(*) FROM public.custom_kova_reports WHERE kova_id=k.id)>=200 OR (SELECT count(*) FROM public.custom_kova_reports WHERE reporter_id=p_actor AND created_at>now()-interval '1 day')>=5 THEN RAISE EXCEPTION 'custom_kova_report_limit' USING ERRCODE='54000';END IF;
  INSERT INTO public.custom_kova_reports(kova_id,reporter_id,version_id,version_name,reason) SELECT k.id,p_actor,k.publication_version,config->>'name',p_payload->>'reason' FROM public.custom_kova_versions WHERE id=k.publication_version;
 END IF;
 result:=jsonb_build_object('id',k.id,'revision',k.revision,'versionId',k.head_version,'visibility',k.visibility,'deleted',p_action='delete');
 INSERT INTO public.custom_kova_mutations(owner_id,mutation_id,request_hash,result) VALUES(p_actor,p_mutation,fingerprint,result);
 RETURN result;
END;$$;

CREATE FUNCTION public.moderate_custom_kova(p_actor uuid,p_id uuid,p_revision bigint,p_action text,p_reason text,p_report uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE k public.custom_kovas;actor_lock uuid;owner_id uuid;
BEGIN
 IF p_revision IS NULL OR p_action IS NULL OR p_action NOT IN('block','restore','review') OR coalesce(length(p_reason),0) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'custom_kova_invalid' USING ERRCODE='22023';END IF;
 SELECT c.owner_id INTO owner_id FROM public.custom_kovas c WHERE id=p_id;
 FOR actor_lock IN SELECT DISTINCT x FROM unnest(ARRAY[p_actor,owner_id])x WHERE x IS NOT NULL ORDER BY x LOOP PERFORM pg_advisory_xact_lock(hashtextextended(actor_lock::text,20260903204500));END LOOP;
 IF NOT kova_private.custom_kova_principal_current(p_actor) THEN RAISE EXCEPTION 'custom_kova_denied' USING ERRCODE='42501';END IF;
 SELECT * INTO k FROM public.custom_kovas WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR k.revision<>p_revision THEN RAISE EXCEPTION 'custom_kova_conflict' USING ERRCODE='40001';END IF;
 IF p_action IN('block','restore') THEN
  UPDATE public.custom_kovas SET blocked=p_action='block',publication_epoch=gen_random_uuid(),revision=revision+1,updated_at=now() WHERE id=k.id RETURNING * INTO k;
  DELETE FROM public.custom_kova_link_grants WHERE kova_id=k.id;
 ELSE
  IF p_report IS NULL OR NOT EXISTS(SELECT 1 FROM public.custom_kova_reports WHERE id=p_report AND kova_id=k.id AND status='open') THEN RAISE EXCEPTION 'custom_kova_report_changed' USING ERRCODE='40001';END IF;
  UPDATE public.custom_kova_reports SET status='reviewed',reviewed_at=now() WHERE id=p_report AND kova_id=k.id AND status='open';
  UPDATE public.custom_kovas SET revision=revision+1,updated_at=now() WHERE id=k.id RETURNING * INTO k;
 END IF;
 DELETE FROM public.custom_kova_moderation_events WHERE kova_id=k.id AND created_at<now()-interval '180 days';
 IF (SELECT count(*) FROM public.custom_kova_moderation_events WHERE kova_id=k.id)>=1000 THEN RAISE EXCEPTION 'custom_kova_review_limit' USING ERRCODE='54000';END IF;
 INSERT INTO public.custom_kova_moderation_events(kova_id,actor_id,action,reason) VALUES(k.id,p_actor,p_action,p_reason);
 RETURN jsonb_build_object('id',k.id,'revision',k.revision,'blocked',k.blocked);
END;$$;
REVOKE ALL ON FUNCTION public.read_custom_kovas(uuid,text,uuid,uuid,uuid),public.resolve_custom_kova(uuid,uuid,uuid),public.mutate_custom_kova(uuid,uuid,uuid,bigint,text,jsonb,bigint,timestamptz),public.moderate_custom_kova(uuid,uuid,bigint,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_custom_kovas(uuid,text,uuid,uuid,uuid),public.resolve_custom_kova(uuid,uuid,uuid),public.mutate_custom_kova(uuid,uuid,uuid,bigint,text,jsonb,bigint,timestamptz),public.moderate_custom_kova(uuid,uuid,bigint,text,text,uuid) TO service_role;

CREATE FUNCTION public.read_custom_kova_reports(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE rows jsonb;
BEGIN
 IF NOT kova_private.custom_kova_principal_current(p_actor) THEN RAISE EXCEPTION 'custom_kova_denied' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at,r.id),'[]') INTO rows FROM(
  SELECT r.id,r.kova_id,r.reason,r.created_at,r.version_id,k.revision,k.blocked,r.version_name AS name
  FROM public.custom_kova_reports r JOIN public.custom_kovas k ON k.id=r.kova_id
  WHERE r.status='open' ORDER BY r.created_at,r.id LIMIT 20)r;
 RETURN jsonb_build_object('rows',rows);
END;$$;
REVOKE ALL ON FUNCTION public.read_custom_kova_reports(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_custom_kova_reports(uuid) TO service_role;

-- Export omits the active link capability verifier. Every body is size-bounded
-- at admission and the account exporter reads bounded pages cumulatively.
CREATE VIEW public.custom_kova_export_rows WITH(security_invoker=true) AS
 SELECT id,owner_id,revision,head_version,publication_version,visibility,blocked,created_at,updated_at FROM public.custom_kovas;
REVOKE ALL ON public.custom_kova_export_rows FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.custom_kova_export_rows TO service_role;

-- Configured moderators may inspect only the published version, never an
-- unpublished owner draft or the author's live Library/account connections.
CREATE FUNCTION public.read_custom_kova_moderation(p_actor uuid,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE k public.custom_kovas;v public.custom_kova_versions;
BEGIN
 IF NOT kova_private.custom_kova_principal_current(p_actor) THEN RAISE EXCEPTION 'custom_kova_denied' USING ERRCODE='42501';END IF;
 SELECT * INTO k FROM public.custom_kovas WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'custom_kova_unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO v FROM public.custom_kova_versions WHERE id=k.publication_version;
 RETURN jsonb_build_object('kova_id',k.id,'revision',k.revision,'blocked',k.blocked,'name',coalesce(v.config->>'name','Unpublished Kova'),'version_id',v.id,'config',v.config,'knowledge',v.knowledge);
END;$$;
REVOKE ALL ON FUNCTION public.read_custom_kova_moderation(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_custom_kova_moderation(uuid,uuid) TO service_role;
