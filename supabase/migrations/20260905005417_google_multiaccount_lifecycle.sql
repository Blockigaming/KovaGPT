-- Google connections remain server-only; no credential privilege is granted to browsers.
ALTER TABLE public.google_oauth_tokens DROP CONSTRAINT google_oauth_tokens_pkey;
ALTER TABLE public.google_oauth_tokens ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.google_oauth_tokens ADD PRIMARY KEY(id);
ALTER TABLE public.google_oauth_tokens ADD UNIQUE(user_id,google_sub);
ALTER TABLE public.google_oauth_tokens ADD COLUMN grant_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.google_oauth_tokens ADD COLUMN credential_revision bigint NOT NULL DEFAULT 1;
ALTER TABLE public.google_oauth_tokens ADD COLUMN identity_verified boolean NOT NULL DEFAULT false;
ALTER TABLE public.google_oauth_tokens ADD COLUMN revoked_at timestamptz;
ALTER TABLE public.google_oauth_tokens ADD COLUMN reauthorization_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.google_oauth_tokens ADD COLUMN refresh_request_id uuid;
ALTER TABLE public.google_oauth_tokens ADD COLUMN refresh_lease_expires_at timestamptz;
CREATE INDEX google_connections_owner ON public.google_oauth_tokens(user_id,id);
REVOKE ALL ON public.google_oauth_tokens FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.google_oauth_tokens TO service_role;

CREATE TABLE public.google_connection_preferences (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 selected_connection_id uuid REFERENCES public.google_oauth_tokens(id) ON DELETE SET NULL,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0)
);
-- Existing single-account selections retain their identity. Every access/refresh
-- verifies legacy token identity before it can reach a provider resource.
INSERT INTO public.google_connection_preferences(user_id,selected_connection_id)
 SELECT user_id,id FROM public.google_oauth_tokens;
CREATE TABLE public.google_oauth_attempts (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 target_connection_id uuid REFERENCES public.google_oauth_tokens(id) ON DELETE CASCADE,
 target_grant_id uuid,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
 closed boolean NOT NULL DEFAULT false
);
CREATE INDEX google_oauth_attempts_owner_expiry ON public.google_oauth_attempts(user_id,expires_at);
ALTER TABLE public.google_connection_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_oauth_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_connection_preferences,public.google_oauth_attempts FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.google_connection_preferences,public.google_oauth_attempts TO service_role;

