# Payment Gateway Readiness

Preparacao para integrar um gateway real de pagamentos. Auditado em 2026-09-16 no branch `chore/payment-gateway-prep`. Nenhum provider especifico foi escolhido — decisao humana pendente.

## Estado atual

### O que existe e esta pronto

- **`PaymentProvider` abstraction** (`src/services/payment-providers.ts`): interface com `createPaymentIntent` e `parseWebhookEvent`, registry pattern (`registerPaymentProvider` / `getPaymentProvider`), tipos `WebhookPaymentStatus`, `CreatePaymentIntentInput`, `PaymentIntentResult`, `ProviderWebhookEvent`.
- **Mock provider** (`src/services/mock-payment.ts`): implementa a interface completa; guardado por `ENABLE_MOCK_PAYMENTS=true` (apenas desenvolvimento).
- **`simulateMockPayment`** (`src/services/mock-payment-flow.ts`): reproduz o ciclo real — `createPaymentIntent` -> RPC `record_payment_intent` (intencao) -> RPC `confirm_order_payment` (webhook simulado). Idempotente por pedido (`paid_at !== null` retorna cedo).
- **`create_order` RPC** (migrations 0006/0008): preco e moeda autoritativos no servidor; snapshot de preco em `orders` (`unit_price_cents`, `subtotal_cents`, `total_cents`, `currency`); idempotencia por `idempotency_key`; snapshot da politica de upload.
- **`confirm_order_payment` RPC**: idempotente por `(provider, external_payment_id)` (unique constraint + upsert) e por `(provider, provider_event_id)` em `payment_events`; grava `paid_at`, chama `maybe_mark_order_ready` (prazo nunca diminui).
- **BRL/USD**: enum `currency` com `plan_prices` por moeda (precos independentes), `defaultCurrencyForLocale` (pt->BRL, en->USD), override por query param validado por Zod.
- **Readiness (v3)**: `paid_at` + `source_photos_submitted_at` + minimos por faca; ambos os fluxos (pagamento->fotos e fotos->pagamento) testados em `tests/integration/production-ready.test.ts`.
- **Testes**: unit (Vitest) para pricing/checkout/queue; integracao cobrindo `confirm_order_payment` idempotente, concorrente, e ambos os fluxos de readiness.

### O que falta (gaps)

1. **Nenhuma rota de webhook.** `src/app/api` contem apenas `delivery-estimate`. A interface `parseWebhookEvent` existe mas **nunca e chamada em producao** — nenhum endpoint HTTP recebe eventos do gateway.
2. **Enums do banco.** `payment_provider` enum nasce com `stripe|mercadopago|nowpayments` (0001) e 'mock' e adicionado em 0005; adicionar um provider novo exige migration `alter type ... add value` (fora do escopo desta sessao).
3. **Sem verificacao de assinatura real.** O mock valida apenas shape do payload; nao ha verificacao HMAC/timestamp/replay para um provider real.
4. **Sem checagem de amount/currency no webhook path.** `confirm_order_payment` confia nos parametros recebidos; o fluxo real precisa comparar `p_amount_cents`/`p_currency` contra o snapshot do pedido antes de marcar pago (hoje o mock sempre passa o valor do proprio pedido, mascarando o gap).
5. **Sem tratamento de failed/cancelled/refunded.** `WebhookPaymentStatus` define os estados, mas nenhuma RPC transiciona `payments.status` para `failed`/`refunded` nem reverte `paid_at`.
6. **Sem reconciliacao.** Nenhum job/funcao consulta o gateway para pedidos `pending` antigos.
7. **Sem URL de checkout real.** `successUrl`/`cancelUrl` sao placeholders (`"/mock"`).
8. **Logging de pagamento inexistente** alem de `payment_events.payload`.

## Interface necessaria (o que qualquer provider real deve implementar)

Um provider real implementa `PaymentProvider` e adiciona:

- `createPaymentIntent`: cria checkout no gateway com amount/currency **do snapshot do pedido**, `externalPaymentId`, `checkoutUrl` real; deve suportar BRL (clientes brasileiros) e USD (internacionais).
- `parseWebhookEvent(rawBody, headers)`: **verifica assinatura** (HMAC + timestamp, rejeitar replay/clock skew), extrai `eventId`, `externalPaymentId`, `status`, `metadata` incluindo `orderId`.
- Erros de assinatura devem lancar excecao distinta (400 ao chamador).
- Segredos via env vars, nunca no frontend; log sem segredos nem PII.

### Camada de aplicacao (independente de provider)

- Rota webhook `src/app/api/webhooks/[provider]/route.ts`: le raw body, resolve provider no registry, valida assinatura, mapeia `metadata.order_id`, e antes de chamar `confirm_order_payment` **valida amount e currency contra o snapshot do pedido** (amount mismatch -> log + nao confirma; resposta 200 ou 4xx conforme semantica do provider — decisao de implementacao).
- Estados `failed`/`cancelled`: nova RPC ou extensao que grava o status em `payments` sem tocar `paid_at` se ja pago.
- Reconciliacao: tarefa periodica (ou trigger manual admin) consultando o gateway para pagamentos `pending` nao confirmados.
- Retries: responder rapido ao gateway; idempotencia existente absorve duplicatas.

## Decisoes humanas pendentes

1. **Escolha do provider** (ver criterios abaixo). Nao decidir por preferencia tecnica.
2. **Quantos providers**: um unico cobrindo BRL+USD, ou dois (um BR, um internacional)? Impacta taxas, complexidade de webhook e reconciliacao.
3. **Semantica de amount mismatch**: rejeitar webhook (4xx) vs. aceitar e alertar.
4. **Refunds**: suportados no escopo v1 do gateway ou manual via dashboard do provider?
5. **Prazo de corte vs. horario do webhook**: `paid_at` e o momento do nosso processamento ou do evento do gateway? (Afeta cutoff de producao.)

