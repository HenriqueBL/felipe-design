-- Migration 0015: Payment failure authority (webhook-lag duplicate charge fix)
-- Objetivo: permitir que o webhook registre transicoes terminais NAO pagas
-- (async_payment_failed, expired) na tabela payments via RPC service_role-only,
-- sem espalhar writes financeiros em route handlers.
--
-- Contrato:
-- - SECURITY DEFINER, search_path restrito, service_role only.
-- - Idempotente: reprocessar o mesmo evento nao causa efeito duplicado
--   (payment_events por (provider, provider_event_id)).
-- - Nunca rebaixa status 'paid'/'refunded' para 'failed'.
-- - Nunca altera amount/currency/order_id de um pagamento existente.
-- - Nunca altera orders.paid_at (confirmacao continua sendo exclusividade de
--   confirm_order_payment).
-- - Valida que o pagamento (provider, external_payment_id) pertence ao
--   p_order_id informado: nunca muta pagamento de outro pedido.
-- - Lock do pedido (SELECT ... FOR UPDATE) para serializar contra
--   record_payment_intent / confirm_order_payment.

create or replace function public.record_payment_failure(
  p_order_id uuid,
  p_provider public.payment_provider,
  p_external_payment_id text,
  p_provider_event_id text
)
returns public.payments
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
  -- Lock do pedido: serializa contra record_payment_intent e
  -- confirm_order_payment (mesmo FOR UPDATE no mesmo row).
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  -- Pagamento deve existir e pertencer ao pedido informado.
  select * into v_payment
  from public.payments
  where provider = p_provider and external_payment_id = p_external_payment_id;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;
  if v_payment.order_id <> p_order_id then
    raise exception 'PAYMENT_ORDER_MISMATCH';
  end if;

  -- Replay-safe por provider event id: payload equivalente => no-op.
  v_event_payload := jsonb_build_object(
    'order_id', p_order_id,
    'external_payment_id', p_external_payment_id,
    'status', 'failed'
  );

  select * into v_event
  from public.payment_events
  where provider = p_provider and provider_event_id = p_provider_event_id;

  if found then
    if v_event.payload is distinct from v_event_payload then
      raise exception 'PAYMENT_EVENT_MISMATCH';
    end if;
    -- Replay idempotente: retorna o estado atual sem nova escrita.
    return v_payment;
  end if;

  -- Nunca rebaixa pagamento confirmado: paid/refunded sao terminais pagos.
  -- Registra o evento para o replay, mas nao altera o pagamento.
  if v_payment.status in ('paid', 'refunded') then
    insert into public.payment_events (provider, provider_event_id, payload)
    values (p_provider, p_provider_event_id, v_event_payload);
    return v_payment;
  end if;

  insert into public.payment_events (provider, provider_event_id, payload)
  values (p_provider, p_provider_event_id, v_event_payload);

  update public.payments
  set status = 'failed',
      provider_event_id = p_provider_event_id,
      updated_at = now()
  where id = v_payment.id
  returning * into v_payment;

  return v_payment;
end;
$$;

revoke execute on function public.record_payment_failure(uuid, public.payment_provider, text, text) from public, anon, authenticated;
grant execute on function public.record_payment_failure(uuid, public.payment_provider, text, text) to service_role;