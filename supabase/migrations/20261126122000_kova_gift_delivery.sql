alter table kova_private.usage_credit_orders
  add column gift_delivery jsonb,
  add column delivery_state text check (delivery_state in ('sending','accepted','review')),
  add column delivery_claimed_at timestamptz;

create function public.kova_set_gift_delivery(p_id uuid,p_buyer uuid,p_env text,p_delivery jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update kova_private.usage_credit_orders set gift_delivery=p_delivery
    where id=p_id and buyer=p_buyer and environment=p_env and gift
      and funded_at is null and gift_delivery is null;
  return found or exists(select 1 from kova_private.usage_credit_orders
    where id=p_id and buyer=p_buyer and environment=p_env and gift
      and (gift_delivery=p_delivery or (delivery_state is not null and funded_at is not null)));
end $$;

create function public.kova_take_gift_delivery(p_id uuid,p_env text)
returns jsonb language sql security definer set search_path='' as $$
  update kova_private.usage_credit_orders set delivery_state='sending',delivery_claimed_at=now()
    where id=p_id and environment=p_env and gift and funded_at is not null
      and refunded_cents<amount_cents and not disputed and claimed_at is null
      and gift_delivery is not null and delivery_state is null
    returning gift_delivery || jsonb_build_object('code',gift_code);
$$;

create function public.kova_finish_gift_delivery(p_id uuid,p_env text,p_accepted boolean)
returns void language sql security definer set search_path='' as $$
  update kova_private.usage_credit_orders
    set delivery_state=case when p_accepted then 'accepted' else 'review' end,gift_delivery=null
    where id=p_id and environment=p_env and delivery_state='sending';
$$;

revoke all on function public.kova_set_gift_delivery(uuid,uuid,text,jsonb),
  public.kova_take_gift_delivery(uuid,text), public.kova_finish_gift_delivery(uuid,text,boolean)
  from public,anon,authenticated;
grant execute on function public.kova_set_gift_delivery(uuid,uuid,text,jsonb),
  public.kova_take_gift_delivery(uuid,text), public.kova_finish_gift_delivery(uuid,text,boolean)
  to service_role;
