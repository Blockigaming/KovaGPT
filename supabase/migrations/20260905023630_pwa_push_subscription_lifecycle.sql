-- Web Push is disabled until a configured server worker records a heartbeat.
CREATE TABLE public.web_push_runtime (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), config_id text NOT NULL,
 heartbeat_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.web_push_preferences (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 quiet_hours jsonb, revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(quiet_hours IS NULL OR jsonb_typeof(quiet_hours)='object' AND octet_length(quiet_hours::text)<=500)
);
CREATE TABLE public.web_push_subscriptions (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 endpoint_hash text NOT NULL CHECK(endpoint_hash~'^[a-f0-9]{64}$'), sealed_subscription text,
 device_secret_hash text NOT NULL CHECK(device_secret_hash~'^[a-f0-9]{64}$'),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), active boolean NOT NULL DEFAULT true,
 consented_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
 cursor_at timestamptz NOT NULL DEFAULT now(), cursor_source text NOT NULL DEFAULT '', cursor_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
 next_attempt_at timestamptz NOT NULL DEFAULT now(), worker_id uuid, lease_expires_at timestamptz,
 event_at timestamptz, event_source text, event_id uuid, event_category text,
 CHECK(sealed_subscription IS NULL OR length(sealed_subscription) BETWEEN 20 AND 12000), CHECK(NOT active OR sealed_subscription IS NOT NULL)
);
CREATE UNIQUE INDEX web_push_active_endpoint ON public.web_push_subscriptions(endpoint_hash) WHERE active;
CREATE INDEX web_push_owner ON public.web_push_subscriptions(user_id,id);
CREATE INDEX web_push_delivery_due ON public.web_push_subscriptions(next_attempt_at,id) WHERE active;
ALTER TABLE public.web_push_runtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_push_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.web_push_runtime,public.web_push_preferences,public.web_push_subscriptions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.web_push_runtime,public.web_push_preferences,public.web_push_subscriptions TO service_role;

CREATE FUNCTION kova_private.web_push_identity_current(uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT uid IS NOT NULL AND EXISTS(SELECT 1 FROM auth.users WHERE id=uid AND deleted_at IS NULL AND email_confirmed_at IS NOT NULL AND NOT coalesce(is_anonymous,false) AND(banned_until IS NULL OR banned_until<=now()))
 AND NOT EXISTS(SELECT 1 FROM public.banned_users WHERE user_id=uid)
 AND NOT EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=uid)