## Criterios para escolher provider

Obrigatorios (eliminatorios):

- Checkout/pagamento em **BRL** com meios brasileiros (Pix no minimo; cartao nacional) **e** em **USD** para internacionais — com cobranca no pais correspondente, sem conversao imposta.
- Webhooks com **assinatura verificavel** (HMAC), event ID para idempotencia, e retry automatico.
- Pagina de checkout hospedada pelo provider (PCI scope minimo).
- API para consulta de status (reconciliacao).
- Chaves de API com escopo segregado (secret separada de publishable).

Desejaveis:

- Sandbox/test mode completo com webhooks simulados.
- Idempotency key no endpoint de criacao de pagamento.
- Refunds via API.
- Documentacao de webhook com raw body exato para verificacao de assinatura.

**Atencao**: precos, taxas por moeda/meio, disponibilidade atual de Pix internacional, e requisitos de conta (ex.: CNPJ, endereco no pais) **exigem pesquisa atualizada (setembro/2026) antes da decisao** — nao confiar em valores de memoria. Candidatos a pesquisar: Stripe, Mercado Pago, Pagar.me, dLocal, NowPayments (ja previstos no enum inicial) — lista nao exaustiva.

## Arquitetura — arquivos esperados a mudar

Mantendo a `PaymentProvider` abstraction e o mock intactos, sem espalhar regras do gateway em componentes React:

- `src/services/payment-providers.ts` — possivelmente estender `ProviderWebhookEvent` (raw event persistido) e tipos de erro de assinatura.
- `src/services/<provider>-payment.ts` — **novo**: implementacao real.
- `src/app/api/webhooks/<provider>/route.ts` — **novo**: endpoint webhook (server-only, raw body, sem locale).
- `src/app/[locale]/checkout/actions.ts` (ou equivalente) — criar intent real em vez de simular; redirect para `checkoutUrl`.
- `src/services/mock-payment-flow.ts` / `src/services/mock-payment.ts` — **nao remover**; mock continua para dev/testes.
- `src/types/database.ts` — refletir novos estados/valores do enum (apos migration).
- Migrations (sessao futura): `alter type payment_provider add value`, RPC de failed/cancelled, validacao amount/currency dentro de `confirm_order_payment` (defensiva no banco, nao so na app).
- `tests/integration/*` e `tests/e2e/*` — casos do plano de testes abaixo.
- `.env.example` — novas variaveis do provider.

## Plano de implementacao (proposto, nao executado)

1. Decisao humana do provider (+ pesquisa de taxas/requisitos atualizada).
2. Migration: enum + RPC de validacao amount/currency + status failed/cancelled.
3. Provider real + webhook route + checkout action real.
4. Reconciliacao (admin ou cron).
5. Testes de integracao/e2e conforme abaixo.
6. Rollout com `ENABLE_MOCK_PAYMENTS=false` em producao apenas no final.

## Plano de testes

| Caso | Verificacao |
|---|---|
| Successful payment | webhook assinado -> `paid_at` set, `payments.status='paid'`, deadline calculado |
| Duplicate webhook | mesmo `provider_event_id` reenviado -> sem duplicacao, mesma resposta (idempotente) |
| Invalid signature | assinatura errada/ausente -> 400, nenhuma mutacao |
| Delayed webhook | pagamento confirmado depois do cutoff -> prazo usa `paid_at` real (regra de cutoff) |
| Amount mismatch | webhook com valor != snapshot -> nao marca pago, alerta |
| Currency mismatch | BRL vs USD divergente -> nao marca pago |
| Already paid | reconfirmacao de pedido pago -> sem novo pagamento, prazo inalterado |
| Payment-before-photos | pago primeiro -> `promised_delivery_date` NULL ate submit das fotos |
| Photos-before-payment | fotos primeiro -> ativacao imediata ao confirmar pagamento |
| Mock regression | `ENABLE_MOCK_PAYMENTS=true` continua funcionando apos integracao |

## Riscos

- **Amount trust gap**: sem validacao no banco, um bug na camada do webhook marca pedidos pagos com valor errado. Mitigar com validacao dentro de `confirm_order_payment`.
- **Enum migration**: `alter type add value` nao e transacional em versoes antigas do Postgres; planejar deploy.
- **Webhook publico**: primeira rota publica sem auth de sessao — superficie de ataque nova; assinatura e a unica barreira.
- **Dual currency**: erro de moeda em preco (BRL 7500 vs USD 3500) causa cobranca errada silenciosa se amount nao validado.
- **Cutoff/delayed webhooks**: pagamento aprovado as 16:59 confirmado as 17:30 muda o dia de producao — decidir semantica explicitamente.

## Checklist de prontidao

- [x] Abstracao `PaymentProvider` com registry
- [x] Mock provider e ciclo completo (intent -> confirm)
- [x] Idempotencia de eventos e pagamentos (constraints + upsert)
- [x] Snapshot de preco/moeda no pedido
- [x] BRL/USD independentes com selecao por locale
- [x] Readiness dual-flow testado
- [ ] Rota de webhook HTTP publica
- [ ] Verificacao de assinatura
- [ ] Validacao amount/currency no confirmation path
- [ ] Estados failed/cancelled/refunded
- [ ] Reconciliacao
- [ ] Provider real escolhido (decisao humana)
- [ ] Env vars do provider documentadas
