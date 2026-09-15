-- Let the existing custom-Kova mutation boundary persist the current Pro-only
-- Max and Ultra mode identifiers. The original routine remains the canonical
-- implementation; this forward migration changes only its closed allowlist.
DO $migration$
DECLARE
  original_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.mutate_custom_kova(uuid,uuid,uuid,bigint,text,jsonb,bigint,timestamptz)'::regprocedure
  ) INTO original_definition;

  updated_definition := replace(
    original_definition,
    '''extra_high'',''pro'',''kova_5_5''',
    '''extra_high'',''max'',''ultra'',''pro'',''kova_5_5'''
  );

  IF updated_definition = original_definition THEN
    RAISE EXCEPTION 'custom Kova mode allowlist source did not match';
  END IF;

  EXECUTE updated_definition;
END;
$migration$;
