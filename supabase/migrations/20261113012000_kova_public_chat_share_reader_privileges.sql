begin;

-- Match the snapshot writer's privilege boundary. Only the service role can
-- call this function. It returns just the snapshot for an active hashed token.
create or replace function public.read_public_chat_share(p_token_hash text)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'title', s.title, 'snapshot', s.snapshot,
    'createdAt', s.created_at, 'expiresAt', s.expires_at
  )
  from public.chat_public_shares s
  where s.token_hash = p_token_hash
    and s.revoked_at is null
    and s.expires_at > now()
    and kova_private.auth_user_exists(s.owner_id)
    and not exists (
      select 1 from public.account_deletion_fences f where f.user_id = s.owner_id
    )
  limit 1
$$;

revoke all on function public.read_public_chat_share(text) from public, anon, authenticated;
grant execute on function public.read_public_chat_share(text) to service_role;
notify pgrst, 'reload schema';

commit;
