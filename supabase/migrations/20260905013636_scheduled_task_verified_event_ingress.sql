CREATE TABLE public.scheduled_task_event_provider_readiness (
 provider text PRIMARY KEY CHECK(provider IN('gmail','slack','github')),active_config text,verified_config text,heartbeat_at timestamptz,verified_at timestamptz
);
ALTER TABLE public.scheduled_task_event_provider_readiness ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.scheduled_task_event_provider_readiness FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.scheduled_task_event_provider_readiness TO service_role;

-- Only minimal provider references enter this inbox; current grant tokens fetch
-- private content later. Native callback verification remains in server source.
CREATE TABLE public.scheduled_task_event_inbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),provider text NOT NULL CHECK(provider IN('gmail','slack','github')),
 event_key text NOT NULL CHECK(event_key~'^[a-f0-9]{64}$'),scope_key text NOT NULL CHECK(char_length(scope_key)<=320),
 resource text NOT NULL CHECK(char_length(resource) BETWEEN 1 AND 250),reference jsonb NOT NULL CHECK(jsonb_typeof(reference)='object' AND pg_column_size(reference)<=4096),
 occurred_at timestamptz NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','running','done','failed')),
 cursor_grant uuid,cursor_resource text NOT NULL DEFAULT '',worker_id uuid,lease_expires_at timestamptz,retry_at timestamptz NOT NULL DEFAULT now(),attempts integer NOT NULL DEFAULT 0,
 UNIQUE(provider,event_key)
);
CREATE INDEX scheduled_task_event_inbox_due ON public.scheduled_task_event_inbox(retry_at,id) WHERE state IN('pending','running');
CREATE TABLE public.scheduled_task_gmail_cursors (
 grant_id uuid PRIMARY KEY REFERENCES public.scheduled_task_connection_grants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,email text NOT NULL CHECK(char_length(email) BETWEEN 3 AND 320),
 history_id text NOT NULL CHECK(history_id~'^\d{1,30}$'),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),cursor_version bigint NOT NULL DEFAULT 1 CHECK(cursor_version>0),
 state text NOT NULL DEFAULT 'active' CHECK(state IN('active','disabled','resync_required')),
 page_state jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(page_state)='object' AND pg_column_size(page_state)<=16384),
 watch_consent boolean NOT NULL DEFAULT false,watch_expires_at timestamptz,
 worker_id uuid,lease_expires_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scheduled_task_gmail_email ON public.scheduled_task_gmail_cursors(email,grant_id) WHERE state='active';
ALTER TABLE public.scheduled_task_event_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_task_gmail_cursors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.scheduled_task_event_inbox,public.scheduled_task_gmail_cursors FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.scheduled_task_event_inbox,public.scheduled_task_gmail_cursors TO service_role;

