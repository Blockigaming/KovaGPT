-- Keep usage authorization compatible with the current published mode catalog.
alter table public.ai_usage_events
  drop constraint if exists ai_usage_events_kova_mode_check;

alter table public.ai_usage_events
  add constraint ai_usage_events_kova_mode_check
  check (
    kova_mode in (
      'instant',
      'medium',
      'thinking',
      'high',
      'extra_high',
      'pro',
      'max',
      'ultra',
      'utility',
      'image',
      'embedding',
      'deep_research'
    )
  );