$$;
CREATE FUNCTION kova_private.web_push_account_current(uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT kova_private.web_push_identity_current(uid) AND NOT EXISTS(SELECT 1 FROM public.user_preferences WHERE user_id=uid AND settings IS NOT NULL AND
   (jsonb_typeof(settings)<>'object' OR coalesce(settings->>'lockdown_mode','false')<>'false'))
$$;
REVOKE ALL ON FUNCTION kova_private.web_push_identity_current(uuid),kova_private.web_push_account_current(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION kova_private.web_push_identity_current(uuid),kova_private.web_push_account_current(uuid) TO service_role;

CREATE FUNCTION public.web_push_rpc(p_user_id uuid,p_operation text,p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET statement_timeout='5s' AS $$
DECLARE sub public.web_push_subscriptions; pref public.web_push_preferences; event record;
 worker uuid; quiet jsonb; category text; settings jsonb; current_config boolean;
BEGIN
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text)>20000 THEN RAISE EXCEPTION 'push_invalid_request'; END IF;
 IF p_operation='heartbeat' THEN
  IF NOT coalesce(p_data->>'configId'~'^[a-f0-9]{64}$',false) THEN RAISE EXCEPTION 'push_invalid_request'; END IF;
  INSERT INTO public.web_push_runtime(id,config_id)VALUES(true,p_data->>'configId') ON CONFLICT(id)DO UPDATE SET config_id=excluded.config_id,heartbeat_at=now();RETURN jsonb_build_object('ok',true);
 END IF;
 IF p_operation='prune' THEN
  WITH old AS(SELECT id FROM public.web_push_subscriptions WHERE NOT active AND revoked_at<now()-interval '7 days' ORDER BY revoked_at,id LIMIT 100)
   DELETE FROM public.web_push_subscriptions WHERE id IN(SELECT id FROM old);
  RETURN jsonb_build_object('ok',true);
 END IF;
 SELECT EXISTS(SELECT 1 FROM public.web_push_runtime WHERE id AND heartbeat_at>now()-interval '2 minutes' AND config_id=p_data->>'configId') INTO current_config;
 IF p_operation='revoke_device' THEN
  SELECT * INTO sub FROM public.web_push_subscriptions WHERE id=(p_data->>'id')::uuid AND device_secret_hash=p_data->>'deviceSecretHash';
  IF sub.id IS NULL THEN RETURN jsonb_build_object('ok',true); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(sub.user_id::text,20260903204500));
  UPDATE public.web_push_subscriptions SET active=false,sealed_subscription=NULL,revision=revision+1,revoked_at=now(),worker_id=NULL,lease_expires_at=NULL WHERE id=sub.id AND active;
  RETURN jsonb_build_object('ok',true);
 END IF;
 IF p_operation IN('claim','check','settle') THEN
  worker:=(p_data->>'workerId')::uuid;
  IF worker IS NULL THEN RAISE EXCEPTION 'push_invalid_request'; END IF;
  IF NOT current_config THEN RAISE EXCEPTION 'push_runtime_unavailable'; END IF;
  IF p_operation='claim' THEN
   SELECT * INTO sub FROM public.web_push_subscriptions WHERE active AND next_attempt_at<=now() AND(worker_id IS NULL OR lease_expires_at<=now())
    ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
   IF sub.id IS NULL THEN RETURN NULL; END IF;
   UPDATE public.web_push_subscriptions SET next_attempt_at=now()+interval '30 seconds' WHERE id=sub.id;
   IF NOT kova_private.web_push_account_current(sub.user_id) THEN RETURN jsonb_build_object('skipped',true); END IF;
   SELECT * INTO event FROM (
    SELECT created_at,'application'::text AS source,id,
     CASE WHEN type IN('task_result','task_failure','deep_research_complete','file_processing') THEN 'tasks'
      WHEN type IN('shared_chat','project_invitation','project_role_change') THEN 'projects' WHEN type='connector_reauth' THEN 'connectors'
      WHEN type IN('billing_issue','usage_threshold') THEN 'billing' ELSE 'security' END AS category
     FROM public.app_notifications WHERE owner_id=sub.user_id AND delivery_state='delivered' AND read_at IS NULL AND(expires_at IS NULL OR expires_at>now())
    UNION ALL
    SELECT created_at,'agent'::text AS source,id,'tasks'::text AS category FROM public.agent_notifications WHERE owner_id=sub.user_id AND read_at IS NULL AND expires_at>now()
   ) events WHERE created_at>=sub.consented_at AND created_at>now()-interval '1 day' AND(created_at,source,id)>(sub.cursor_at,sub.cursor_source,sub.cursor_id)
    ORDER BY created_at,source,id LIMIT 1;
   IF event.id IS NULL THEN RETURN jsonb_build_object('skipped',true); END IF;
   UPDATE public.web_push_subscriptions SET worker_id=worker,lease_expires_at=now()+interval '60 seconds',event_at=event.created_at,event_source=event.source,event_id=event.id,event_category=event.category WHERE id=sub.id RETURNING * INTO sub;
   RETURN jsonb_build_object('id',sub.id,'userId',sub.user_id,'revision',sub.revision,'sealed',sub.sealed_subscription,'eventId',sub.event_id,'eventSource',sub.event_source,'eventAt',sub.event_at);
  END IF;
  SELECT * INTO sub FROM public.web_push_subscriptions WHERE id=(p_data->>'id')::uuid;
  IF sub.id IS NULL THEN RAISE EXCEPTION 'push_subscription_changed'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(sub.user_id::text,20260903204500));
  SELECT * INTO sub FROM public.web_push_subscriptions WHERE id=sub.id FOR UPDATE;
  IF NOT sub.active OR sub.worker_id IS DISTINCT FROM worker OR NOT coalesce(sub.lease_expires_at>now(),false) OR sub.revision IS DISTINCT FROM(p_data->>'revision')::bigint THEN RAISE EXCEPTION 'push_subscription_changed'; END IF;
  IF p_operation='check' THEN
   IF NOT kova_private.web_push_account_current(sub.user_id) THEN RAISE EXCEPTION 'push_account_unavailable'; END IF;
   IF(sub.event_source='application' AND NOT EXISTS(SELECT 1 FROM public.app_notifications WHERE id=sub.event_id AND owner_id=sub.user_id AND delivery_state='delivered' AND read_at IS NULL AND(expires_at IS NULL OR expires_at>now())))
    OR(sub.event_source='agent' AND NOT EXISTS(SELECT 1 FROM public.agent_notifications WHERE id=sub.event_id AND owner_id=sub.user_id AND read_at IS NULL AND expires_at>now())) THEN RETURN jsonb_build_object('eligible',false,'skip',true); END IF;
   SELECT CASE WHEN in_app_enabled AND jsonb_typeof(categories)='object' THEN categories ELSE '{"disabled":true}'::jsonb END INTO settings FROM public.notification_preferences WHERE user_id=sub.user_id;
   IF coalesce(settings->>'disabled','false')='true' OR coalesce(settings->>sub.event_category,'true')<>'true' THEN RETURN jsonb_build_object('eligible',false,'skip',true); END IF;
   SELECT quiet_hours INTO quiet FROM public.web_push_preferences WHERE user_id=sub.user_id;
   RETURN jsonb_build_object('eligible',true,'quietHours',quiet);
  END IF;
  IF NOT coalesce(p_data->>'result' IN('sent','expired','retry','skip'),false) THEN RAISE EXCEPTION 'push_invalid_request'; END IF;
  UPDATE public.web_push_subscriptions SET
   cursor_at=CASE WHEN p_data->>'result' IN('sent','skip') THEN event_at ELSE cursor_at END,
   cursor_source=CASE WHEN p_data->>'result' IN('sent','skip') THEN event_source ELSE cursor_source END,
   cursor_id=CASE WHEN p_data->>'result' IN('sent','skip') THEN event_id ELSE cursor_id END,
   active=CASE WHEN p_data->>'result'='expired' THEN false ELSE active END,
   sealed_subscription=CASE WHEN p_data->>'result'='expired' THEN NULL ELSE sealed_subscription END,
   revoked_at=CASE WHEN p_data->>'result'='expired' THEN now() ELSE revoked_at END,
   next_attempt_at=now()+interval '1 minute',worker_id=NULL,lease_expires_at=NULL,event_at=NULL,event_source=NULL,event_id=NULL,event_category=NULL
   WHERE id=sub.id;
  RETURN jsonb_build_object('ok',true);
 END IF;
 IF p_user_id IS NULL THEN RAISE EXCEPTION 'push_account_unavailable'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text,20260903204500));
 IF p_operation<>'revoke' AND NOT kova_private.web_push_identity_current(p_user_id) THEN RAISE EXCEPTION 'push_account_unavailable'; END IF;
 SELECT * INTO pref FROM public.web_push_preferences WHERE user_id=p_user_id;
 IF p_operation='status' THEN
  RETURN jsonb_build_object('ready',current_config,'preferenceRevision',coalesce(pref.revision,0),'quietHours',pref.quiet_hours,'devices',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'revision',revision,'createdAt',created_at) ORDER BY created_at,id) FROM public.web_push_subscriptions WHERE user_id=p_user_id AND active),'[]'::jsonb));
 ELSIF p_operation='subscribe' THEN
  IF NOT kova_private.web_push_account_current(p_user_id) THEN RAISE EXCEPTION 'push_account_unavailable'; END IF;
  IF NOT current_config THEN RAISE EXCEPTION 'push_runtime_unavailable'; END IF;
  IF(SELECT count(*) FROM public.web_push_subscriptions WHERE user_id=p_user_id AND active)>=5 THEN RAISE EXCEPTION 'push_device_limit'; END IF;
  INSERT INTO public.web_push_subscriptions(id,user_id,endpoint_hash,sealed_subscription,device_secret_hash)VALUES((p_data->>'id')::uuid,p_user_id,p_data->>'endpointHash',p_data->>'sealed',p_data->>'deviceSecretHash');
  RETURN jsonb_build_object('id',p_data->>'id','revision',1);
 ELSIF p_operation='revoke' THEN
  UPDATE public.web_push_subscriptions SET active=false,sealed_subscription=NULL,revision=revision+1,revoked_at=now(),worker_id=NULL,lease_expires_at=NULL
   WHERE id=(p_data->>'id')::uuid AND user_id=p_user_id AND active AND revision=(p_data->>'expectedRevision')::bigint;
  IF NOT FOUND THEN RAISE EXCEPTION 'push_subscription_changed'; END IF;
  RETURN jsonb_build_object('ok',true);
 ELSIF p_operation='preferences' THEN
  IF coalesce(pref.revision,0) IS DISTINCT FROM(p_data->>'expectedRevision')::bigint THEN RAISE EXCEPTION 'push_preferences_changed'; END IF;
  quiet:=nullif(p_data->'quietHours','null'::jsonb);
  IF quiet IS NOT NULL AND(jsonb_typeof(quiet)<>'object' OR NOT coalesce(quiet->>'start'~'^([01][0-9]|2[0-3]):[0-5][0-9]$',false) OR NOT coalesce(quiet->>'end'~'^([01][0-9]|2[0-3]):[0-5][0-9]$',false)
   OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=quiet->>'timeZone')) THEN RAISE EXCEPTION 'push_quiet_hours_invalid'; END IF;
  INSERT INTO public.web_push_preferences(user_id,quiet_hours)VALUES(p_user_id,quiet)ON CONFLICT(user_id)DO UPDATE SET quiet_hours=excluded.quiet_hours,revision=public.web_push_preferences.revision+1,updated_at=now();
  RETURN jsonb_build_object('ok',true);
 ELSE RAISE EXCEPTION 'push_invalid_operation'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.web_push_rpc(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.web_push_rpc(uuid,text,jsonb) TO service_role;
CREATE VIEW public.web_push_subscription_export_rows WITH(security_invoker=true) AS SELECT user_id,id,revision,active,consented_at,created_at,revoked_at FROM public.web_push_subscriptions;
REVOKE ALL ON public.web_push_subscription_export_rows FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.web_push_subscription_export_rows TO service_role;
