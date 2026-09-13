-- Canonical ordinary-chat snapshots. Temporary chats have no admission path.
CREATE TABLE public.chat_history_counters (
 owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 epoch uuid NOT NULL DEFAULT gen_random_uuid(), current_version bigint NOT NULL DEFAULT 0,
 bytes_used bigint NOT NULL DEFAULT 0 CHECK(bytes_used BETWEEN 0 AND 52428800)
);
CREATE TABLE public.chat_history_records (
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 id text NOT NULL CHECK(length(id) BETWEEN 1 AND 200 AND id ~ '^[A-Za-z0-9._:-]+$' AND id NOT IN('__proto__','constructor','prototype')),
 payload jsonb, archived boolean NOT NULL DEFAULT false, revision bigint NOT NULL,
 sync_version bigint NOT NULL, mutation_id uuid NOT NULL,
 size_bytes integer NOT NULL DEFAULT 0 CHECK(size_bytes BETWEEN 0 AND 4194304),
 deleted_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,id),
 CHECK((deleted_at IS NULL AND payload IS NOT NULL) OR (deleted_at IS NOT NULL AND payload IS NULL AND size_bytes=0))
);
CREATE INDEX chat_history_owner_cursor_idx ON public.chat_history_records(owner_id,sync_version);
CREATE TABLE public.chat_history_mutations (
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 mutation_id uuid NOT NULL, request_hash text NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,mutation_id)
);
ALTER TABLE public.chat_history_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_history_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_history_mutations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_history_counters,public.chat_history_records,public.chat_history_mutations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.chat_history_counters,public.chat_history_records,public.chat_history_mutations TO service_role;
GRANT SELECT ON public.chat_history_records TO authenticated;

CREATE FUNCTION kova_private.chat_history_principal_current(p_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_owner AND u.deleted_at IS NULL AND NOT coalesce(u.is_anonymous,false)
  AND (u.banned_until IS NULL OR u.banned_until<=now()))
 AND NOT EXISTS(SELECT 1 FROM public.banned_users WHERE user_id=p_owner)
 AND NOT EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_owner);
$$;
REVOKE ALL ON FUNCTION kova_private.chat_history_principal_current(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION kova_private.chat_history_principal_current(uuid) TO service_role;
CREATE FUNCTION kova_private.chat_history_reader_current()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT kova_private.chat_history_principal_current((SELECT auth.uid()));
$$;
REVOKE ALL ON FUNCTION kova_private.chat_history_reader_current() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION kova_private.chat_history_reader_current() TO authenticated;
CREATE POLICY chat_history_owner_read ON public.chat_history_records FOR SELECT TO authenticated
 USING(owner_id=(SELECT auth.uid()) AND (SELECT kova_private.chat_history_reader_current()));

CREATE FUNCTION public.read_chat_history_changes(p_owner uuid,p_epoch uuid DEFAULT NULL,p_after bigint DEFAULT 0,p_limit integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE counter public.chat_history_counters; items jsonb; next_version bigint; removed integer;
BEGIN
 IF p_owner IS NULL OR p_after IS NULL OR p_after<0 OR p_limit IS NULL OR p_limit<>1 THEN RAISE EXCEPTION 'chat_history_invalid' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,411));
 IF NOT kova_private.chat_history_principal_current(p_owner) THEN RAISE EXCEPTION 'chat_history_denied' USING ERRCODE='42501'; END IF;
 INSERT INTO public.chat_history_counters(owner_id) VALUES(p_owner) ON CONFLICT DO NOTHING;
 SELECT * INTO counter FROM public.chat_history_counters WHERE owner_id=p_owner FOR UPDATE;
 -- Old offline clients must perform an explicit conflict review after tombstone
 -- retirement, so a deleted chat can never be recreated by a stale retry.
 DELETE FROM public.chat_history_records WHERE owner_id=p_owner AND id IN(
  SELECT id FROM public.chat_history_records WHERE owner_id=p_owner AND deleted_at<now()-interval '90 days' ORDER BY deleted_at,id LIMIT 100);
 GET DIAGNOSTICS removed=ROW_COUNT;
 IF removed>0 THEN UPDATE public.chat_history_counters SET epoch=gen_random_uuid() WHERE owner_id=p_owner RETURNING * INTO counter; END IF;
 IF p_epoch IS DISTINCT FROM counter.epoch THEN p_after:=0; END IF;
 IF p_after>counter.current_version THEN RAISE EXCEPTION 'chat_history_invalid' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.sync_version),'[]'::jsonb),coalesce(max(r.sync_version),p_after)
 INTO items,next_version FROM(SELECT id,payload,archived,revision,sync_version,mutation_id,deleted_at FROM public.chat_history_records WHERE owner_id=p_owner AND sync_version>p_after ORDER BY sync_version LIMIT 1) r;
 RETURN jsonb_build_object('ownerId',p_owner,'epoch',counter.epoch,'reset',p_epoch IS DISTINCT FROM counter.epoch,'records',items,'nextCursor',next_version,'currentVersion',counter.current_version,'hasMore',EXISTS(SELECT 1 FROM public.chat_history_records WHERE owner_id=p_owner AND sync_version>next_version));
END;$$;

