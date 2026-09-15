-- Keep usage accounting in sync with the public chat-mode catalog.
alter table public.ai_usage_events
  drop constraint if exists ai_usage_events_kova_mode_check;

alter table public.ai_usage_events
  add constraint ai_usage_events_kova_mode_check
  check (kova_mode in (
    'instant', 'medium', 'thinking', 'high', 'extra_high', 'pro', 'max', 'ultra',
    'utility', 'image', 'embedding', 'deep_research'
  ));

-- Keep the authoritative custom-Kova mutation RPC aligned with the same catalog.
-- The guard lets focused migration tests apply this file without the custom-Kova schema.
do $migration$
declare
  signature constant text :=
    'public.mutate_custom_kova(uuid,uuid,uuid,bigint,text,jsonb,bigint,timestamptz)';
  definition text;
  updated_definition text;
begin
  if to_regprocedure(signature) is null then
    return;
  end if;
  definition := pg_get_functiondef(to_regprocedure(signature));
  if definition ~ $has$'max'\s*,\s*'ultra'$has$ then
    return;
  end if;
  updated_definition := regexp_replace(
    definition,
    $old$'extra_high'\s*,\s*'pro'\s*,\s*'kova_5_5'$old$,
    $new$'extra_high','max','ultra','pro','kova_5_5'$new$
  );
  if updated_definition = definition then
    raise exception 'custom_kova_mode_allowlist_not_found';
  end if;
  execute updated_definition;
end;
$migration$;
