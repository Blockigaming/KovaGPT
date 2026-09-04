-- Reconcile Resend delivery webhooks without trusting event recipients.
-- The signed delivery id is the replay key; only provider message ids already
-- recorded by the sender worker may change delivery state or suppression.

ALTER TABLE public.suppressed_emails
  DROP CONSTRAINT IF EXISTS suppressed_emails_reason_check;
ALTER TABLE public.suppressed_emails
  ADD CONSTRAINT suppressed_emails_reason_check
  CHECK (reason IN ('unsubscribe', 'bounce', 'complaint', 'provider_suppression'));

CREATE TABLE IF NOT EXISTS public.email_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  provider_message_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count BETWEEN 1 AND 1000),
  last_error_code text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_webhook_events_id_check
    CHECK (event_id ~ '^[A-Za-z0-9_.:-]{1,200}$'),
  CONSTRAINT email_webhook_events_type_check
    CHECK (event_type ~ '^email\.[a-z_]{1,80}$'),
  CONSTRAINT email_webhook_events_provider_id_check
    CHECK (provider_message_id ~ '^[A-Za-z0-9_.:-]{1,200}$'),
  CONSTRAINT email_webhook_events_sha_check
    CHECK (payload_sha256 ~ '^[0-9a-f]{64}$')
);

ALTER TABLE public.email_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.email_webhook_events TO service_role;

DROP POLICY IF EXISTS "Service role manages email webhook events"
  ON public.email_webhook_events;
