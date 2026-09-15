-- Permit every application-supported custom-Kova mode in the database validator.
-- Legacy identifiers remain accepted so existing immutable versions can be restored or forked.

CREATE OR REPLACE FUNCTION public.mutate_custom_kova(p_actor uuid,p_id uuid,p_mutation uuid,p_revision bigint,p_action text,p_payload jsonb,p_storage_limit bigint,p_requested_at timestamptz)
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
  IF jsonb_typeof(configuration) IS DISTINCT FROM 'object' OR coalesce(length(configuration->>'name'),0) NOT BETWEEN 1 AND 120 OR coalesce(length(configuration->>'instructions'),0) NOT BETWEEN 1 AND 12000 OR jsonb_typeof(configuration->'knowledge') IS DISTINCT FROM 'array' OR jsonb_array_length(configuration->'knowledge')>10 OR coalesce(configuration->>'mode','') NOT IN('instant','medium','thinking','high','extra_high','pro','max','ultra','kova_5_5','kova_5_4','kova_o3') THEN RAISE EXCEPTION 'custom_kova_invalid' USING ERRCODE='22023';END IF;
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
