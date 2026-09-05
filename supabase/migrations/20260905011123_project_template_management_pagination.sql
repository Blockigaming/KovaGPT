-- Stable UUID keyset pagination keeps older owned and received templates
-- reachable for version, archive, and grant management. This is service-only;
-- the authenticated API supplies the principal for every page.
begin;
create function public.list_project_templates_page(p_user_id uuid,p_after_id uuid default null,p_limit integer default 50)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare page jsonb;begin
 if p_user_id is null or p_limit is null or p_limit not between 1 and 50 then raise exception 'project_template_input_invalid' using errcode='22023'; end if;
 if not kova_private.auth_user_exists(p_user_id) or exists(select 1 from public.account_deletion_fences where user_id=p_user_id) then raise exception 'project_template_permission_denied' using errcode='42501'; end if;
 with candidates as (
    select jsonb_build_object(
      'id', t.id,
      'ownerId', t.owner_id,
      'name', t.name,
      'description', t.description,
      'currentVersion', t.current_version,
      'revision', t.revision,
      'archivedAt', t.archived_at,
      'updatedAt', t.updated_at,
      'access', case when t.owner_id = p_user_id then 'owner' else 'shared' end,
      'canCopy', t.owner_id = p_user_id or coalesce(g.can_copy, false),
      'versions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'version', pv.version, 'createdAt', pv.created_at
        ) order by pv.version desc)
        from public.project_template_versions pv where pv.template_id = t.id
      ), '[]'::jsonb),
      'grants', case when t.owner_id = p_user_id then coalesce((
        select jsonb_agg(jsonb_build_object(
          'granteeUserId', pg.grantee_user_id,
          'canCopy', pg.can_copy,
          'revokedAt', pg.revoked_at,
          'updatedAt', pg.updated_at
        ) order by pg.updated_at desc)
        from public.project_template_grants pg where pg.template_id = t.id
      ), '[]'::jsonb) else '[]'::jsonb end
    ) item, t.id
    from public.project_templates t
    join public.project_template_versions v
      on v.template_id = t.id and v.version = t.current_version
    left join public.project_template_grants g
      on g.template_id = t.id and g.grantee_user_id = p_user_id and g.revoked_at is null
    where (t.owner_id = p_user_id
       or (t.archived_at is null and g.grantee_user_id = p_user_id))
       and (p_after_id is null or t.id > p_after_id)
    order by t.id
    limit p_limit+1
 ), visible_page as (select * from candidates order by id limit p_limit)
 select jsonb_build_object(
  'templates',coalesce((select jsonb_agg(item order by id) from visible_page),'[]'::jsonb),
  'hasMore',(select count(*) from candidates)>p_limit,
  'nextCursor',case when (select count(*) from candidates)>p_limit then (select id from visible_page order by id desc limit 1) else null end
 ) into page;
 return page;
end$$;
revoke all on function public.list_project_templates_page(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.list_project_templates_page(uuid,uuid,integer) to service_role;
commit;