CREATE POLICY "Service role manages email webhook events"
ON public.email_webhook_events
FOR ALL
TO service_role
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS email_webhook_events_provider_time_idx
  ON public.email_webhook_events(provider_message_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS email_send_log_provider_id_idx
  ON public.email_send_log ((metadata ->> 'provider_id'))
  WHERE metadata ? 'provider_id';

CREATE OR REPLACE FUNCTION public.process_resend_webhook_event(
  p_event_id text,
  p_event_type text,
  p_provider_message_id text,
  p_occurred_at timestamptz,
  p_payload_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  event_row public.email_webhook_events;
  send_row public.email_send_log;
  inserted_count integer;
  next_status text;
  suppression_reason text;
  merged_metadata jsonb;
BEGIN
  IF p_event_id IS NULL
    OR p_event_id !~ '^[A-Za-z0-9_.:-]{1,200}$'
    OR p_event_type IS NULL
    OR p_event_type !~ '^email\.[a-z_]{1,80}$'
    OR p_provider_message_id IS NULL
    OR p_provider_message_id !~ '^[A-Za-z0-9_.:-]{1,200}$'
    OR p_occurred_at IS NULL
    OR p_payload_sha256 IS NULL
    OR p_payload_sha256 !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_resend_webhook_event';
  END IF;

  INSERT INTO public.email_webhook_events (
    event_id,
    event_type,
    provider_message_id,
    occurred_at,
    payload_sha256
  )
  VALUES (
    p_event_id,
    p_event_type,
    p_provider_message_id,
    p_occurred_at,
    p_payload_sha256
  )
  ON CONFLICT (event_id) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  SELECT *
  INTO event_row
  FROM public.email_webhook_events
  WHERE event_id = p_event_id
  FOR UPDATE;

  IF event_row.payload_sha256 <> p_payload_sha256
    OR event_row.event_type <> p_event_type
    OR event_row.provider_message_id <> p_provider_message_id
  THEN
    RETURN jsonb_build_object(
      'duplicate', false,
      'applied', false,
      'retryable', false,
      'conflict', true,
      'code', 'resend_webhook_replay_conflict'
    );
  END IF;

  IF inserted_count = 0 AND event_row.status IN ('processed', 'ignored') THEN
    RETURN jsonb_build_object(
      'duplicate', true,
      'applied', event_row.status = 'processed',
      'retryable', false,
      'conflict', false
    );
  END IF;

  IF inserted_count = 0 THEN
    UPDATE public.email_webhook_events
    SET status = 'received',
        attempt_count = least(1000, attempt_count + 1),
        last_error_code = NULL,
        updated_at = now()
    WHERE event_id = p_event_id;
  END IF;

  next_status := CASE p_event_type
    WHEN 'email.bounced' THEN 'bounced'
    WHEN 'email.complained' THEN 'complained'
    WHEN 'email.suppressed' THEN 'suppressed'
    WHEN 'email.failed' THEN 'failed'
    WHEN 'email.delivered' THEN 'sent'
    WHEN 'email.delivery_delayed' THEN 'sent'
    ELSE NULL
  END;

  suppression_reason := CASE p_event_type
    WHEN 'email.bounced' THEN 'bounce'
    WHEN 'email.complained' THEN 'complaint'
    WHEN 'email.suppressed' THEN 'provider_suppression'
    ELSE NULL
  END;

  IF next_status IS NULL THEN
    UPDATE public.email_webhook_events
    SET status = 'ignored',
        processed_at = now(),
        last_error_code = NULL,
        updated_at = now()
    WHERE event_id = p_event_id;
    RETURN jsonb_build_object(
      'duplicate', false,
      'applied', false,
      'retryable', false,
      'conflict', false
    );
  END IF;

  SELECT *
  INTO send_row
  FROM public.email_send_log
  WHERE metadata ->> 'provider_id' = p_provider_message_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.email_webhook_events
    SET status = 'failed',
        last_error_code = 'email_send_log_not_found',
        updated_at = now()
    WHERE event_id = p_event_id;
    RETURN jsonb_build_object(
      'duplicate', false,
      'applied', false,
      'retryable', true,
      'conflict', false,
      'code', 'email_send_log_not_found'
    );
  END IF;

  IF send_row.recipient_email IS NULL
    OR char_length(send_row.recipient_email) NOT BETWEEN 3 AND 254
    OR position('@' IN send_row.recipient_email) <= 1
  THEN
    UPDATE public.email_webhook_events
    SET status = 'failed',
        last_error_code = 'email_log_recipient_invalid',
        updated_at = now()
    WHERE event_id = p_event_id;
    RETURN jsonb_build_object(
      'duplicate', false,
      'applied', false,
      'retryable', false,
      'conflict', false,
      'code', 'email_log_recipient_invalid'
    );
  END IF;

  IF suppression_reason IS NOT NULL THEN
    INSERT INTO public.suppressed_emails (email, reason, metadata)
    VALUES (
      lower(trim(send_row.recipient_email)),
      suppression_reason,
      jsonb_build_object(
        'provider', 'resend',
        'provider_id', p_provider_message_id,
        'event_id', p_event_id,
        'event_type', p_event_type,
        'occurred_at', p_occurred_at
      )
    )
    ON CONFLICT (email) DO NOTHING;
  END IF;

  merged_metadata := coalesce(send_row.metadata, '{}'::jsonb) || jsonb_build_object(
    'last_provider_event_id', p_event_id,
    'last_provider_event_type', p_event_type,
    'last_provider_event_at', p_occurred_at
  );

  UPDATE public.email_send_log
  SET status = CASE
        WHEN send_row.status = 'complained' OR next_status = 'complained' THEN 'complained'
        WHEN send_row.status = 'suppressed' OR next_status = 'suppressed' THEN 'suppressed'
        WHEN send_row.status = 'bounced' OR next_status = 'bounced' THEN 'bounced'
        WHEN next_status = 'failed' THEN 'failed'
        ELSE send_row.status
      END,
      error_message = CASE
        WHEN p_event_type IN ('email.bounced', 'email.complained', 'email.suppressed', 'email.failed')
          THEN replace(p_event_type, 'email.', '')
        ELSE error_message
      END,
      metadata = merged_metadata
  WHERE id = send_row.id;

  UPDATE public.email_webhook_events
  SET status = 'processed',
      processed_at = now(),
      last_error_code = NULL,
      updated_at = now()
  WHERE event_id = p_event_id;

  RETURN jsonb_build_object(
    'duplicate', false,
    'applied', true,
    'retryable', false,
    'conflict', false
  );
END
$$;

REVOKE ALL ON FUNCTION public.process_resend_webhook_event(
  text, text, text, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_resend_webhook_event(
  text, text, text, timestamptz, text
) TO service_role;

-- A delivery event can race the sender's provider-id write. The webhook keeps
-- that event durably as retryable; this trigger completes reconciliation even
-- if the provider exhausts its HTTP retry window before the write commits.
CREATE OR REPLACE FUNCTION public.reconcile_resend_webhook_events_for_send()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  provider_message_id text;
  pending_event public.email_webhook_events;
BEGIN
  provider_message_id := NEW.metadata ->> 'provider_id';
  IF provider_message_id IS NULL
    OR provider_message_id !~ '^[A-Za-z0-9_.:-]{1,200}$'
  THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.metadata ->> 'provider_id') IS NOT DISTINCT FROM provider_message_id THEN
      RETURN NEW;
    END IF;
  END IF;

  FOR pending_event IN
    SELECT *
    FROM public.email_webhook_events
    WHERE email_webhook_events.provider_message_id = provider_message_id
      AND status = 'failed'
      AND last_error_code = 'email_send_log_not_found'
    ORDER BY occurred_at
  LOOP
    PERFORM public.process_resend_webhook_event(
      pending_event.event_id,
      pending_event.event_type,
      pending_event.provider_message_id,
      pending_event.occurred_at,
      pending_event.payload_sha256
    );
  END LOOP;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.reconcile_resend_webhook_events_for_send()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_resend_webhook_events_for_send()
  TO service_role;

DROP TRIGGER IF EXISTS reconcile_resend_webhook_events_after_send
  ON public.email_send_log;
CREATE TRIGGER reconcile_resend_webhook_events_after_send
AFTER INSERT OR UPDATE OF metadata ON public.email_send_log
FOR EACH ROW
EXECUTE FUNCTION public.reconcile_resend_webhook_events_for_send();


CREATE OR REPLACE FUNCTION public.enqueue_tracked_email(
  p_queue_name text,
  p_payload jsonb,
  p_template_name text,
  p_recipient_email text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  tracked_message_id text;
  normalized_recipient text;
  payload_fingerprint text;
  queued_message_id bigint;
  existing_log public.email_send_log;
BEGIN
  tracked_message_id := p_payload ->> 'message_id';
  normalized_recipient := lower(trim(p_recipient_email));
  payload_fingerprint := p_payload ->> 'payload_fingerprint';

  IF p_queue_name NOT IN ('auth_emails', 'transactional_emails')
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
    OR tracked_message_id IS NULL
    OR tracked_message_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
    OR p_template_name IS NULL
    OR p_template_name !~ '^[a-z0-9][a-z0-9_-]{0,99}$'
    OR (
      payload_fingerprint IS NOT NULL
      AND payload_fingerprint !~ '^[0-9a-f]{64}$'
    )
    OR char_length(normalized_recipient) NOT BETWEEN 3 AND 254
    OR position('@' IN normalized_recipient) <= 1
    OR p_payload ->> 'to' IS NULL
    OR lower(trim(p_payload ->> 'to')) <> normalized_recipient
    OR (
      p_queue_name = 'auth_emails'
      AND coalesce(p_payload ->> 'purpose', '') <> 'auth'
    )
    OR (
      p_queue_name = 'transactional_emails'
      AND coalesce(p_payload ->> 'purpose', '') <> 'transactional'
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_tracked_email';
  END IF;

  -- Serialize a retried producer by its durable message id. The queue send
  -- and log insert remain in this transaction, so an existing log proves the
  -- original queue write committed as well.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(tracked_message_id, 0)
  );

  SELECT *
  INTO existing_log
  FROM public.email_send_log
  WHERE message_id = tracked_message_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    IF existing_log.template_name <> p_template_name
      OR lower(trim(existing_log.recipient_email)) <> normalized_recipient
      OR coalesce(existing_log.metadata ->> 'queue_name', '') <> p_queue_name
      OR coalesce(existing_log.metadata ->> 'payload_fingerprint', '')
        <> coalesce(payload_fingerprint, '')
    THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'tracked_email_message_id_conflict';
    END IF;
    RETURN 0;
  END IF;

  INSERT INTO public.email_send_log (
    message_id,
    template_name,
    recipient_email,
    status,
    metadata
  )
  VALUES (
    tracked_message_id,
    p_template_name,
    normalized_recipient,
    'pending',
    jsonb_build_object(
      'queue_name', p_queue_name,
      'payload_fingerprint', payload_fingerprint
    )
  );

  BEGIN
    queued_message_id := pgmq.send(p_queue_name, p_payload);
  EXCEPTION WHEN undefined_table THEN
    PERFORM pgmq.create(p_queue_name);
    queued_message_id := pgmq.send(p_queue_name, p_payload);
  END;

  RETURN queued_message_id;
END
$$;

REVOKE ALL ON FUNCTION public.enqueue_tracked_email(
  text, jsonb, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_tracked_email(
  text, jsonb, text, text
) TO service_role;


CREATE OR REPLACE FUNCTION public.dead_letter_tracked_email(
  p_source_queue text,
  p_dlq_name text,
  p_message_id bigint,
  p_payload jsonb,
  p_log_id uuid,
  p_reason text,
  p_attempts integer
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  dlq_message_id bigint;
  updated_count integer;
BEGIN
  IF (p_source_queue, p_dlq_name) NOT IN (
      ('auth_emails', 'auth_emails_dlq'),
      ('transactional_emails', 'transactional_emails_dlq')
    )
    OR p_message_id IS NULL
    OR p_message_id < 1
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
    OR p_reason IS NULL
    OR p_reason !~ '^[a-z0-9_]{1,100}$'
    OR p_attempts IS NULL
    OR p_attempts NOT BETWEEN 1 AND 1000
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_tracked_email_dead_letter';
  END IF;

  BEGIN
    dlq_message_id := pgmq.send(p_dlq_name, p_payload);
  EXCEPTION WHEN undefined_table THEN
    PERFORM pgmq.create(p_dlq_name);
    dlq_message_id := pgmq.send(p_dlq_name, p_payload);
  END;

  IF NOT pgmq.delete(p_source_queue, p_message_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'tracked_email_source_delete_failed';
  END IF;

  IF p_log_id IS NOT NULL THEN
    UPDATE public.email_send_log
    SET status = 'dlq',
        error_message = p_reason,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'terminal_reason', p_reason,
          'attempts', p_attempts,
          'dead_lettered_at', now()
        )
    WHERE id = p_log_id;
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    IF updated_count <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'tracked_email_log_update_failed';
    END IF;
  END IF;

  RETURN dlq_message_id;
END
$$;

REVOKE ALL ON FUNCTION public.dead_letter_tracked_email(
  text, text, bigint, jsonb, uuid, text, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dead_letter_tracked_email(
  text, text, bigint, jsonb, uuid, text, integer
) TO service_role;

-- Each browser mutation carries a random operation id. Bind it to an immutable
-- request fingerprint so transport retries return the original result without
-- duplicating a share, reopening an accepted invite, or sending a second email.
CREATE TABLE IF NOT EXISTS public.email_delivery_operations (
  operation_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation_type text NOT NULL
    CHECK (operation_type IN ('project-invite', 'shared-chat')),
  request_fingerprint text NOT NULL
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  result_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_delivery_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_delivery_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.email_delivery_operations TO service_role;

DROP POLICY IF EXISTS "Service role manages email delivery operations"
  ON public.email_delivery_operations;
CREATE POLICY "Service role manages email delivery operations"
ON public.email_delivery_operations
FOR ALL
TO service_role
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS email_delivery_operations_actor_time_idx
  ON public.email_delivery_operations(actor_id, created_at DESC);

-- Collaboration writes and their outbound notifications commit together. These
-- functions are service-only; callers cannot turn them into arbitrary mail.
CREATE OR REPLACE FUNCTION public.create_project_invite_and_enqueue(
  p_actor_id uuid,
  p_project_id uuid,
  p_recipient_email text,
  p_role public.project_role,
  p_operation_id uuid,
  p_request_fingerprint text,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_email text;
  normalized_recipient text := lower(trim(p_recipient_email));
  existing_invite_id uuid;
  result_id uuid;
  operation_row public.email_delivery_operations;
BEGIN
  SELECT lower(email)
  INTO actor_email
  FROM auth.users
  WHERE id = p_actor_id
    AND email_confirmed_at IS NOT NULL;

  IF actor_email IS NULL
    OR p_project_id IS NULL
    OR p_recipient_email IS NULL
    OR actor_email = normalized_recipient
    OR char_length(normalized_recipient) NOT BETWEEN 3 AND 254
    OR position('@' IN normalized_recipient) <= 1
    OR p_role IS NULL
    OR p_role NOT IN ('editor'::public.project_role, 'viewer'::public.project_role)
    OR p_operation_id IS NULL
    OR p_request_fingerprint IS NULL
    OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
    OR lower(trim(p_payload ->> 'to')) <> normalized_recipient
    OR p_payload ->> 'purpose' <> 'transactional'
    OR p_payload ->> 'label' <> 'project-invite'
    OR p_payload ->> 'message_id' IS NULL
    OR p_payload ->> 'message_id' <> p_operation_id::text
    OR p_payload ->> 'idempotency_key' IS NULL
    OR p_payload ->> 'idempotency_key' <> p_operation_id::text
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_project_invite_email';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_operation_id::text, 0)
  );
  SELECT *
  INTO operation_row
  FROM public.email_delivery_operations
  WHERE operation_id = p_operation_id;

  IF FOUND THEN
    IF operation_row.actor_id <> p_actor_id
      OR operation_row.operation_type <> 'project-invite'
      OR operation_row.request_fingerprint <> p_request_fingerprint
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'email_delivery_operation_conflict';
    END IF;
    RETURN operation_row.result_id;
  END IF;

  PERFORM 1
  FROM public.projects
  WHERE id = p_project_id
    AND owner_id = p_actor_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'project_owner_required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.project_members member
    JOIN auth.users invitee ON invitee.id = member.user_id
    WHERE member.project_id = p_project_id
      AND lower(invitee.email) = normalized_recipient
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'already_project_member';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_project_id::text || ':' || normalized_recipient, 0)
  );
  SELECT id
  INTO existing_invite_id
  FROM public.project_invites
  WHERE project_id = p_project_id
    AND lower(email) = normalized_recipient
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF existing_invite_id IS NULL THEN
    INSERT INTO public.project_invites (
      project_id,
      email,
      role,
      invited_by,
      status,
      accepted_at
    )
    VALUES (
      p_project_id,
      normalized_recipient,
      p_role,
      p_actor_id,
      'pending',
      NULL
    )
    RETURNING id INTO result_id;
  ELSE
    UPDATE public.project_invites
    SET email = normalized_recipient,
        role = p_role,
        invited_by = p_actor_id,
        status = 'pending',
        accepted_at = NULL,
        created_at = now()
    WHERE id = existing_invite_id
    RETURNING id INTO result_id;
  END IF;

  PERFORM public.enqueue_tracked_email(
    'transactional_emails',
    p_payload,
    'project-invite',
    normalized_recipient
  );
  INSERT INTO public.email_delivery_operations (
    operation_id,
    actor_id,
    operation_type,
    request_fingerprint,
    result_id
  )
  VALUES (
    p_operation_id,
    p_actor_id,
    'project-invite',
    p_request_fingerprint,
    result_id
  );
  RETURN result_id;
END
$$;

REVOKE ALL ON FUNCTION public.create_project_invite_and_enqueue(
  uuid, uuid, text, public.project_role, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_project_invite_and_enqueue(
  uuid, uuid, text, public.project_role, uuid, text, jsonb
) TO service_role;


CREATE OR REPLACE FUNCTION public.create_shared_chat_and_enqueue(
  p_actor_id uuid,
  p_operation_id uuid,
  p_request_fingerprint text,
  p_recipient_email text,
  p_title text,
  p_local_chat_reference text,
  p_snapshot jsonb,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_email text;
  normalized_recipient text := lower(trim(p_recipient_email));
  result_id uuid;
  operation_row public.email_delivery_operations;
BEGIN
  SELECT lower(email)
  INTO actor_email
  FROM auth.users
  WHERE id = p_actor_id
    AND email_confirmed_at IS NOT NULL;

  IF actor_email IS NULL
    OR p_operation_id IS NULL
    OR p_request_fingerprint IS NULL
    OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_recipient_email IS NULL
    OR actor_email = normalized_recipient
    OR char_length(normalized_recipient) NOT BETWEEN 3 AND 254
    OR position('@' IN normalized_recipient) <= 1
    OR p_title IS NULL
    OR char_length(trim(p_title)) NOT BETWEEN 1 AND 200
    OR (p_local_chat_reference IS NOT NULL AND char_length(p_local_chat_reference) > 100)
    OR p_snapshot IS NULL
    OR jsonb_typeof(p_snapshot) <> 'object'
    OR jsonb_typeof(p_snapshot -> 'messages') <> 'array'
    OR jsonb_array_length(p_snapshot -> 'messages') NOT BETWEEN 1 AND 500
    OR octet_length(p_snapshot::text) > 25000000
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
    OR lower(trim(p_payload ->> 'to')) <> normalized_recipient
    OR p_payload ->> 'purpose' <> 'transactional'
    OR p_payload ->> 'label' <> 'shared-chat'
    OR p_payload ->> 'message_id' IS NULL
    OR p_payload ->> 'message_id' <> p_operation_id::text
    OR p_payload ->> 'idempotency_key' IS NULL
    OR p_payload ->> 'idempotency_key' <> p_operation_id::text
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_shared_chat_email';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_operation_id::text, 0)
  );
  SELECT *
  INTO operation_row
  FROM public.email_delivery_operations
  WHERE operation_id = p_operation_id;

  IF FOUND THEN
    IF operation_row.actor_id <> p_actor_id
      OR operation_row.operation_type <> 'shared-chat'
      OR operation_row.request_fingerprint <> p_request_fingerprint
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'email_delivery_operation_conflict';
    END IF;
    RETURN operation_row.result_id;
  END IF;

  INSERT INTO public.shared_chats (
    owner_user_id,
    recipient_email,
    local_chat_reference,
    title,
    snapshot,
    permission,
    status
  )
  VALUES (
    p_actor_id,
    normalized_recipient,
    p_local_chat_reference,
    trim(p_title),
    p_snapshot,
    'view',
    'pending'
  )
  RETURNING id INTO result_id;

  PERFORM public.enqueue_tracked_email(
    'transactional_emails',
    p_payload,
    'shared-chat',
    normalized_recipient
  );
  INSERT INTO public.email_delivery_operations (
    operation_id,
    actor_id,
    operation_type,
    request_fingerprint,
    result_id
  )
  VALUES (
    p_operation_id,
    p_actor_id,
    'shared-chat',
    p_request_fingerprint,
    result_id
  );
  RETURN result_id;
END
$$;

REVOKE ALL ON FUNCTION public.create_shared_chat_and_enqueue(
  uuid, uuid, text, text, text, text, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_shared_chat_and_enqueue(
  uuid, uuid, text, text, text, text, jsonb, jsonb
) TO service_role;


-- A provider Retry-After must be shared across every worker replica and must
-- extend the message lease. Otherwise another replica can reclaim the row and
-- retry before the provider permits it.
CREATE OR REPLACE FUNCTION public.defer_email_retry(
  p_queue_name text,
  p_message_id bigint,
  p_retry_after_seconds integer,
  p_lease_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  deferred boolean;
  retry_until timestamptz;
BEGIN
  IF p_queue_name NOT IN ('auth_emails', 'transactional_emails')
    OR p_message_id IS NULL
    OR p_message_id < 1
    OR p_retry_after_seconds IS NULL
    OR p_retry_after_seconds NOT BETWEEN 1 AND 900
    OR p_lease_seconds IS NULL
    OR p_lease_seconds NOT BETWEEN 30 AND 900
    OR p_lease_seconds < p_retry_after_seconds
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_email_retry_deferral';
  END IF;

  PERFORM 1
  FROM pgmq.set_vt(p_queue_name, p_message_id, p_lease_seconds);
  deferred := FOUND;
  IF NOT deferred THEN
    RETURN false;
  END IF;

  retry_until := now() + pg_catalog.make_interval(secs => p_retry_after_seconds);
  INSERT INTO public.email_send_state (id, retry_after_until, updated_at)
  VALUES (1, retry_until, now())
  ON CONFLICT (id) DO UPDATE
  SET retry_after_until = greatest(
        coalesce(public.email_send_state.retry_after_until, '-infinity'::timestamptz),
        EXCLUDED.retry_after_until
      ),
      updated_at = now();

  RETURN true;
EXCEPTION WHEN undefined_table THEN
  RETURN false;
END
$$;

REVOKE ALL ON FUNCTION public.defer_email_retry(
  text, bigint, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.defer_email_retry(
  text, bigint, integer, integer
) TO service_role;

-- The dedicated worker supersedes the historical five-second Edge Function
-- wake-up job. Remove every same-named cron entry so two dispatchers cannot
-- race the same queues after this migration is applied.
DO $remove_legacy_email_cron$
DECLARE
  target_job_id bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL
    OR to_regprocedure('cron.unschedule(bigint)') IS NULL
  THEN
    RETURN;
  END IF;

  FOR target_job_id IN
    SELECT jobid FROM cron.job WHERE jobname = 'process-email-queue'
  LOOP
    PERFORM cron.unschedule(target_job_id);
  END LOOP;
END
$remove_legacy_email_cron$;