CREATE FUNCTION public.scheduled_task_event_ingress_rpc(p_operation text,p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET statement_timeout='5s' AS $$
DECLARE item public.scheduled_task_event_inbox; g public.scheduled_task_connection_grants;
 cursor_row public.scheduled_task_gmail_cursors; worker uuid; grant_uuid uuid; uid uuid; result jsonb; target record;
BEGIN
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR pg_column_size(p_data)>32768 THEN RAISE EXCEPTION 'task_ingress_invalid'; END IF;
 IF p_operation IN('config_heartbeat','config_verified') THEN
  IF p_data->>'provider' NOT IN('gmail','slack','github') OR NOT coalesce((p_data->>'configId')~'^[a-f0-9]{64}$',false) THEN RAISE EXCEPTION 'task_ingress_invalid'; END IF;
  INSERT INTO public.scheduled_task_event_provider_readiness(provider) VALUES(p_data->>'provider') ON CONFLICT DO NOTHING;
  IF p_operation='config_heartbeat' THEN
   UPDATE public.scheduled_task_event_provider_readiness SET active_config=p_data->>'configId',heartbeat_at=now() WHERE provider=p_data->>'provider';
  ELSE UPDATE public.scheduled_task_event_provider_readiness SET verified_config=p_data->>'configId',verified_at=now() WHERE provider=p_data->>'provider'; END IF;
  RETURN jsonb_build_object('ok',true);
 ELSIF p_operation='enqueue' THEN
  PERFORM public.scheduled_task_event_ingress_rpc('config_verified',jsonb_build_object('provider',p_data->>'provider','configId',p_data->>'configId'));
  IF NOT EXISTS(SELECT 1 FROM public.scheduled_task_runtime WHERE id AND enabled AND p_data->>'provider'=ANY(enabled_event_providers)) THEN RAISE EXCEPTION 'task_events_unavailable'; END IF;
  -- Keep global inbox capacity exact under parallel native deliveries.
  PERFORM pg_advisory_xact_lock(hashtextextended('kova:task-event-inbox',20260905013636));
  IF EXISTS(SELECT 1 FROM public.scheduled_task_event_inbox WHERE provider=p_data->>'provider' AND event_key=p_data->>'eventKey') THEN RETURN jsonb_build_object('duplicate',true); END IF;
  IF (SELECT count(*) FROM public.scheduled_task_event_inbox WHERE state IN('pending','running'))>=5000 THEN RAISE EXCEPTION 'task_ingress_capacity'; END IF;
  IF (p_data->>'occurredAt')::timestamptz>now()+interval '5 minutes' OR (p_data->>'occurredAt')::timestamptz<now()-interval '24 hours' THEN RAISE EXCEPTION 'task_ingress_invalid'; END IF;
  INSERT INTO public.scheduled_task_event_inbox(provider,event_key,scope_key,resource,reference,occurred_at)
  VALUES(p_data->>'provider',p_data->>'eventKey',p_data->>'scopeKey',p_data->>'resource',p_data->'reference',(p_data->>'occurredAt')::timestamptz);
  RETURN jsonb_build_object('duplicate',false);
 ELSIF p_operation='claim' THEN
  worker:=(p_data->>'workerId')::uuid;IF worker IS NULL THEN RAISE EXCEPTION 'task_ingress_invalid'; END IF;
  SELECT i.* INTO item FROM public.scheduled_task_event_inbox i
   WHERE i.state IN('pending','running') AND i.retry_at<=now() AND (i.lease_expires_at IS NULL OR i.lease_expires_at<=now())
   AND EXISTS(SELECT 1 FROM public.scheduled_task_runtime WHERE id AND enabled AND i.provider=ANY(enabled_event_providers) AND heartbeat_at>now()-interval '5 minutes')
   ORDER BY i.retry_at,i.id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF item.id IS NULL THEN RETURN 'null'::jsonb; END IF;
  UPDATE public.scheduled_task_event_inbox SET state='running',worker_id=worker,lease_expires_at=now()+interval '120 seconds' WHERE id=item.id RETURNING * INTO item;
  RETURN to_jsonb(item);
 ELSIF p_operation IN('target','advance','release','retry') THEN
  worker:=(p_data->>'workerId')::uuid;
  SELECT * INTO item FROM public.scheduled_task_event_inbox WHERE id=(p_data->>'inboxId')::uuid FOR UPDATE;
  IF item.id IS NULL OR worker IS NULL OR item.worker_id IS DISTINCT FROM worker OR item.lease_expires_at<=now() OR item.state<>'running' THEN RAISE EXCEPTION 'task_ingress_lease_lost'; END IF;
  IF p_operation='target' THEN
   SELECT DISTINCT grants.*,ref.value->>'resource' AS trigger_resource INTO target
    FROM public.scheduled_task_connection_grants grants JOIN public.scheduled_tasks tasks ON tasks.user_id=grants.user_id
    CROSS JOIN LATERAL jsonb_array_elements(tasks.event_triggers) ref(value)
    LEFT JOIN public.scheduled_task_gmail_cursors gc ON gc.grant_id=grants.id
    WHERE grants.provider=item.provider AND grants.revoked_at IS NULL AND grants.expires_at>now() AND grants.granted_at<=item.occurred_at
    AND tasks.trigger_mode='event' AND tasks.status IN('scheduled','running') AND tasks.automation_consent_at<=item.occurred_at
    AND ref.value->>'grantId'=grants.id::text AND ref.value->>'provider'=item.provider
    AND (item.cursor_grant IS NULL OR (grants.id,ref.value->>'resource')>(item.cursor_grant,item.cursor_resource))
    AND CASE item.provider
     WHEN 'slack' THEN split_part(grants.provider_account_id,':',1)=item.scope_key AND ref.value->>'resource'=item.resource
     WHEN 'github' THEN lower(ref.value->>'resource') IN(item.resource,item.resource||'/'||(item.reference->>'pullNumber'))
     ELSE gc.state='active' AND gc.watch_consent AND gc.watch_expires_at>now() AND encode(sha256(convert_to(lower(gc.email),'UTF8')),'hex')=item.scope_key AND ref.value->>'resource'='inbox' END
    ORDER BY grants.id,trigger_resource LIMIT 1;
   IF NOT FOUND THEN
    UPDATE public.scheduled_task_event_inbox SET state='done',worker_id=NULL,lease_expires_at=NULL,reference='{}' WHERE id=item.id;
    RETURN 'null'::jsonb;
   END IF;
   RETURN to_jsonb(target);
  ELSIF p_operation='advance' THEN
   grant_uuid:=(p_data->>'grantId')::uuid;
   IF grant_uuid IS NULL OR coalesce(char_length(p_data->>'resource'),0) NOT BETWEEN 1 AND 250
    OR item.cursor_grant IS NOT NULL AND (grant_uuid,p_data->>'resource')<=(item.cursor_grant,item.cursor_resource) THEN RAISE EXCEPTION 'task_ingress_invalid'; END IF;
   UPDATE public.scheduled_task_event_inbox SET cursor_grant=grant_uuid,cursor_resource=p_data->>'resource',attempts=0 WHERE id=item.id;
  ELSIF p_operation='release' THEN
   UPDATE public.scheduled_task_event_inbox SET state='pending',worker_id=NULL,lease_expires_at=NULL,retry_at=now() WHERE id=item.id;
  ELSE
   UPDATE public.scheduled_task_event_inbox SET state=CASE WHEN attempts>=7 THEN 'failed' ELSE 'pending' END,
    attempts=attempts+1,retry_at=now()+make_interval(secs=>least(3600,5*power(2,least(attempts,9)))),worker_id=NULL,lease_expires_at=NULL WHERE id=item.id;
  END IF;
  RETURN jsonb_build_object('ok',true);
 ELSIF p_operation IN('source_list','source_init','source_watch_consent','source_disable','cursor_claim','cursor_save','cursor_release','cursor_resync','watch_saved') THEN
  uid:=(p_data->>'userId')::uuid;grant_uuid:=(p_data->>'grantId')::uuid;
  PERFORM kova_private.lock_scheduled_task_account(uid);
  IF p_operation='source_list' THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('grantId',grant_id,'email',email,'revision',revision,'state',state,'watchConsent',watch_consent,'watchExpiresAt',watch_expires_at) ORDER BY grant_id),'[]') INTO result FROM public.scheduled_task_gmail_cursors WHERE user_id=uid AND grant_id=grant_uuid;
   RETURN result;
  END IF;
  SELECT * INTO g FROM public.scheduled_task_connection_grants WHERE id=grant_uuid AND user_id=uid AND provider='gmail';
  IF g.id IS NULL THEN RAISE EXCEPTION 'task_connection_unavailable'; END IF;
  SELECT * INTO cursor_row FROM public.scheduled_task_gmail_cursors WHERE grant_id=g.id FOR UPDATE;
  IF p_operation='source_disable' THEN
   IF cursor_row.grant_id IS NULL OR cursor_row.revision IS DISTINCT FROM(p_data->>'expectedRevision')::bigint THEN RAISE EXCEPTION 'task_source_conflict'; END IF;
   UPDATE public.scheduled_task_gmail_cursors SET state='disabled',watch_consent=false,watch_expires_at=NULL,page_state='{}',revision=revision+1,cursor_version=cursor_version+1,worker_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE grant_id=g.id;
   RETURN jsonb_build_object('ok',true);
  END IF;
  IF NOT public.validate_scheduled_task_connection_grant(uid,g.id) THEN RAISE EXCEPTION 'task_connection_unavailable'; END IF;
  IF p_operation='source_watch_consent' THEN
   IF public.effective_user_plan_tier(uid) NOT IN('plus','pro') THEN RAISE EXCEPTION 'task_plan_required'; END IF;
   IF cursor_row.grant_id IS NULL OR cursor_row.state<>'active' OR cursor_row.revision IS DISTINCT FROM(p_data->>'expectedRevision')::bigint THEN RAISE EXCEPTION 'task_source_conflict'; END IF;
   UPDATE public.scheduled_task_gmail_cursors SET watch_consent=true,revision=revision+1,worker_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE grant_id=g.id RETURNING * INTO cursor_row;
   RETURN to_jsonb(cursor_row);
  END IF;
  IF p_operation='source_init' THEN
   IF public.effective_user_plan_tier(uid) NOT IN('plus','pro') THEN RAISE EXCEPTION 'task_plan_required'; END IF;
   IF coalesce(cursor_row.revision,0) IS DISTINCT FROM(p_data->>'expectedRevision')::bigint OR NOT coalesce((p_data->>'historyId')~'^\d{1,30}$',false) THEN RAISE EXCEPTION 'task_source_conflict'; END IF;
   INSERT INTO public.scheduled_task_gmail_cursors(grant_id,user_id,email,history_id,watch_consent)
    VALUES(g.id,uid,lower(p_data->>'email'),p_data->>'historyId',coalesce((p_data->>'watchConsent')::boolean,false))
    ON CONFLICT(grant_id) DO UPDATE SET email=excluded.email,history_id=excluded.history_id,watch_consent=excluded.watch_consent,
     state='active',page_state='{}',watch_expires_at=NULL,revision=public.scheduled_task_gmail_cursors.revision+1,cursor_version=public.scheduled_task_gmail_cursors.cursor_version+1,worker_id=NULL,lease_expires_at=NULL,updated_at=now() RETURNING * INTO cursor_row;
   RETURN to_jsonb(cursor_row);
  END IF;
  IF cursor_row.grant_id IS NULL OR cursor_row.state<>'active' THEN RAISE EXCEPTION 'task_source_unavailable'; END IF;
  worker:=(p_data->>'workerId')::uuid;
  IF p_operation='cursor_claim' THEN
   IF worker IS NULL THEN RAISE EXCEPTION 'task_ingress_invalid'; END IF;
   IF cursor_row.worker_id IS NOT NULL AND cursor_row.lease_expires_at>now() THEN RETURN jsonb_build_object('busy',true); END IF;
   UPDATE public.scheduled_task_gmail_cursors SET worker_id=worker,lease_expires_at=now()+interval '120 seconds' WHERE grant_id=g.id RETURNING * INTO cursor_row;
   RETURN to_jsonb(cursor_row);
  END IF;
  IF p_operation='watch_saved' THEN
   IF cursor_row.revision IS DISTINCT FROM(p_data->>'expectedRevision')::bigint OR NOT cursor_row.watch_consent OR worker IS NULL OR cursor_row.worker_id IS DISTINCT FROM worker OR cursor_row.lease_expires_at<=now() OR NOT coalesce((p_data->>'expiresAt')::timestamptz>now() AND(p_data->>'expiresAt')::timestamptz<=now()+interval '8 days',false) THEN RAISE EXCEPTION 'task_source_conflict'; END IF;
   UPDATE public.scheduled_task_gmail_cursors SET watch_expires_at=(p_data->>'expiresAt')::timestamptz,updated_at=now() WHERE grant_id=g.id;
   RETURN jsonb_build_object('ok',true);
  END IF;
  IF worker IS NULL OR cursor_row.worker_id IS DISTINCT FROM worker OR cursor_row.lease_expires_at<=now() OR cursor_row.revision IS DISTINCT FROM(p_data->>'expectedRevision')::bigint OR cursor_row.cursor_version IS DISTINCT FROM(p_data->>'expectedCursorVersion')::bigint THEN RAISE EXCEPTION 'task_source_conflict'; END IF;
  IF p_operation='cursor_save' THEN
   IF NOT coalesce((p_data->>'historyId')~'^\d{1,30}$',false) OR(p_data->>'historyId')::numeric<cursor_row.history_id::numeric OR jsonb_typeof(p_data->'pageState') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'task_ingress_invalid'; END IF;
   UPDATE public.scheduled_task_gmail_cursors SET history_id=p_data->>'historyId',page_state=p_data->'pageState',cursor_version=cursor_version+1,updated_at=now() WHERE grant_id=g.id RETURNING * INTO cursor_row;
   RETURN to_jsonb(cursor_row);
  ELSIF p_operation='cursor_resync' THEN
   UPDATE public.scheduled_task_gmail_cursors SET state='resync_required',page_state='{}',revision=revision+1,cursor_version=cursor_version+1,worker_id=NULL,lease_expires_at=NULL,updated_at=now() WHERE grant_id=g.id;
  ELSE
   UPDATE public.scheduled_task_gmail_cursors SET worker_id=NULL,lease_expires_at=NULL WHERE grant_id=g.id;
  END IF;
  RETURN jsonb_build_object('ok',true);
 ELSIF p_operation='watch_candidates' THEN
  SELECT coalesce(jsonb_agg(row),'[]'::jsonb) INTO result FROM (
   SELECT g.*,c.revision FROM public.scheduled_task_gmail_cursors c JOIN public.scheduled_task_connection_grants g ON g.id=c.grant_id
   WHERE c.state='active' AND c.watch_consent AND (c.watch_expires_at IS NULL OR c.watch_expires_at<now()+interval '1 day')
    AND g.revoked_at IS NULL AND g.expires_at>now() AND (c.lease_expires_at IS NULL OR c.lease_expires_at<=now())
   ORDER BY c.watch_expires_at NULLS FIRST,c.grant_id LIMIT 2
  ) row;
  RETURN result;
 ELSIF p_operation='prune' THEN
  WITH old AS(SELECT id FROM public.scheduled_task_event_inbox WHERE received_at<now()-interval '7 days' ORDER BY received_at,id LIMIT 500 FOR UPDATE SKIP LOCKED)
   DELETE FROM public.scheduled_task_event_inbox i USING old WHERE i.id=old.id;
  RETURN jsonb_build_object('ok',true);
 ELSE RAISE EXCEPTION 'task_ingress_invalid'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.scheduled_task_event_ingress_rpc(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.scheduled_task_event_ingress_rpc(text,jsonb) TO service_role;

CREATE FUNCTION public.scheduled_task_event_grant_ready(p_grant_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE g public.scheduled_task_connection_grants;BEGIN
 SELECT * INTO g FROM public.scheduled_task_connection_grants WHERE id=p_grant_id;
 IF g.id IS NULL OR NOT public.validate_scheduled_task_connection_grant(g.user_id,g.id) THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.scheduled_task_runtime WHERE id AND enabled AND g.provider=ANY(enabled_event_providers) AND heartbeat_at>now()-interval '5 minutes') OR
 NOT EXISTS(SELECT 1 FROM public.scheduled_task_event_provider_readiness WHERE provider=g.provider AND active_config=verified_config AND heartbeat_at>now()-interval '5 minutes') THEN RETURN false; END IF;
 RETURN g.provider<>'gmail' OR EXISTS(SELECT 1 FROM public.scheduled_task_gmail_cursors WHERE grant_id=g.id AND state='active' AND watch_consent AND watch_expires_at>now());
END $$;
REVOKE ALL ON FUNCTION public.scheduled_task_event_grant_ready(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.scheduled_task_event_grant_ready(uuid) TO service_role;

CREATE VIEW public.scheduled_task_event_source_export_rows WITH(security_invoker=true) AS
 SELECT user_id,grant_id,email,state,watch_consent,watch_expires_at,created_at,updated_at FROM public.scheduled_task_gmail_cursors;
REVOKE ALL ON public.scheduled_task_event_source_export_rows FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.scheduled_task_event_source_export_rows TO service_role;