CREATE FUNCTION public.mutate_chat_history(p_owner uuid,p_epoch uuid,p_id text,p_mutation uuid,p_revision bigint,p_payload jsonb,p_archived boolean,p_storage_limit bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE counter public.chat_history_counters; current public.chat_history_records; receipt public.chat_history_mutations; fingerprint text; size integer:=0; delta bigint; result jsonb; v_revision bigint;
BEGIN
 IF p_owner IS NULL OR p_epoch IS NULL OR p_id IS NULL OR length(p_id) NOT BETWEEN 1 AND 200 OR p_id !~ '^[A-Za-z0-9._:-]+$' OR p_id IN('__proto__','constructor','prototype') OR p_mutation IS NULL OR p_revision IS NULL OR p_revision<0 OR p_archived IS NULL THEN RAISE EXCEPTION 'chat_history_invalid' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,411));
 IF NOT kova_private.chat_history_principal_current(p_owner) THEN RAISE EXCEPTION 'chat_history_denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO counter FROM public.chat_history_counters WHERE owner_id=p_owner FOR UPDATE;
 IF NOT FOUND OR p_epoch<>counter.epoch THEN RAISE EXCEPTION 'chat_history_epoch_changed' USING ERRCODE='40001'; END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('epoch',p_epoch,'id',p_id,'revision',p_revision,'payload',p_payload,'archived',p_archived)::text,'UTF8')),'hex');
 SELECT * INTO receipt FROM public.chat_history_mutations WHERE owner_id=p_owner AND mutation_id=p_mutation;
 IF FOUND THEN
  IF receipt.request_hash<>fingerprint THEN RAISE EXCEPTION 'chat_history_idempotency_conflict' USING ERRCODE='40001'; END IF;
  RETURN receipt.result;
 END IF;
 DELETE FROM public.chat_history_mutations WHERE owner_id=p_owner AND mutation_id IN(SELECT mutation_id FROM public.chat_history_mutations WHERE owner_id=p_owner AND created_at<now()-interval '8 days' ORDER BY created_at LIMIT 100);
 IF (SELECT count(*) FROM public.chat_history_mutations WHERE owner_id=p_owner)>=10000 THEN RAISE EXCEPTION 'chat_history_receipt_limit' USING ERRCODE='54000'; END IF;
 SELECT * INTO current FROM public.chat_history_records WHERE owner_id=p_owner AND id=p_id FOR UPDATE;
 IF coalesce(current.revision,0)<>p_revision THEN RAISE EXCEPTION 'chat_history_conflict' USING ERRCODE='40001'; END IF;
 IF p_payload IS NOT NULL THEN
  size:=octet_length(p_payload::text);
  IF jsonb_typeof(p_payload)<>'object' OR p_payload->>'id' IS DISTINCT FROM p_id OR p_payload->>'temporary'='true' OR size>4194304 OR jsonb_typeof(p_payload->'messages') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'messages')>1000 THEN RAISE EXCEPTION 'chat_history_invalid' USING ERRCODE='22023'; END IF;
  IF (current.id IS NULL OR current.deleted_at IS NOT NULL) AND (SELECT count(*) FROM public.chat_history_records WHERE owner_id=p_owner AND deleted_at IS NULL)>=1000 THEN RAISE EXCEPTION 'chat_history_capacity' USING ERRCODE='54000'; END IF;
 END IF;
 IF current.id IS NULL AND (SELECT count(*) FROM public.chat_history_records WHERE owner_id=p_owner)>=10000 THEN RAISE EXCEPTION 'chat_history_capacity' USING ERRCODE='54000'; END IF;
 delta:=size-coalesce(current.size_bytes,0);
 IF counter.bytes_used+delta>52428800 OR p_storage_limit IS NULL OR p_storage_limit<1 THEN RAISE EXCEPTION 'chat_history_storage_limit' USING ERRCODE='54000'; END IF;
 IF delta>0 AND NOT public.try_add_storage_bytes(p_owner,delta,p_storage_limit) THEN RAISE EXCEPTION 'chat_history_storage_limit' USING ERRCODE='54000'; END IF;
 IF delta<0 THEN UPDATE public.user_storage SET bytes_used=greatest(0,bytes_used+delta),updated_at=now() WHERE user_id=p_owner; END IF;
 UPDATE public.chat_history_counters SET current_version=current_version+1,bytes_used=bytes_used+delta WHERE owner_id=p_owner RETURNING * INTO counter;
 v_revision:=coalesce(current.revision,0)+1;
 INSERT INTO public.chat_history_records(owner_id,id,payload,archived,revision,sync_version,mutation_id,size_bytes,deleted_at)
 VALUES(p_owner,p_id,p_payload,p_archived,v_revision,counter.current_version,p_mutation,size,CASE WHEN p_payload IS NULL THEN now() ELSE NULL END)
 ON CONFLICT(owner_id,id) DO UPDATE SET payload=excluded.payload,archived=excluded.archived,revision=excluded.revision,sync_version=excluded.sync_version,mutation_id=excluded.mutation_id,size_bytes=excluded.size_bytes,deleted_at=excluded.deleted_at,updated_at=now();
 result:=jsonb_build_object('id',p_id,'revision',v_revision,'syncVersion',counter.current_version,'mutationId',p_mutation);
 INSERT INTO public.chat_history_mutations(owner_id,mutation_id,request_hash,result) VALUES(p_owner,p_mutation,fingerprint,result);
 RETURN result;
END;$$;
REVOKE ALL ON FUNCTION public.read_chat_history_changes(uuid,uuid,bigint,integer),public.mutate_chat_history(uuid,uuid,text,uuid,bigint,jsonb,boolean,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_chat_history_changes(uuid,uuid,bigint,integer),public.mutate_chat_history(uuid,uuid,text,uuid,bigint,jsonb,boolean,bigint) TO service_role;
