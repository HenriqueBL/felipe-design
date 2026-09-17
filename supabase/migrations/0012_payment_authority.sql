-- Migration 0012: Payment Authority (P0)
-- Objetivo: eliminar a capacidade de um cliente autenticado auto-confirmar
-- pagamento; validar definitivamente valor/moeda contra o snapshot do pedido;
-- tornar replay de eventos/pagamentos seguro entre pedidos.
--
-- Authority: confirm_order_payment e record_payment_intent passam a ser
-- executaveis SOMENTE por service_role. Nenhum cliente (anon/authenticated)
-- pode chamar essas RPCs diretamente; a autorizacao do dono do pedido
-- acontece na camada de server actions antes do uso do admin client.

-- ============ record_payment_intent ============
-- Valida: pedido existe, amount == orders.total_cents,
-- currency == orders.currency e pagamento existente com o mesmo
-- (provider, external_payment_id) pertence ao MESMO pedido.

create or replace function public.record_payment_intent(
  p_order_id uuid,
  p_provider public.payment_provider,
  p_external_payment_id text,
  p_amount_cents integer,
  p_currency public.currency
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_payment public.payments;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'AMOUNT_MISMATCH';
  end if;
  if p_amount_cents <> v_order.total_cents then
    raise exception 'AMOUNT_MISMATCH';
  end if;
  if p_currency is distinct from v_order.currency then
    raise exception 'CURRENCY_MISMATCH';
  end if;

  select * into v_payment
  from public.payments
  where provider = p_provider and external_payment_id = p_external_payment_id;

  if found then
    if v_payment.order_id <> p_order_id then
      raise exception 'PAYMENT_ORDER_MISMATCH';
    end if;
    if v_payment.amount_cents <> p_amount_cents then
      raise exception 'AMOUNT_MISMATCH';
    end if;
    if v_payment.currency is distinct from p_currency then
      raise exception 'CURRENCY_MISMATCH';
    end if;
    return v_payment;
  end if;

  insert into public.payments (
    order_id, provider, external_payment_id, status, amount_cents, currency
  ) values (
    p_order_id, p_provider, p_external_payment_id, 'pending', p_amount_cents, p_currency
  )
  returning * into v_payment;

  return v_payment;
end;
$$;

revoke execute on function public.record_payment_intent(uuid, public.payment_provider, text, integer, public.currency) from public, anon, authenticated;
grant execute on function public.record_payment_intent(uuid, public.payment_provider, text, integer, public.currency) to service_role;

-- ============ confirm_order_payment ============
-- Somente service_role. Serializa confirmacoes concorrentes do mesmo pedido
-- (SELECT ... FOR UPDATE), valida amount/currency contra o snapshot do
-- pedido, bloqueia replay de pagamento/evento apontando para outro pedido e
-- so grava paid_at apos TODAS as validacoes. processed_at marca o evento
-- apenas quando processado com sucesso.

create or replace function public.confirm_order_payment(
  p_order_id uuid,
  p_provider public.payment_provider,
  p_external_payment_id text,
  p_provider_event_id text,
  p_amount_cents integer,
  p_currency public.currency
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_payment public.payments;
  v_event public.payment_events;
  v_event_payload jsonb;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'AMOUNT_MISMATCH';
  end if;

  -- Lock do pedido: serializa confirmacoes concorrentes.
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  -- Validacao do snapshot: valor e moeda vindos do provedor devem ser
  -- exatamente os gravados no pedido no momento da criacao.
  if p_amount_cents <> v_order.total_cents then
    raise exception 'AMOUNT_MISMATCH';
  end if;
  if p_currency is distinct from v_order.currency then
    raise exception 'CURRENCY_MISMATCH';
  end if;

  -- Pagamento ja registrado com este (provider, external_payment_id)?
  select * into v_payment
  from public.payments
  where provider = p_provider and external_payment_id = p_external_payment_id;

  if found then
    if v_payment.order_id <> p_order_id then
      raise exception 'PAYMENT_ORDER_MISMATCH';
    end if;
    if v_payment.amount_cents <> p_amount_cents then
      raise exception 'AMOUNT_MISMATCH';
    end if;
    if v_payment.currency is distinct from p_currency then
      raise exception 'CURRENCY_MISMATCH';
    end if;
  end if;

  -- Evento ja registrado com este (provider, provider_event_id)?
  v_event_payload := jsonb_build_object(
    'order_id', p_order_id,
    'external_payment_id', p_external_payment_id,
    'amount_cents', p_amount_cents,
    'currency', p_currency
  );

  select * into v_event
  from public.payment_events
  where provider = p_provider and provider_event_id = p_provider_event_id;

  if found then
    -- Replay somente e idempotente se os dados forem equivalentes.
    if v_event.payload is distinct from v_event_payload then
      raise exception 'PAYMENT_EVENT_MISMATCH';
    end if;
  end if;

  -- Todas as validacoes passaram: grava o evento (se novo).
  if not found then
    insert into public.payment_events (provider, provider_event_id, payload)
    values (p_provider, p_provider_event_id, v_event_payload);
  end if;

  -- Pagamento idempotente por (provider, external_payment_id).
  if v_payment.id is null then
    insert into public.payments (
      order_id, provider, external_payment_id, provider_event_id,
      status, amount_cents, currency, raw_metadata
    ) values (
      p_order_id, p_provider, p_external_payment_id, p_provider_event_id,
      'paid', p_amount_cents, p_currency, jsonb_build_object('order_id', p_order_id)
    );
  elsif v_payment.status <> 'paid' then
    update public.payments
    set status = 'paid',
        provider_event_id = p_provider_event_id,
        updated_at = now()
    where id = v_payment.id;
  end if;

  -- Primeira confirmacao: grava paid_at e tenta ativar a fila.
  if v_order.paid_at is null then
    update public.orders
    set paid_at = now(),
        updated_at = now()
    where id = p_order_id
    returning * into v_order;

    perform public.maybe_mark_order_ready(p_order_id);

    select * into v_order from public.orders where id = p_order_id;
  end if;

  -- Evento processado com sucesso.
  update public.payment_events
  set processed_at = now()
  where provider = p_provider and provider_event_id = p_provider_event_id;

  return v_order;
end;
$$;

revoke execute on function public.confirm_order_payment(uuid, public.payment_provider, text, text, integer, public.currency) from public, anon, authenticated;
grant execute on function public.confirm_order_payment(uuid, public.payment_provider, text, text, integer, public.currency) to service_role;