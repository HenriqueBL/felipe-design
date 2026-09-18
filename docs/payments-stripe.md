# Stripe Payments (Hosted Checkout)

## Arquitetura

Stripe Checkout hospedado (server-side). O browser envia apenas `orderId` e
`locale` à Server Action `startStripePaymentAction`; valor e moeda vêm
exclusivamente do snapshot do pedido (`orders.total_cents` / `orders.currency`)
carregado via Supabase autenticado (RLS protege acesso). A confirmacao
autoritativa acontece SOMENTE via webhook assinado, chamando
`confirm_order_payment` com o amount/currency REPORTADOS PELA STRIPE.

- Provider: `src/services/stripe-payment.ts` (`StripePaymentProvider`,
  server-only, Stripe SDK 22.6.2, client injetavel para testes)
- Fluxo: `src/services/stripe-payment-flow.ts` (`startStripeCheckout`)
- Server Action: `src/app/[locale]/account/stripe-payment.ts`
- Webhook: `POST /api/payments/stripe/webhook` (publico, signature-only)
- UI: `src/components/account/stripe-payment-button.tsx`

## Env vars

- `STRIPE_SECRET_KEY` (server-only; nunca NEXT_PUBLIC)
- `STRIPE_WEBHOOK_SECRET` (server-only)
- `NEXT_PUBLIC_SITE_URL` (base para success/cancel URLs)

Inicializacao lazy: build passa sem credenciais; erro `CONFIGURATION` so
ocorre quando a funcionalidade e executada.

## External payment ID

Checkout Session ID (`cs_...`) — registrado no `record_payment_intent` e
reconciliado no `confirm_order_payment`. Nunca PaymentIntent ID.

## Idempotencia e sessoes duplicadas

- Idempotency key deterministica: `checkout_{orderId}_{n}`, onde `n` e o
  numero de pagamentos Stripe anteriores do pedido. Cliques duplos/concorrentes
  comparam na MESMA chave: o Stripe devolve a mesma sessao.
- Reuso: ao clicar Pay novamente, o servico busca pagamentos Stripe pendentes,
  recupera a Checkout Session e devolve a URL se `status=open`.
- `status=complete` + `payment_status=paid`: a acao retorna
  `PAYMENT_ALREADY_COMPLETED` (order.paid_at ja bloqueia antes).
- `status=expired` ou sessao inacessivel: nova tentativa com nova chave
  (`_n+1`).
- `record_payment_intent` serializa via `SELECT ... FOR UPDATE` no pedido.

## Webhook

- Raw body lido UMA vez antes de qualquer parse; assinatura verificada com
  `stripe.webhooks.constructEvent` usando `STRIPE_WEBHOOK_SECRET`.
- Eventos tratados: `checkout.session.completed` (paid somente se
  `payment_status === "paid"`), `async_payment_succeeded` (paid),
  `async_payment_failed` e `expired` (nao-pago, ignorados).
- Reconciliacao: `client_reference_id` E `metadata.order_id`; divergencia
  rejeita o evento. Amount ausente/invalido, currency nao-BRL/USD ou order
  ausente: nao confirma (200, ignorado).
- Respostas: assinatura invalida/ausente 400; evento irrelevante 200;
  falha de confirmacao 500 (Stripe reenvia). Replay e idempotente na RPC.
- Refund NAO implementado (politica comercial pendente). Pix e opcional,
  habilitado via Stripe Dashboard quando a conta for elegivel.

## Nao-paid behavior

Eventos failed/expired nao alteram `payments.status` (exigiria nova RPC —
documentado como follow-up, sem migration). Nenhum redirect de success
confirma pagamento; a pagina mostra apenas "payment submitted".

## Configuracao manual (ACCOUNT ACTION REQUIRED)

1. Criar/confirmar conta Stripe (TEST mode)
2. Obter test secret key -> `STRIPE_SECRET_KEY`
3. Criar webhook endpoint test: `https://<dominio>/api/payments/stripe/webhook`
   (eventos: os quatro checkout.session.* acima)
4. Copiar signing secret -> `STRIPE_WEBHOOK_SECRET`
5. Habilitar metodos de pagamento no Dashboard (card primeiro; Pix depois)
6. Repetir em LIVE mode SOMENTE no go-live (nunca commitar secrets)

## Test vs live

Testes unit usam mocks (sem internet/conta). Nenhuma chave real no repo;
`.env.example` contem apenas placeholders. Live mode nao suportado nesta
frente.

## Troubleshooting

- Webhook retorna 400: verificar `STRIPE_WEBHOOK_SECRET` e header
  `Stripe-Signature` (nao logar valores).
- Acao retorna CONFIGURATION: verificar `STRIPE_SECRET_KEY` no env do servidor.
- Pedido pago mas UI ainda unpaid: webhook pode nao ter sido entregue;
  verificar Dashboard > Webhooks; revalidacao e best-effort.