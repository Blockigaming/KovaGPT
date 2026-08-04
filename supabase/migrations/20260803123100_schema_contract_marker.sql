-- Mark the schema contract only after all objects required by kovagpt_schema_health exist.
insert into public.kova_schema_contract(singleton,version) values(true,'20260803123000-v1')
on conflict(singleton) do update set version=excluded.version,applied_at=now();
