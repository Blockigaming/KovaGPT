-- Tenant-scoped SCIM directory provisioning. Disabled until an organization
-- owner explicitly issues a token for its configured SSO provider.
CREATE TABLE public.organization_scim_configs (
 organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
 provider_id uuid NOT NULL, issued_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 token_hash text CHECK(token_hash~'^[a-f0-9]{64}$'), enabled boolean NOT NULL DEFAULT false,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(NOT enabled OR token_hash IS NOT NULL AND issued_by IS NOT NULL AND expires_at IS NOT NULL)
);
CREATE UNIQUE INDEX organization_scim_provider_enabled ON public.organization_scim_configs(provider_id) WHERE enabled;
CREATE TABLE public.organization_scim_users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organization_scim_configs(organization_id) ON DELETE CASCADE,
 external_id text NOT NULL CHECK(length(external_id) BETWEEN 1 AND 250),user_name text NOT NULL CHECK(length(user_name) BETWEEN 3 AND 254),display_name text NOT NULL DEFAULT '' CHECK(length(display_name)<=100),
 active boolean NOT NULL DEFAULT true,user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id)
);
CREATE UNIQUE INDEX organization_scim_user_external ON public.organization_scim_users(organization_id,external_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX organization_scim_user_name ON public.organization_scim_users(organization_id,user_name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX organization_scim_bound_identity ON public.organization_scim_users(organization_id,user_id) WHERE user_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX organization_scim_user_account ON public.organization_scim_users(user_id,id) WHERE user_id IS NOT NULL;
CREATE TABLE public.organization_scim_groups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organization_scim_configs(organization_id) ON DELETE CASCADE,
 external_id text NOT NULL CHECK(length(external_id) BETWEEN 1 AND 250),display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 100),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,id)
);
CREATE UNIQUE INDEX organization_scim_group_external ON public.organization_scim_groups(organization_id,external_id) WHERE deleted_at IS NULL;
CREATE TABLE public.organization_scim_group_members (
 organization_id uuid NOT NULL,group_id uuid NOT NULL,user_id uuid NOT NULL,
 PRIMARY KEY(group_id,user_id),
 FOREIGN KEY(organization_id,group_id) REFERENCES public.organization_scim_groups(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY(organization_id,user_id) REFERENCES public.organization_scim_users(organization_id,id) ON DELETE CASCADE
);
ALTER TABLE public.organization_members ADD COLUMN scim_user_id uuid REFERENCES public.organization_scim_users(id) ON DELETE SET NULL;
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['organization_scim_configs','organization_scim_users','organization_scim_groups','organization_scim_group_members'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
END LOOP;END$$;

CREATE FUNCTION kova_private.organization_scim_actor_current(uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT uid IS NOT NULL AND EXISTS(SELECT 1 FROM auth.users WHERE id=uid AND deleted_at IS NULL AND email_confirmed_at IS NOT NULL AND NOT coalesce(is_anonymous,false) AND(banned_until IS NULL OR banned_until<=now()))
 AND NOT EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=uid) AND NOT EXISTS(SELECT 1 FROM public.banned_users WHERE user_id=uid)
 AND NOT EXISTS(SELECT 1 FROM public.user_preferences WHERE user_id=uid AND settings IS NOT NULL AND(jsonb_typeof(settings)<>'object' OR coalesce(settings->>'lockdown_mode','false')<>'false'))
$$;
CREATE FUNCTION kova_private.organization_scim_identity(pid uuid,subject text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN count(*)=1 THEN(array_agg(i.user_id))[1] ELSE NULL END FROM auth.identities i
 WHERE i.provider='sso:'||pid::text AND i.provider_id=subject AND i.identity_data->>'sub'=subject AND kova_private.organization_scim_actor_current(i.user_id)
$$;
CREATE FUNCTION kova_private.organization_scim_subjects(uid uuid) RETURNS TABLE(provider_id uuid,subject text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT substring(i.provider from 5)::uuid,i.provider_id FROM auth.identities i WHERE i.user_id=uid AND i.provider~'^sso:[a-f0-9-]{36}$' AND i.identity_data->>'sub'=i.provider_id AND kova_private.organization_scim_actor_current(uid)
$$;
CREATE FUNCTION kova_private.organization_scim_config_current(oid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.organization_scim_configs c JOIN public.organizations o ON o.id=c.organization_id
 JOIN public.organization_members m ON m.organization_id=o.id AND m.user_id=c.issued_by AND m.role='owner' AND m.revoked_at IS NULL
 JOIN public.organization_sso_connections s ON s.organization_id=o.id AND s.provider_id=c.provider_id AND s.state='configured'
 JOIN public.organization_domains d ON d.id=s.domain_id AND d.organization_id=o.id AND d.state='verified' AND d.verification_expires_at>now()
 WHERE c.organization_id=oid AND c.enabled AND c.expires_at>now() AND o.state='active' AND kova_private.organization_scim_actor_current(c.issued_by))
$$;
REVOKE ALL ON FUNCTION kova_private.organization_scim_actor_current(uuid),kova_private.organization_scim_identity(uuid,text),kova_private.organization_scim_subjects(uuid),kova_private.organization_scim_config_current(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION kova_private.organization_scim_actor_current(uuid),kova_private.organization_scim_identity(uuid,text),kova_private.organization_scim_subjects(uuid),kova_private.organization_scim_config_current(uuid) TO service_role;

-- Manual membership/role changes take precedence over IdP provisioning. A
-- later SCIM refresh can never undo a manually revoked or reassigned role.
CREATE FUNCTION kova_private.organization_scim_manual_override() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.scim_user_id IS NOT NULL AND current_setting('kova.scim_user',true) IS DISTINCT FROM OLD.scim_user_id::text
 AND(NEW.role IS DISTINCT FROM OLD.role OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN NEW.scim_user_id:=NULL;END IF;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION kova_private.organization_scim_manual_override() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER organization_scim_manual_override BEFORE UPDATE ON public.organization_members FOR EACH ROW EXECUTE FUNCTION kova_private.organization_scim_manual_override();
-- Auth erasure disables the sponsoring credential before its FK becomes NULL.
-- Only IdP-managed memberships are revoked; manual roles remain untouched.
CREATE FUNCTION kova_private.organization_scim_scrub_deleted_sponsor() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE member record;
BEGIN
 IF OLD.issued_by IS NOT NULL AND NEW.issued_by IS NULL THEN
  NEW.enabled:=false;NEW.token_hash:=NULL;NEW.revision:=OLD.revision+1;NEW.updated_at:=now();
  FOR member IN SELECT user_id,scim_user_id FROM public.organization_members WHERE organization_id=OLD.organization_id AND scim_user_id IS NOT NULL ORDER BY user_id LOOP
   PERFORM set_config('kova.scim_user',member.scim_user_id::text,true);
   UPDATE public.organization_members SET revoked_at=coalesce(revoked_at,now()) WHERE organization_id=OLD.organization_id AND user_id=member.user_id AND scim_user_id=member.scim_user_id;
  END LOOP;PERFORM set_config('kova.scim_user','',true);
 END IF;RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION kova_private.organization_scim_scrub_deleted_sponsor() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER organization_scim_scrub_deleted_sponsor BEFORE UPDATE OF issued_by ON public.organization_scim_configs FOR EACH ROW EXECUTE FUNCTION kova_private.organization_scim_scrub_deleted_sponsor();
CREATE FUNCTION kova_private.organization_scim_scrub_deleted_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.user_id IS NOT NULL AND NEW.user_id IS NULL AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=OLD.user_id) THEN
  NEW.external_id:='deleted:'||NEW.id::text;NEW.user_name:='deleted-'||NEW.id::text||'@invalid.local';NEW.display_name:='';NEW.active:=false;NEW.deleted_at:=coalesce(NEW.deleted_at,now());NEW.revision:=OLD.revision+1;NEW.updated_at:=now();
 END IF;RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION kova_private.organization_scim_scrub_deleted_identity() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER organization_scim_scrub_deleted_identity BEFORE UPDATE OF user_id ON public.organization_scim_users FOR EACH ROW EXECUTE FUNCTION kova_private.organization_scim_scrub_deleted_identity();
CREATE FUNCTION kova_private.organization_scim_apply_membership(sid uuid) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE row public.organization_scim_users;member public.organization_members;
BEGIN
 SELECT * INTO row FROM public.organization_scim_users WHERE id=sid FOR UPDATE;
 IF row.id IS NULL OR row.user_id IS NULL THEN RETURN;END IF;
 SELECT * INTO member FROM public.organization_members WHERE organization_id=row.organization_id AND user_id=row.user_id FOR UPDATE;
 PERFORM set_config('kova.scim_user',row.id::text,true);
 IF row.active AND row.deleted_at IS NULL AND kova_private.organization_scim_config_current(row.organization_id) AND kova_private.organization_scim_actor_current(row.user_id) AND kova_private.organization_scim_identity((SELECT provider_id FROM public.organization_scim_configs WHERE organization_id=row.organization_id),row.external_id)=row.user_id THEN
  IF member.user_id IS NULL THEN
   IF(SELECT count(*) FROM public.organization_members WHERE organization_id=row.organization_id AND revoked_at IS NULL)>=100 OR(SELECT count(*) FROM public.organization_members WHERE user_id=row.user_id AND revoked_at IS NULL)>=100 THEN RAISE EXCEPTION 'scim_capacity' USING ERRCODE='54000';END IF;
   INSERT INTO public.organization_members(organization_id,user_id,role,scim_user_id)VALUES(row.organization_id,row.user_id,'member',row.id);
  ELSIF member.scim_user_id=row.id OR EXISTS(SELECT 1 FROM public.organization_scim_users old WHERE old.id=member.scim_user_id AND old.organization_id=row.organization_id AND old.user_id=row.user_id AND old.external_id=row.external_id AND old.deleted_at IS NOT NULL) THEN
   PERFORM set_config('kova.scim_user',member.scim_user_id::text,true);
   UPDATE public.organization_members SET revoked_at=NULL,role='member',scim_user_id=row.id WHERE organization_id=row.organization_id AND user_id=row.user_id;
  END IF;
 ELSE UPDATE public.organization_members SET revoked_at=coalesce(revoked_at,now()) WHERE organization_id=row.organization_id AND user_id=row.user_id AND scim_user_id=row.id;
 END IF;
 PERFORM set_config('kova.scim_user','',true);
END$$;
REVOKE ALL ON FUNCTION kova_private.organization_scim_apply_membership(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION kova_private.organization_scim_apply_membership(uuid) TO service_role;

CREATE FUNCTION public.organization_scim_admin_rpc(p_actor uuid,p_org uuid,p_operation text,p_data jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET statement_timeout='5s' AS $$
DECLARE cfg public.organization_scim_configs;provider uuid;row record;
BEGIN
 IF p_actor IS NULL OR p_org IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text)>2000 THEN RAISE EXCEPTION 'scim_invalid' USING ERRCODE='22023';END IF;
 PERFORM kova_private.lock_organization_accounts(array[p_actor]);
 PERFORM 1 FROM public.organizations WHERE id=p_org AND state='active' FOR UPDATE;
 IF NOT FOUND OR NOT kova_private.organization_scim_actor_current(p_actor) OR NOT EXISTS(SELECT 1 FROM public.organization_members WHERE organization_id=p_org AND user_id=p_actor AND role='owner' AND revoked_at IS NULL) THEN RAISE EXCEPTION 'scim_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO cfg FROM public.organization_scim_configs WHERE organization_id=p_org FOR UPDATE;
 SELECT s.provider_id INTO provider FROM public.organization_sso_connections s JOIN public.organization_domains d ON d.id=s.domain_id AND d.organization_id=p_org AND d.state='verified' AND d.verification_expires_at>now() WHERE s.organization_id=p_org AND s.state='configured';
 IF p_operation='status' THEN RETURN jsonb_build_object('revision',coalesce(cfg.revision,0),'enabled',coalesce(kova_private.organization_scim_config_current(p_org),false),'providerReady',provider IS NOT NULL,'providerId',provider,'domain',(SELECT to_jsonb(d) FROM public.organization_domains d JOIN public.organization_sso_connections s ON s.domain_id=d.id WHERE s.organization_id=p_org),'expiresAt',cfg.expires_at,
  'users',(SELECT count(*) FROM public.organization_scim_users WHERE organization_id=p_org AND deleted_at IS NULL),'groups',(SELECT count(*) FROM public.organization_scim_groups WHERE organization_id=p_org AND deleted_at IS NULL));END IF;
 IF coalesce(cfg.revision,0) IS DISTINCT FROM(p_data->>'expectedRevision')::bigint THEN RAISE EXCEPTION 'scim_revision_changed' USING ERRCODE='40001';END IF;
 IF p_operation='rotate' THEN
  IF provider IS NULL OR(cfg.provider_id IS NOT NULL AND cfg.provider_id<>provider) OR NOT coalesce(p_data->>'tokenHash'~'^[a-f0-9]{64}$',false) THEN RAISE EXCEPTION 'scim_provider_or_token_invalid' USING ERRCODE='22023';END IF;
  INSERT INTO public.organization_scim_configs(organization_id,provider_id,issued_by,token_hash,enabled,expires_at)VALUES(p_org,provider,p_actor,p_data->>'tokenHash',true,now()+interval '90 days')
   ON CONFLICT(organization_id)DO UPDATE SET issued_by=p_actor,token_hash=excluded.token_hash,enabled=true,expires_at=excluded.expires_at,revision=public.organization_scim_configs.revision+1,updated_at=now() RETURNING * INTO cfg;
 ELSIF p_operation='disable' THEN
  IF cfg.organization_id IS NULL THEN RAISE EXCEPTION 'scim_missing' USING ERRCODE='P0002';END IF;
  UPDATE public.organization_scim_configs SET enabled=false,token_hash=NULL,revision=revision+1,updated_at=now() WHERE organization_id=p_org RETURNING * INTO cfg;
  FOR row IN SELECT id,user_id FROM public.organization_scim_users WHERE organization_id=p_org AND user_id IS NOT NULL ORDER BY id LOOP
   PERFORM set_config('kova.scim_user',row.id::text,true);UPDATE public.organization_members SET revoked_at=coalesce(revoked_at,now()) WHERE organization_id=p_org AND user_id=row.user_id AND scim_user_id=row.id;
  END LOOP;PERFORM set_config('kova.scim_user','',true);
 ELSE RAISE EXCEPTION 'scim_invalid_operation' USING ERRCODE='22023';END IF;
 UPDATE public.organizations SET revision=revision+1,updated_at=now() WHERE id=p_org;
 INSERT INTO public.organization_audit_events(organization_id,actor_user_id,action,details)VALUES(p_org,p_actor,'scim_'||p_operation,jsonb_build_object('configurationRevision',cfg.revision));
 RETURN jsonb_build_object('revision',cfg.revision,'expiresAt',cfg.expires_at,'enabled',cfg.enabled);
END$$;

CREATE FUNCTION public.organization_scim_rpc(p_org uuid,p_token_hash text,p_operation text,p_data jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET statement_timeout='5s' AS $$
DECLARE cfg public.organization_scim_configs;u public.organization_scim_users;g public.organization_scim_groups;target uuid;ids uuid[];item jsonb;rows jsonb;total bigint;start_value integer;count_value integer;kind text;rev bigint;filter_field text;filter_value text;
BEGIN
 IF p_org IS NULL OR NOT coalesce(p_token_hash~'^[a-f0-9]{64}$',false) OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text)>32000 THEN RAISE EXCEPTION 'scim_invalid' USING ERRCODE='22023';END IF;
 SELECT * INTO cfg FROM public.organization_scim_configs WHERE organization_id=p_org AND token_hash=p_token_hash;
 IF cfg.organization_id IS NULL OR NOT kova_private.organization_scim_config_current(p_org) THEN RAISE EXCEPTION 'scim_unauthorized' USING ERRCODE='42501';END IF;
 kind:=p_data->>'kind';
 IF kind='Users' AND p_operation IN('create','replace','delete') THEN
  IF p_operation<>'create' THEN SELECT * INTO u FROM public.organization_scim_users WHERE organization_id=p_org AND id=(p_data->>'id')::uuid AND deleted_at IS NULL;END IF;
  target:=coalesce(u.user_id,kova_private.organization_scim_identity(cfg.provider_id,coalesce(u.external_id,p_data->'resource'->>'externalId')));
 END IF;
 ids:=array[cfg.issued_by,target];
 IF kind='Groups' AND p_operation IN('create','replace') THEN
  IF jsonb_typeof(p_data->'resource'->'members') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'resource'->'members')>100 THEN RAISE EXCEPTION 'scim_invalid_members' USING ERRCODE='22023';END IF;
  SELECT ids||coalesce(array_agg(user_id),'{}'::uuid[]) INTO ids FROM public.organization_scim_users WHERE organization_id=p_org AND id IN(SELECT(value->>'value')::uuid FROM jsonb_array_elements(p_data->'resource'->'members'));
 END IF;
 PERFORM kova_private.lock_organization_accounts(ids);
 PERFORM 1 FROM public.organizations WHERE id=p_org AND state='active' FOR UPDATE;
 SELECT * INTO cfg FROM public.organization_scim_configs WHERE organization_id=p_org AND token_hash=p_token_hash;
 IF cfg.organization_id IS NULL OR NOT kova_private.organization_scim_config_current(p_org) THEN RAISE EXCEPTION 'scim_unauthorized' USING ERRCODE='42501';END IF;
 IF p_operation='authorize' THEN RETURN jsonb_build_object('organizationId',p_org,'providerId',cfg.provider_id,'domain',(SELECT to_jsonb(d) FROM public.organization_domains d JOIN public.organization_sso_connections s ON s.domain_id=d.id WHERE s.organization_id=p_org));END IF;
 IF kind NOT IN('Users','Groups') OR kind IS NULL THEN RAISE EXCEPTION 'scim_missing' USING ERRCODE='P0002';END IF;
 IF p_operation='list' THEN
  start_value:=(p_data->>'startIndex')::integer;count_value:=(p_data->>'count')::integer;filter_field:=p_data->'filter'->>'field';filter_value:=p_data->'filter'->>'value';
  IF start_value IS NULL OR start_value NOT BETWEEN 1 AND 10001 OR count_value IS NULL OR count_value NOT BETWEEN 0 AND 100 OR(filter_field IS NOT NULL AND filter_field NOT IN('userName','externalId','displayName')) THEN RAISE EXCEPTION 'scim_invalid' USING ERRCODE='22023';END IF;
  IF kind='Users' THEN
   SELECT count(*) INTO total FROM public.organization_scim_users WHERE organization_id=p_org AND deleted_at IS NULL AND(filter_field IS NULL OR(filter_field='externalId' AND external_id=filter_value) OR(filter_field='userName' AND user_name=lower(filter_value)));
   SELECT coalesce(jsonb_agg(x ORDER BY x.id),'[]') INTO rows FROM(SELECT id,external_id,user_name,display_name,active,revision,created_at,updated_at FROM public.organization_scim_users WHERE organization_id=p_org AND deleted_at IS NULL AND(filter_field IS NULL OR(filter_field='externalId' AND external_id=filter_value) OR(filter_field='userName' AND user_name=lower(filter_value)))ORDER BY id OFFSET start_value-1 LIMIT count_value)x;
  ELSE
   SELECT count(*) INTO total FROM public.organization_scim_groups WHERE organization_id=p_org AND deleted_at IS NULL AND(filter_field IS NULL OR(filter_field='externalId' AND external_id=filter_value) OR(filter_field='displayName' AND lower(display_name)=lower(filter_value)));
   SELECT coalesce(jsonb_agg(x ORDER BY x.id),'[]') INTO rows FROM(SELECT id,external_id,display_name,revision,created_at,updated_at,(SELECT coalesce(jsonb_agg(user_id ORDER BY user_id),'[]') FROM public.organization_scim_group_members WHERE group_id=g.id) AS members FROM public.organization_scim_groups g WHERE organization_id=p_org AND deleted_at IS NULL AND(filter_field IS NULL OR(filter_field='externalId' AND external_id=filter_value) OR(filter_field='displayName' AND lower(display_name)=lower(filter_value)))ORDER BY id OFFSET start_value-1 LIMIT count_value)x;
  END IF;RETURN jsonb_build_object('rows',rows,'total',total);
 END IF;
 IF kind='Users' THEN
  IF p_operation='create' THEN
   IF(SELECT count(*) FROM public.organization_scim_users WHERE organization_id=p_org)>=1000 THEN RAISE EXCEPTION 'scim_capacity' USING ERRCODE='54000';END IF;
   INSERT INTO public.organization_scim_users(organization_id,external_id,user_name,display_name,active,user_id)VALUES(p_org,p_data->'resource'->>'externalId',lower(p_data->'resource'->>'userName'),coalesce(p_data->'resource'->>'displayName',''),(p_data->'resource'->>'active')::boolean,target)RETURNING * INTO u;
  ELSE
   SELECT * INTO u FROM public.organization_scim_users WHERE organization_id=p_org AND id=(p_data->>'id')::uuid AND deleted_at IS NULL FOR UPDATE;
   IF u.id IS NULL THEN RAISE EXCEPTION 'scim_missing' USING ERRCODE='P0002';END IF;
   IF p_operation<>'get' THEN
    IF u.revision IS DISTINCT FROM(p_data->>'expectedRevision')::bigint THEN RAISE EXCEPTION 'scim_revision_changed' USING ERRCODE='40001';END IF;
    IF p_operation='replace' THEN
     IF u.external_id IS DISTINCT FROM p_data->'resource'->>'externalId' THEN RAISE EXCEPTION 'scim_immutable_subject' USING ERRCODE='22023';END IF;
     UPDATE public.organization_scim_users SET user_name=lower(p_data->'resource'->>'userName'),display_name=coalesce(p_data->'resource'->>'displayName',''),active=(p_data->'resource'->>'active')::boolean,user_id=coalesce(user_id,target),revision=revision+1,updated_at=now() WHERE id=u.id RETURNING * INTO u;
    ELSIF p_operation='delete' THEN UPDATE public.organization_scim_users SET active=false,deleted_at=now(),revision=revision+1,updated_at=now() WHERE id=u.id RETURNING * INTO u;
     UPDATE public.organization_scim_groups SET revision=revision+1,updated_at=now() WHERE organization_id=p_org AND id IN(SELECT group_id FROM public.organization_scim_group_members WHERE user_id=u.id AND organization_id=p_org);
     DELETE FROM public.organization_scim_group_members WHERE user_id=u.id AND organization_id=p_org;
    ELSE RAISE EXCEPTION 'scim_invalid_operation' USING ERRCODE='22023';END IF;
   END IF;
  END IF;
  IF p_operation<>'get' THEN PERFORM kova_private.organization_scim_apply_membership(u.id);END IF;
  rows:=jsonb_build_object('id',u.id,'external_id',u.external_id,'user_name',u.user_name,'display_name',u.display_name,'active',u.active,'revision',u.revision,'created_at',u.created_at,'updated_at',u.updated_at);
 ELSE
  IF p_operation='create' THEN
   IF(SELECT count(*) FROM public.organization_scim_groups WHERE organization_id=p_org)>=1000 THEN RAISE EXCEPTION 'scim_capacity' USING ERRCODE='54000';END IF;
   INSERT INTO public.organization_scim_groups(organization_id,external_id,display_name)VALUES(p_org,p_data->'resource'->>'externalId',p_data->'resource'->>'displayName')RETURNING * INTO g;
  ELSE
   SELECT * INTO g FROM public.organization_scim_groups WHERE organization_id=p_org AND id=(p_data->>'id')::uuid AND deleted_at IS NULL FOR UPDATE;
   IF g.id IS NULL THEN RAISE EXCEPTION 'scim_missing' USING ERRCODE='P0002';END IF;
   IF p_operation<>'get' THEN
    IF g.revision IS DISTINCT FROM(p_data->>'expectedRevision')::bigint THEN RAISE EXCEPTION 'scim_revision_changed' USING ERRCODE='40001';END IF;
    IF p_operation='replace' THEN
     IF g.external_id IS DISTINCT FROM p_data->'resource'->>'externalId' THEN RAISE EXCEPTION 'scim_immutable_subject' USING ERRCODE='22023';END IF;
     UPDATE public.organization_scim_groups SET display_name=p_data->'resource'->>'displayName',revision=revision+1,updated_at=now() WHERE id=g.id RETURNING * INTO g;
    ELSIF p_operation='delete' THEN UPDATE public.organization_scim_groups SET deleted_at=now(),revision=revision+1,updated_at=now() WHERE id=g.id RETURNING * INTO g;
    ELSE RAISE EXCEPTION 'scim_invalid_operation' USING ERRCODE='22023';END IF;
   END IF;
  END IF;
  IF p_operation<>'get' THEN
   DELETE FROM public.organization_scim_group_members WHERE group_id=g.id;
   IF p_operation<>'delete' THEN
    FOR item IN SELECT value FROM jsonb_array_elements(p_data->'resource'->'members') LOOP
     IF NOT EXISTS(SELECT 1 FROM public.organization_scim_users WHERE organization_id=p_org AND id=(item->>'value')::uuid AND deleted_at IS NULL) THEN RAISE EXCEPTION 'scim_member_missing' USING ERRCODE='22023';END IF;
     INSERT INTO public.organization_scim_group_members(organization_id,group_id,user_id)VALUES(p_org,g.id,(item->>'value')::uuid);
    END LOOP;
   END IF;
  END IF;
  rows:=jsonb_build_object('id',g.id,'external_id',g.external_id,'display_name',g.display_name,'revision',g.revision,'created_at',g.created_at,'updated_at',g.updated_at,'members',(SELECT coalesce(jsonb_agg(user_id ORDER BY user_id),'[]') FROM public.organization_scim_group_members WHERE group_id=g.id));
 END IF;
 IF p_operation<>'get' THEN
  UPDATE public.organizations SET revision=revision+1,updated_at=now() WHERE id=p_org;
  INSERT INTO public.organization_audit_events(organization_id,actor_user_id,action,details)VALUES(p_org,cfg.issued_by,'scim_'||lower(kind)||'_'||p_operation,jsonb_build_object('resourceId',coalesce(u.id,g.id),'configurationRevision',cfg.revision));
 END IF;
 RETURN rows;
END$$;
REVOKE ALL ON FUNCTION public.organization_scim_admin_rpc(uuid,uuid,text,jsonb),public.organization_scim_rpc(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.organization_scim_admin_rpc(uuid,uuid,text,jsonb),public.organization_scim_rpc(uuid,text,text,jsonb) TO service_role;

CREATE FUNCTION public.reconcile_organization_scim_membership(p_user uuid) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET statement_timeout='5s' AS $$
DECLARE row record;users uuid[];count_value integer:=0;before_member jsonb;after_member jsonb;
BEGIN
 IF NOT kova_private.organization_scim_actor_current(p_user) THEN RETURN 0;END IF;
 SELECT array[p_user]||coalesce(array_agg(c.issued_by),'{}'::uuid[]) INTO users FROM public.organization_scim_users u JOIN public.organization_scim_configs c ON c.organization_id=u.organization_id WHERE u.deleted_at IS NULL AND(u.user_id=p_user OR u.user_id IS NULL AND EXISTS(SELECT 1 FROM kova_private.organization_scim_subjects(p_user) s WHERE s.provider_id=c.provider_id AND s.subject=u.external_id));
 PERFORM kova_private.lock_organization_accounts(users);
 FOR row IN SELECT u.id,u.organization_id,u.user_id,c.provider_id,u.external_id FROM public.organization_scim_users u JOIN public.organization_scim_configs c ON c.organization_id=u.organization_id
 WHERE u.deleted_at IS NULL AND(u.user_id=p_user OR u.user_id IS NULL AND EXISTS(SELECT 1 FROM kova_private.organization_scim_subjects(p_user) s WHERE s.provider_id=c.provider_id AND s.subject=u.external_id)) ORDER BY u.organization_id,u.id LIMIT 100 LOOP
  PERFORM 1 FROM public.organizations WHERE id=row.organization_id FOR UPDATE;
  IF row.user_id=p_user OR kova_private.organization_scim_config_current(row.organization_id) THEN
   SELECT to_jsonb(m) INTO before_member FROM public.organization_members m WHERE organization_id=row.organization_id AND user_id=p_user;
   UPDATE public.organization_scim_users SET user_id=p_user WHERE id=row.id AND user_id IS NULL AND kova_private.organization_scim_identity(row.provider_id,row.external_id)=p_user;
   PERFORM kova_private.organization_scim_apply_membership(row.id);
   SELECT to_jsonb(m) INTO after_member FROM public.organization_members m WHERE organization_id=row.organization_id AND user_id=p_user;
   IF row.user_id IS NULL OR before_member IS DISTINCT FROM after_member THEN
    UPDATE public.organizations SET revision=revision+1,updated_at=now() WHERE id=row.organization_id;
    INSERT INTO public.organization_audit_events(organization_id,actor_user_id,action,details)VALUES(row.organization_id,p_user,'scim_identity_reconciled',jsonb_build_object('resourceId',row.id));
    count_value:=count_value+1;
   END IF;
  END IF;
 END LOOP;RETURN count_value;
END$$;
REVOKE ALL ON FUNCTION public.reconcile_organization_scim_membership(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_organization_scim_membership(uuid) TO service_role;
CREATE VIEW public.organization_scim_user_export_rows WITH(security_invoker=true) AS SELECT user_id,id,organization_id,external_id,user_name,display_name,active,revision,deleted_at,created_at,updated_at FROM public.organization_scim_users WHERE user_id IS NOT NULL;
REVOKE ALL ON public.organization_scim_user_export_rows FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.organization_scim_user_export_rows TO service_role;

-- RLS must not retain a managed role after its exact IdP identity or source
-- configuration disappears, even before the next foreground reconciliation.
CREATE OR REPLACE FUNCTION kova_private.current_organization_role(p_organization_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT m.role FROM public.organization_members m JOIN public.organizations o ON o.id=m.organization_id
 WHERE m.organization_id=p_organization_id AND m.user_id=(SELECT auth.uid()) AND m.revoked_at IS NULL AND o.state='active'
 AND NOT EXISTS(SELECT 1 FROM public.account_deletion_fences f WHERE f.user_id=m.user_id)
 AND(m.scim_user_id IS NULL OR EXISTS(SELECT 1 FROM public.organization_scim_users u JOIN public.organization_scim_configs c ON c.organization_id=u.organization_id
 WHERE u.id=m.scim_user_id AND u.user_id=m.user_id AND u.organization_id=m.organization_id AND u.active AND u.deleted_at IS NULL AND kova_private.organization_scim_config_current(m.organization_id) AND kova_private.organization_scim_identity(c.provider_id,u.external_id)=m.user_id))
$$;
