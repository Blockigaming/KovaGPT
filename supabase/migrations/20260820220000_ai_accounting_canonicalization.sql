-- Canonicalize KovaGPT AI accounting RPCs.
--
-- Historical migrations created two implementations of
-- acquire_ai_generation/finalize_ai_generation:
--
--   ai_usage_events      -> canonical production accounting
--   ai_generation_events -> obsolete compatibility implementation
--
-- PostgREST cannot reliably resolve the overloaded RPCs.
-- Preserve historical migrations, but remove the obsolete overloads
-- going forward.

drop function if exists public.acquire_ai_generation(
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  boolean,
  text,
  integer,
  integer,
  numeric,
  boolean,
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  timestamptz,
  timestamptz
);

drop function if exists public.finalize_ai_generation(
  uuid,
  text,
  integer,
  integer,
  integer,
  integer,
  numeric,
  integer,
  jsonb,
  text
);

-- Explicitly restore the security boundary on the canonical RPCs.

revoke all on function public.acquire_ai_generation(
  text,
  text,
  uuid,
  text,
  uuid,
  text,
  text,
  boolean,
  text,
  bigint,
  bigint,
  numeric,
  boolean,
  bigint,
  bigint,
  integer,
  integer,
  integer,
  integer,
  integer,
  timestamptz,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.acquire_ai_generation(
  text,
  text,
  uuid,
  text,
  uuid,
  text,
  text,
  boolean,
  text,
  bigint,
  bigint,
  numeric,
  boolean,
  bigint,
  bigint,
  integer,
  integer,
  integer,
  integer,
  integer,
  timestamptz,
  timestamptz
) to service_role;

revoke all on function public.finalize_ai_generation(
  uuid,
  text,
  bigint,
  bigint,
  bigint,
  bigint,
  numeric,
  integer,
  jsonb,
  text
) from public, anon, authenticated;

grant execute on function public.finalize_ai_generation(
  uuid,
  text,
  bigint,
  bigint,
  bigint,
  bigint,
  numeric,
  integer,
  jsonb,
  text
) to service_role;
