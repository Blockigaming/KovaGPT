-- PROPOSED / UNAPPLIED. Isolated local proposal; CLI home is read-only.
alter table public.canvas_documents add column title text not null default '' check(kova_private.workflow_skill_utf16_length(title)<=200),
 add column title_mutation_id uuid, add column title_mutation_actor uuid,
 add column title_mutation_revision integer;
alter table public.canvas_revisions add column title text not null default '' check(kova_private.workflow_skill_utf16_length(title)<=200);
-- Preserve the title associated with future content versions, including legacy writers.
create function kova_private.canvas_revision_title() returns trigger language plpgsql security definer set search_path='' as $$
begin select title into new.title from public.canvas_documents where id=new.document_id; return new; end $$;
revoke all on function kova_private.canvas_revision_title() from public,anon,authenticated;
create trigger canvas_revision_title before insert on public.canvas_revisions for each row execute function kova_private.canvas_revision_title();
create function kova_private.save_canvas_title(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); doc public.canvas_documents; cid uuid; revision_value integer; title_value text; mutation uuid;
begin
 if actor is null or not kova_private.auth_user_exists(actor) then raise exception 'collaboration_access_denied' using errcode='42501'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>3000 or jsonb_typeof(p_data->'title') is distinct from 'string' then raise exception 'collaboration_invalid_input' using errcode='22023'; end if;
 cid:=(p_data->>'documentId')::uuid; revision_value:=(p_data->>'expectedRevision')::integer; mutation:=(p_data->>'mutationId')::uuid;title_value:=p_data->>'title';
 if cid is null or mutation is null or revision_value is null or revision_value<1 or kova_private.workflow_skill_utf16_length(title_value)>200 then raise exception 'collaboration_invalid_input' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,20260903204500));
 if exists(select 1 from public.account_deletion_fences where user_id=actor) or not kova_private.canvas_access(cid,true) then raise exception 'collaboration_access_denied' using errcode='42501'; end if;
 select * into doc from public.canvas_documents where id=cid;
 if doc.private_owner_id is not null then perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('kova:chat-version:'||actor::text||':'||doc.chat_id||':'||doc.message_id,0)); end if;
 select * into doc from public.canvas_documents where id=cid for update;
 if not kova_private.canvas_access(cid,true) then raise exception 'collaboration_access_denied' using errcode='42501'; end if;
 if doc.title_mutation_id=mutation then
   if doc.title_mutation_actor is distinct from actor or doc.title_mutation_revision is distinct from revision_value or doc.title<>title_value then raise exception 'canvas_revision_conflict' using errcode='40001'; end if;
 else
   if doc.revision<>revision_value then raise exception 'canvas_revision_conflict' using errcode='40001'; end if;
   update public.canvas_documents set title=title_value,revision=revision+1,updated_at=now(),title_mutation_id=mutation,title_mutation_actor=actor,title_mutation_revision=revision_value where id=cid returning * into doc;
   insert into public.canvas_revisions(document_id,revision,content) values(cid,doc.revision,doc.content);
   delete from public.canvas_revisions where document_id=cid and revision<=doc.revision-50;
 end if;
 return kova_private.collaboration_rpc('get',jsonb_build_object('documentId',cid));
end $$;
revoke all on function kova_private.save_canvas_title(jsonb) from public,anon;
grant execute on function kova_private.save_canvas_title(jsonb) to authenticated;
-- Route only the new title operation; all existing content/comment operations retain their implementation.
create or replace function public.collaboration_rpc(p_operation text,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if p_operation='save_title' then return kova_private.save_canvas_title(p_data); end if;
 return kova_private.collaboration_rpc(p_operation,p_data);
end $$;
revoke all on function public.collaboration_rpc(text,jsonb) from public,anon;
grant execute on function public.collaboration_rpc(text,jsonb) to authenticated;