CREATE FUNCTION public.google_connection_rpc(p_user_id uuid,p_operation text,p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET statement_timeout='8s' AS $$
DECLARE conn public.google_oauth_tokens; pref public.google_connection_preferences;
 attempt public.google_oauth_attempts; cid uuid; result_value jsonb; scope_value text;
BEGIN
 IF p_user_id IS NULL OR jsonb_typeof(p_data)<>'object' OR octet_length(p_data::text)>200000 THEN RAISE EXCEPTION 'google_invalid_request'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text,20260903204500));
 IF p_operation NOT IN('disconnect','disconnect_all') AND (
   NOT kova_private.auth_user_exists(p_user_id) OR EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_user_id)
 ) THEN RAISE EXCEPTION 'google_connection_unavailable'; END IF;
 SELECT * INTO pref FROM public.google_connection_preferences WHERE user_id=p_user_id;
 cid:=nullif(p_data->>'connectionId','')::uuid;
 IF p_operation='list' THEN
   RETURN jsonb_build_object('selectedConnectionId',pref.selected_connection_id,'selectionRevision',coalesce(pref.revision,0),
    'accounts',coalesce((SELECT jsonb_agg(a ORDER BY created_at,id) FROM (SELECT id,email,google_sub,grant_id,credential_revision,scopes,expires_at,identity_verified,reauthorization_required,created_at,
       refresh_token IS NOT NULL AS has_refresh_token FROM public.google_oauth_tokens WHERE user_id=p_user_id AND revoked_at IS NULL ORDER BY created_at,id LIMIT 10)a),'[]'::jsonb));
 ELSIF p_operation='begin_oauth' THEN
   DELETE FROM public.google_oauth_attempts WHERE user_id=p_user_id AND expires_at<now();
   IF (SELECT count(*) FROM public.google_oauth_attempts WHERE user_id=p_user_id AND NOT closed)>=8 THEN RAISE EXCEPTION 'google_oauth_attempt_limit'; END IF;
   IF cid IS NOT NULL THEN
     SELECT * INTO conn FROM public.google_oauth_tokens WHERE user_id=p_user_id AND id=cid;
     IF conn.id IS NULL THEN RAISE EXCEPTION 'google_connection_changed'; END IF;
   END IF;
   INSERT INTO public.google_oauth_attempts(id,user_id,target_connection_id,target_grant_id)
     VALUES((p_data->>'attemptId')::uuid,p_user_id,cid,conn.grant_id);
   RETURN jsonb_build_object('loginHint',conn.email);
 ELSIF p_operation='complete_oauth' THEN
   SELECT * INTO attempt FROM public.google_oauth_attempts WHERE user_id=p_user_id AND id=(p_data->>'attemptId')::uuid FOR UPDATE;
   IF attempt.id IS NULL OR attempt.closed OR attempt.expires_at<=now() THEN RAISE EXCEPTION 'google_oauth_attempt_closed'; END IF;
   IF coalesce(char_length(p_data->>'googleSub'),0) NOT BETWEEN 1 AND 255 OR coalesce(char_length(p_data->>'email'),0) NOT BETWEEN 3 AND 320
      OR coalesce(char_length(p_data->>'accessToken'),0) NOT BETWEEN 1 AND 64000 OR char_length(coalesce(p_data->>'refreshToken',''))>64000
      OR char_length(coalesce(p_data->>'scopes',''))>16000 OR (p_data->>'expiresAt') IS NULL OR (p_data->>'expiresAt')::timestamptz<=now() THEN RAISE EXCEPTION 'google_invalid_token_response'; END IF;
   IF attempt.target_connection_id IS NOT NULL THEN
     SELECT * INTO conn FROM public.google_oauth_tokens WHERE id=attempt.target_connection_id AND user_id=p_user_id;
     IF conn.id IS NULL OR conn.grant_id IS DISTINCT FROM attempt.target_grant_id OR (conn.google_sub IS NOT NULL AND conn.google_sub IS DISTINCT FROM (p_data->>'googleSub')) THEN RAISE EXCEPTION 'google_connection_changed'; END IF;
   ELSE
     SELECT * INTO conn FROM public.google_oauth_tokens WHERE user_id=p_user_id AND google_sub=p_data->>'googleSub';
   END IF;
   IF conn.id IS NULL THEN
     IF (SELECT count(*) FROM public.google_oauth_tokens WHERE user_id=p_user_id AND revoked_at IS NULL)>=10 OR (SELECT count(*) FROM public.google_oauth_tokens WHERE user_id=p_user_id)>=50 THEN RAISE EXCEPTION 'google_connection_limit'; END IF;
     INSERT INTO public.google_oauth_tokens(user_id,google_sub,email,access_token,refresh_token,expires_at,scopes,identity_verified)
       VALUES(p_user_id,p_data->>'googleSub',p_data->>'email',p_data->>'accessToken',p_data->>'refreshToken',(p_data->>'expiresAt')::timestamptz,coalesce(p_data->>'scopes',''),true) RETURNING * INTO conn;
   ELSE
     IF conn.revoked_at IS NOT NULL AND (SELECT count(*) FROM public.google_oauth_tokens WHERE user_id=p_user_id AND revoked_at IS NULL)>=10 THEN RAISE EXCEPTION 'google_connection_limit'; END IF;
     UPDATE public.google_oauth_tokens SET google_sub=p_data->>'googleSub',email=p_data->>'email',access_token=p_data->>'accessToken',
       refresh_token=coalesce(p_data->>'refreshToken',CASE WHEN revoked_at IS NULL AND google_sub IS NOT NULL THEN refresh_token END),
       expires_at=(p_data->>'expiresAt')::timestamptz,scopes=coalesce(p_data->>'scopes',''),identity_verified=true,
       revoked_at=NULL,reauthorization_required=false,grant_id=gen_random_uuid(),credential_revision=credential_revision+1,
       refresh_request_id=NULL,refresh_lease_expires_at=NULL WHERE id=conn.id RETURNING * INTO conn;
   END IF;
   -- Close older consent windows too: a later callback may not overwrite
   -- credentials installed by a completed connection or reauthorization.
   UPDATE public.google_oauth_attempts SET closed=true WHERE user_id=p_user_id AND NOT closed;
   IF pref.user_id IS NULL THEN
     INSERT INTO public.google_connection_preferences(user_id,selected_connection_id) VALUES(p_user_id,conn.id);
   ELSIF pref.selected_connection_id IS NULL AND (SELECT count(*) FROM public.google_oauth_tokens WHERE user_id=p_user_id AND revoked_at IS NULL)=1 THEN
     UPDATE public.google_connection_preferences SET selected_connection_id=conn.id,revision=revision+1 WHERE user_id=p_user_id;
   END IF;
   RETURN jsonb_build_object('id',conn.id,'grantId',conn.grant_id);
 ELSIF p_operation='select' THEN
   IF cid IS NULL OR (p_data->>'expectedRevision') IS NULL OR coalesce(pref.revision,0)<>(p_data->>'expectedRevision')::bigint THEN RAISE EXCEPTION 'google_selection_conflict'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.google_oauth_tokens WHERE user_id=p_user_id AND id=cid AND revoked_at IS NULL) THEN RAISE EXCEPTION 'google_connection_changed'; END IF;
   INSERT INTO public.google_connection_preferences(user_id,selected_connection_id) VALUES(p_user_id,cid)
     ON CONFLICT(user_id) DO UPDATE SET selected_connection_id=cid,revision=public.google_connection_preferences.revision+1;
   RETURN jsonb_build_object('ok',true);
 ELSIF p_operation IN('disconnect','disconnect_all') THEN
   IF p_operation='disconnect' AND (cid IS NULL OR (p_data->>'expectedRevision') IS NULL OR NOT EXISTS(SELECT 1 FROM public.google_oauth_tokens WHERE user_id=p_user_id AND id=cid AND credential_revision=(p_data->>'expectedRevision')::bigint)) THEN RAISE EXCEPTION 'google_connection_changed'; END IF;
   SELECT coalesce(jsonb_agg(jsonb_build_object('accessToken',access_token,'refreshToken',refresh_token)),'[]'::jsonb) INTO result_value
     FROM public.google_oauth_tokens WHERE user_id=p_user_id AND revoked_at IS NULL AND (p_operation='disconnect_all' OR id=cid);
   UPDATE public.google_oauth_tokens SET revoked_at=now(),access_token='',refresh_token=NULL,grant_id=gen_random_uuid(),
     credential_revision=credential_revision+1,refresh_request_id=NULL,refresh_lease_expires_at=NULL
     WHERE user_id=p_user_id AND revoked_at IS NULL AND (p_operation='disconnect_all' OR id=cid);
   UPDATE public.google_connection_preferences SET selected_connection_id=NULL,revision=revision+1
     WHERE user_id=p_user_id AND (p_operation='disconnect_all' OR selected_connection_id=cid);
   -- A consent window opened before a disconnect cannot restore that connection.
   UPDATE public.google_oauth_attempts SET closed=true WHERE user_id=p_user_id AND NOT closed;
   RETURN result_value;
 ELSIF p_operation IN('get','claim_refresh','complete_refresh','fail_refresh','verify_identity') THEN
   cid:=coalesce(cid,pref.selected_connection_id);
   SELECT * INTO conn FROM public.google_oauth_tokens WHERE user_id=p_user_id AND id=cid AND revoked_at IS NULL FOR UPDATE;
   IF conn.id IS NULL THEN RAISE EXCEPTION 'google_connection_changed'; END IF;
   IF p_data->>'grantId' IS NOT NULL AND conn.grant_id<>(p_data->>'grantId')::uuid THEN RAISE EXCEPTION 'google_connection_changed'; END IF;
   IF p_data->>'googleSub' IS NOT NULL AND conn.google_sub IS DISTINCT FROM(p_data->>'googleSub') THEN RAISE EXCEPTION 'google_connection_changed'; END IF;
   IF p_operation='get' THEN RETURN to_jsonb(conn); END IF;
   IF p_data->>'credentialRevision' IS NULL OR conn.credential_revision<>(p_data->>'credentialRevision')::bigint THEN RAISE EXCEPTION 'google_refresh_conflict'; END IF;
   IF p_operation='claim_refresh' THEN
     IF conn.refresh_request_id IS NOT NULL AND conn.refresh_lease_expires_at>now() THEN RETURN jsonb_build_object('state','busy'); END IF;
     IF conn.refresh_token IS NULL OR conn.reauthorization_required THEN RAISE EXCEPTION 'google_reauthorization_required'; END IF;
     UPDATE public.google_oauth_tokens SET refresh_request_id=(p_data->>'requestId')::uuid,refresh_lease_expires_at=now()+interval '45 seconds' WHERE id=cid;
     RETURN jsonb_build_object('state','claimed');
   ELSIF p_operation='verify_identity' THEN
     IF conn.google_sub IS DISTINCT FROM(p_data->>'verifiedSub') THEN RAISE EXCEPTION 'google_connection_changed'; END IF;
     IF coalesce(char_length(p_data->>'accessToken'),0) NOT BETWEEN 1 AND 64000 OR char_length(coalesce(p_data->>'refreshToken',''))>64000 THEN RAISE EXCEPTION 'google_invalid_token_response'; END IF;
     UPDATE public.google_oauth_tokens SET identity_verified=true,access_token=p_data->>'accessToken',refresh_token=p_data->>'refreshToken',credential_revision=credential_revision+1 WHERE id=cid RETURNING * INTO conn;
     RETURN to_jsonb(conn);
   END IF;
   IF conn.refresh_request_id IS NULL OR conn.refresh_request_id IS DISTINCT FROM (p_data->>'requestId')::uuid OR conn.refresh_lease_expires_at<=now() THEN RAISE EXCEPTION 'google_refresh_conflict'; END IF;
   IF p_operation='fail_refresh' THEN
     UPDATE public.google_oauth_tokens SET refresh_request_id=NULL,refresh_lease_expires_at=NULL,
       reauthorization_required=coalesce((p_data->>'reauthorize')::boolean,false) WHERE id=cid;
     RETURN jsonb_build_object('ok',true);
   END IF;
   IF conn.google_sub IS DISTINCT FROM(p_data->>'verifiedSub') OR coalesce(char_length(p_data->>'accessToken'),0) NOT BETWEEN 1 AND 64000 OR char_length(coalesce(p_data->>'refreshToken',''))>64000
      OR (p_data->>'expiresAt') IS NULL OR (p_data->>'expiresAt')::timestamptz<=now() THEN RAISE EXCEPTION 'google_invalid_token_response'; END IF;
   scope_value:=coalesce(p_data->>'scopes',conn.scopes);
   IF char_length(scope_value)>16000 THEN RAISE EXCEPTION 'google_invalid_token_response'; END IF;
   UPDATE public.google_oauth_tokens SET access_token=p_data->>'accessToken',refresh_token=coalesce(p_data->>'refreshToken',refresh_token),expires_at=(p_data->>'expiresAt')::timestamptz,
     grant_id=CASE WHEN scopes<>scope_value THEN gen_random_uuid() ELSE grant_id END,scopes=scope_value,
     credential_revision=credential_revision+1,identity_verified=true,reauthorization_required=false,
     refresh_request_id=NULL,refresh_lease_expires_at=NULL WHERE id=cid RETURNING * INTO conn;
   RETURN to_jsonb(conn);
 ELSE RAISE EXCEPTION 'google_invalid_operation'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.google_connection_rpc(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.google_connection_rpc(uuid,text,jsonb) TO service_role;

-- Credentials, refresh state, attempt IDs and internal grant generations are
-- excluded from the service-only account-export projection.
CREATE VIEW public.google_connection_export_rows WITH(security_invoker=true) AS
 SELECT user_id,id,google_sub,email,scopes,created_at,updated_at,expires_at,revoked_at
 FROM public.google_oauth_tokens;
REVOKE ALL ON public.google_connection_export_rows FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.google_connection_export_rows TO service_role;
