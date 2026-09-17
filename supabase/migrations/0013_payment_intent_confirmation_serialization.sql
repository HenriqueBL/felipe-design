-- Migration 0013: Payment intent / confirmation serialization
-- Objetivo: eliminar a corrida entre record_payment_intent e
-- confirm_order_payment para o MESMO pedido/provider/external_payment_id.
--
-- A migration 0012 tornou record_payment_intent atomico contra si mesmo
-- (ON CONFLICT DO NOTHING), mas a leitura do pedido era feita SEM lock,
-- permitindo que um INSERT de intent acontecesse entre o SELECT do pedido e o
-- INSERT do pagamento dentro de confirm_order_payment, terminando em
-- unique_violation. Esta migration faz record_payment_intent serializar pelo
-- MESMO order row (SELECT ... FOR UPDATE) ja usado por confirm_order_payment:
-- intent primeiro -> confirm espera; confirm primeiro -> intent espera.
--
-- Toda a semantica de 0012 e preservada: validacao do snapshot do pedido,
-- AMOUNT_MISMATCH / CURRENCY_MISMATCH / PAYMENT_ORDER_MISMATCH,
-- INSERT ... ON CONFLICT DO NOTHING, service_role only, SECURITY DEFINER
-- com search_path restrito.

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
  -- Lock do pedido: serializa contra confirm_order_payment (que usa o mesmo
  -- FOR UPDATE no mesmo row) e contra outros intents do mesmo pedido.
  select * into v_order from public.orders where id = p_order_id for update;
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

  -- Insercao atomica e idempotente sob concorrencia: duas chamadas
  -- simultaneas com o mesmo (provider, external_payment_id) nao podem
  -- colidir em unique_violation; a perdedora apenas le a linha existente.
  insert into public.payments (
    order_id, provider, external_payment_id, status, amount_cents, currency
  ) values (
    p_order_id, p_provider, p_external_payment_id, 'pending', p_amount_cents, p_currency
  )
  on conflict (provider, external_payment_id) do nothing
  returning * into v_payment;

  if not found then
    -- Linha existente (inserida por chamada concorrente ou anterior):
    -- valida todos os campos antes de retornar. Nunca atualiza
    -- silenciosamente order_id, amount ou currency.
    select * into v_payment
    from public.payments
    where provider = p_provider and external_payment_id = p_external_payment_id;

    if not found then
      raise exception 'PAYMENT_INSERT_FAILED';
    end if;

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

  return v_payment;
end;
$$;

revoke execute on function public.record_payment_intent(uuid, public.payment_provider, text, integer, public.currency) from public, anon, authenticated;
grant execute on function public.record_payment_intent(uuid, public.payment_provider, text, integer, public.currency) to service_role;