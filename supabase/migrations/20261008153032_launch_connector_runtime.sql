-- Source only: apply through the migration release gate, never at runtime.
begin;
revoke select on public.integration_linked_accounts from authenticated;
grant select (id, owner_id, workspace_id, provider_id, provider_account_id,
  account_label, status, granted_scopes, token_expires_at, health_checked_at,
  last_success_at, last_error_code, deleted_at, created_at, updated_at)
  on public.integration_linked_accounts to authenticated;

-- Serialize consent settlement with local disconnect. Invoker/service-role only.
create or replace function public.settle_launch_connector(
  p_owner uuid, p_provider text, p_state uuid, p_nonce_hash text, p_account jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  state_row public.integration_oauth_states%rowtype;
  account_row public.integration_linked_accounts%rowtype;
begin
  if p_owner is null or p_provider not in ('outlook','onedrive','sharepoint','ms-teams','notion','linear','slack','salesforce','hubspot') then
    raise exception 'unsupported_connector';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text || ':' || p_provider, 0));
  delete from public.integration_oauth_states
    where id=p_state and owner_id=p_owner and provider_id=p_provider
      and nonce_hash=p_nonce_hash and consumed_at is not null and expires_at>clock_timestamp()
    returning * into state_row;
  if not found then raise exception 'oauth_state_changed'; end if;
  if coalesce(p_account->>'provider_account_id','')='' or coalesce(p_account->>'access_token_ciphertext','') not like 'v1.%' then
    raise exception 'invalid_connector_credential';
  end if;
  insert into public.integration_linked_accounts(owner_id, provider_id, provider_account_id,
    account_label, status, granted_scopes, access_token_ciphertext, refresh_token_ciphertext,
    token_expires_at, health_checked_at, last_success_at, deleted_at, updated_at)
  values(p_owner,p_provider,p_account->>'provider_account_id',p_account->>'account_label','connected',
    array(select jsonb_array_elements_text(p_account->'granted_scopes')),p_account->>'access_token_ciphertext',null,
    (p_account->>'token_expires_at')::timestamptz,clock_timestamp(),clock_timestamp(),null,clock_timestamp())
  on conflict(owner_id,provider_id,provider_account_id) do update set
    account_label=excluded.account_label,status='connected',granted_scopes=excluded.granted_scopes,
    access_token_ciphertext=excluded.access_token_ciphertext,refresh_token_ciphertext=null,
    token_expires_at=excluded.token_expires_at,health_checked_at=excluded.health_checked_at,
    last_success_at=excluded.last_success_at,last_error_code=null,deleted_at=null,updated_at=clock_timestamp()
  returning * into account_row;
  insert into public.integration_consents(owner_id,linked_account_id,scopes,purpose,decision)
    values(p_owner,account_row.id,account_row.granted_scopes,'Read-only launch connector','granted');
  insert into public.integration_audit_events(owner_id,linked_account_id,provider_id,event_type,result,safe_summary)
    values(p_owner,account_row.id,p_provider,'connect','success','OAuth and provider read completed');
  return jsonb_build_object('id',account_row.id,'provider_id',p_provider,'status','connected','account_label',account_row.account_label);
end;
$$;
create or replace function public.disconnect_launch_connector(p_owner uuid,p_provider text,p_account uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  account_row public.integration_linked_accounts%rowtype;
  provider text;
  deletion_id uuid;
begin
  select provider_id into provider from public.integration_linked_accounts where id=p_account and owner_id=p_owner and provider_id=p_provider;
  if not found or provider not in ('outlook','onedrive','sharepoint','ms-teams','notion','linear','slack','salesforce','hubspot') then
    raise exception 'linked_account_not_found';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text || ':' || provider,0));
  select * into account_row from public.integration_linked_accounts where id=p_account and owner_id=p_owner for update;
  -- Expire pending callbacks AND callbacks already exchanging a code.
  update public.integration_oauth_states set expires_at=clock_timestamp() where owner_id=p_owner and provider_id=provider;
  update public.integration_linked_accounts set status='revoked',access_token_ciphertext='deleted',
    refresh_token_ciphertext=null,token_expires_at=null,deleted_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=p_account and owner_id=p_owner;
  update public.integration_sync_jobs set status='cancelled'
    where owner_id=p_owner and linked_account_id=p_account and status in ('queued','leased','running','retry_wait');
  update public.integration_action_approvals set status='denied',decided_at=clock_timestamp()
    where owner_id=p_owner and linked_account_id=p_account and status in ('pending','approved');
  insert into public.integration_deletion_requests(owner_id,linked_account_id,status)
    values(p_owner,p_account,'local_deleted') returning id into deletion_id;
  insert into public.integration_consents(owner_id,linked_account_id,scopes,purpose,decision)
    values(p_owner,p_account,account_row.granted_scopes,'Disconnect launch connector','revoked');
  insert into public.integration_audit_events(owner_id,linked_account_id,provider_id,event_type,result,safe_summary)
    values(p_owner,p_account,provider,'disconnect','success','Local credentials deleted; remote revocation unconfirmed');
  -- Internal only: never serialize the old credential to an HTTP caller.
  return jsonb_build_object('account',to_jsonb(account_row),'deletion_id',deletion_id);
end;
$$;
revoke all on function public.settle_launch_connector(uuid,text,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.disconnect_launch_connector(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.settle_launch_connector(uuid,text,uuid,text,jsonb) to service_role;
grant execute on function public.disconnect_launch_connector(uuid,text,uuid) to service_role;
commit;
