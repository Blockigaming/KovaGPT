-- Private practice snapshots. Scores are user practice, never an entitlement or credential.
create table public.study_sets (
 id uuid primary key,
 owner_id uuid not null references auth.users(id) on delete cascade,
 revision bigint not null default 1 check(revision>0),
 creation_token timestamptz not null,
 body jsonb,
 deleted_at timestamptz,
 last_mutation_id uuid not null,
 last_mutation_hash text not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint study_body_bound check ((deleted_at is not null and body is null) or
  (deleted_at is null and body is not null and coalesce(jsonb_typeof(body)='object' and octet_length(body::text)<=200000
   and body->>'version'='1' and jsonb_typeof(body->'deck')='object'
   and jsonb_typeof(body->'attempts')='array' and jsonb_array_length(body->'attempts')<=1000,false)))
);
create index study_sets_owner_idx on public.study_sets(owner_id,id);
create index study_sets_retired_idx on public.study_sets(owner_id,deleted_at,id) where deleted_at is not null;
alter table public.study_sets enable row level security;
create policy study_sets_owner_read on public.study_sets for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.study_sets from public,anon,authenticated;
grant select on public.study_sets to authenticated;
grant all on public.study_sets to service_role;
create table public.study_write_windows (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 window_started_at timestamptz not null, writes integer not null check(writes between 1 and 20)
);
alter table public.study_write_windows enable row level security;
revoke all on public.study_write_windows from public,anon,authenticated;
grant all on public.study_write_windows to service_role;
create function public.save_study_set(p_id uuid,p_expected_revision bigint,p_mutation_id uuid,p_body jsonb,p_creation_token timestamptz,p_delete boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_owner uuid:=auth.uid(); v_row public.study_sets%rowtype; v_hash text; v_window public.study_write_windows%rowtype; v_now timestamptz:=clock_timestamp();
begin
 if v_owner is null or p_id is null or p_mutation_id is null or p_expected_revision is null or p_expected_revision<0 or p_delete is null or p_creation_token is null then
   raise exception 'study_invalid' using errcode='22023';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text,20260903204500));
 if not kova_private.auth_user_exists(v_owner) or exists(select 1 from public.account_deletion_fences where user_id=v_owner) then
   raise exception 'study_unavailable' using errcode='42501';
 end if;
 v_now:=clock_timestamp();
 v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object('id',p_id,'revision',p_expected_revision,'creationToken',p_creation_token,'body',p_body,'delete',p_delete)::text,'UTF8')),'hex');
 select * into v_row from public.study_sets where id=p_id for update;
 if found then
   if v_row.owner_id<>v_owner then raise exception 'study_unavailable' using errcode='42501'; end if;
   if v_row.creation_token is distinct from p_creation_token then raise exception 'study_conflict' using errcode='40001';end if;
   if v_row.last_mutation_id=p_mutation_id then
     if v_row.last_mutation_hash<>v_hash then raise exception 'study_conflict' using errcode='40001'; end if;
     return to_jsonb(v_row)-'last_mutation_id'-'last_mutation_hash';
   end if;
   if v_row.deleted_at is not null or v_row.revision<>p_expected_revision then raise exception 'study_conflict' using errcode='40001'; end if;
 else
   -- A deleted generation whose creation window has closed cannot later be
   -- recreated by an old request. Confirm its absence without adding a new
   -- tombstone, so a lost delete response remains recoverable after sweeping.
   if p_delete and p_expected_revision>0 and p_creation_token<v_now-interval '23 hours' then
     return jsonb_build_object('id',p_id,'owner_id',v_owner,'creation_token',p_creation_token,
       'revision',p_expected_revision+1,'body',null,'deleted_at',v_now,'updated_at',v_now);
   end if;
   if p_expected_revision<>0 or p_delete then raise exception 'study_conflict' using errcode='40001'; end if;
   -- Creation identity is immutable on every retry. A removed tombstone is
   -- older than any acceptable first-create token, preventing delayed replay.
   if p_creation_token<v_now-interval '23 hours' or p_creation_token>v_now+interval '1 minute' then
     raise exception 'study_creation_expired' using errcode='40001';end if;
   if (select count(*) from public.study_sets where owner_id=v_owner and deleted_at is null)>=100 then
     raise exception 'study_capacity' using errcode='54000';
   end if;
 end if;
 -- Enforce the write budget inside the authenticated RPC, not only its HTTP
 -- wrapper. Exact known replays above cost no additional mutation allowance.
 select * into v_window from public.study_write_windows where owner_id=v_owner for update;
 if found and v_window.window_started_at>v_now-interval '1 minute' and v_window.writes>=20 then
   raise exception 'study_write_limited' using errcode='54000';end if;
 insert into public.study_write_windows(owner_id,window_started_at,writes) values(v_owner,v_now,1)
 on conflict(owner_id) do update set
  window_started_at=case when study_write_windows.window_started_at<=v_now-interval '1 minute' then v_now else study_write_windows.window_started_at end,
  writes=case when study_write_windows.window_started_at<=v_now-interval '1 minute' then 1 else study_write_windows.writes+1 end;
 delete from public.study_sets where id in (select id from public.study_sets where owner_id=v_owner and deleted_at<v_now-interval '24 hours'
   order by deleted_at,id limit 500);
 if v_row.id is not null then
   update public.study_sets set body=case when p_delete then null else p_body end,
     deleted_at=case when p_delete then v_now else null end,revision=revision+1,
     last_mutation_id=p_mutation_id,last_mutation_hash=v_hash,updated_at=v_now where id=p_id returning * into v_row;
 else
   insert into public.study_sets(id,owner_id,creation_token,body,last_mutation_id,last_mutation_hash)
     values(p_id,v_owner,p_creation_token,p_body,p_mutation_id,v_hash) returning * into v_row;
 end if;
 return to_jsonb(v_row)-'last_mutation_id'-'last_mutation_hash';
end $$;
revoke all on function public.save_study_set(uuid,bigint,uuid,jsonb,timestamptz,boolean) from public,anon;
grant execute on function public.save_study_set(uuid,bigint,uuid,jsonb,timestamptz,boolean) to authenticated;

create view public.study_set_export_rows with(security_invoker=true) as
select id,owner_id,revision,creation_token,body,deleted_at,created_at,updated_at from public.study_sets;
revoke all on public.study_set_export_rows from public,anon;
grant select on public.study_set_export_rows to authenticated,service_role;
