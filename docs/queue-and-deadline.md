# Fila e prazo de entrega - Felipe Design

> Regra de negócio crítica do sistema. Implementada em SQL (`maybe_mark_order_ready`, `create_order`, `estimate_delivery`) como autoridade definitiva, e em TypeScript (`src/services/queue.ts`) apenas para estimativa comercial pré-compra.

## Regra oficial (v3 — migrations 0008–0011)

O prazo definitivo de produção (`promised_delivery_date`) só é calculado e fixado quando o pedido atinge **ready_for_production**, ou seja:

1. pagamento confirmado (`paid_at IS NOT NULL`); **e**
2. intake de source photos finalizado explicitamente pelo cliente (`source_photos_submitted_at IS NOT NULL`, via RPC `submit_source_photos`); **e**
3. cada faca (`knife_index` 1..`knife_quantity`) possui no mínimo `required_source_photos_per_knife` source photos.

Importante: source photos são **INPUT** (material do cliente); `total_images` continua sendo a unidade de workload **OUTPUT** (entregáveis). A condição antiga `source_image_count >= total_images` (v2) foi removida — misturava input e output.

Chegar ao mínimo por faca **não** fecha o intake automaticamente. O cliente precisa clicar **Finish photo submission** (`submit_source_photos`). Depois disso o intake fica read-only (freeze: novos uploads/registers são rejeitados com `INTAKE_CLOSED`). Ambas as ordens de eventos são suportadas: payment → photos → submit, e photos → submit → payment.

A política de upload (min/max por faca, tamanho máximo) é **snapshotada no momento da criação do pedido** (`create_order` copia de `app_settings` para `orders`). Mudanças nos settings admin afetam somente pedidos novos.

Antes disso, `promised_delivery_date` permanece `NULL` e o pedido **não consome capacidade real da fila**. A estimativa comercial exibida antes da compra é apenas informativa e não constitui promessa.

### Conceitos separados

| Conceito | Significado | Persistido? |
|---|---|---|
| `estimated_turnaround` | Estimativa comercial: "X dias úteis após envio completo das fotos". Calculada sob demanda por `estimate_delivery`. | Não |
| `production_ready_at` | Momento exato em que pagamento + fotos completas foram satisfeitos. | Sim (`orders.production_ready_at`) |
| `promised_delivery_date` | Data definitiva de entrega, calculada atomicamente ao entrar na fila. Nunca diminui. | Sim (`orders.promised_delivery_date`) |

### Backlog

`current_backlog_images()` soma `total_images` apenas dos pedidos com:
- status `pending` ou `in_progress`; **e**
- `production_ready_at IS NOT NULL`.

Pedidos pagos mas sem fotos completas não ocupam capacidade.

### Ativação da fila

A função `maybe_mark_order_ready(order_id)` é idempotente e atomiza a transição:

1. Verifica `paid_at IS NOT NULL`, `source_image_count >= total_images` e `production_ready_at IS NULL`.
2. Adquire lock serializador (`SELECT ... FOR UPDATE` em `app_settings`).
3. Calcula backlog atual, dias necessários e `promised_delivery_date`.
4. Grava `production_ready_at` e `promised_delivery_date` atomicamente.
5. Impede recálculo posterior (guarda por `production_ready_at IS NULL`).

É chamada automaticamente em dois momentos:
- **RPC `submit_source_photos`**: imediatamente após gravar `source_photos_submitted_at` (caso pagamento já tenha ocorrido).
- **RPC `confirm_order_payment`**: imediatamente após gravar `paid_at` (caso o intake já estivesse finalizado antes do pagamento).

A ordem dos eventos (pagamento antes/depois das fotos) não importa; a ativação ocorre exatamente uma vez.

### Cutoff e timezone

Horário de corte (`app_settings.cutoff_time`, padrão 17:00) na timezone operacional (`app_settings.timezone`, padrão `America/Sao_Paulo`): se a ativação ocorrer em dia útil após o corte, ou em dia não útil, a contagem começa no próximo dia útil.

## Concorrência

Dois pedidos podem ficar ready_for_production quase simultaneamente. O lock serializador em `app_settings` garante que cada um veja o backlog consistente (incluindo os já ativados na mesma transação). O efeito prático: o segundo pedido recebe um prazo que conta com o primeiro na fila, mesmo que ambos tenham sido ativados no mesmo instante.

## create_order

A RPC `create_order` grava `promised_delivery_date` como `NULL`. O preço, quantidade de imagens e idempotência são resolvidos atomicamente na criação, mas o prazo definitivo depende da ativação posterior.

## estimate_delivery (pré-compra)

Retorna `{ businessDaysAfterReady, currentBacklogImages }` — quantos dias úteis de produção serão necessários **após** o pedido ficar ready. Não retorna data absoluta porque o prazo definitivo ainda não existe. A UI exibe essa estimativa como "X dias úteis após o envio completo das fotos".

## Feriados e bloqueios

A implementação TypeScript aceita `blockedDates` (datas ISO) em todas as funções de calendário; a SQL valida apenas segunda a sexta por enquanto. Adicionar feriados/férias no futuro é uma extensão de dados (tabela de dias bloqueados + parâmetro para as funções SQL), sem mudança de arquitetura.

## Testes

- `tests/queue.test.ts`: cobre `estimateTurnaroundAfterReady` (backlog vazio, backlog existente, várias imagens, capacidade atingida, mudança de capacidade, dois pedidos quase simultâneos, configurações inválidas).
- `tests/business-days.test.ts`: cobre o calendário de dias úteis, incluindo rejeição de datas inexistentes.
- `tests/checkout.test.ts`: cobre parseCheckoutParams, isSafeNextPath, resolveCurrency, validateUploadFile, deriveOrderDisplayState, canRequestRevision, sanitizeFileName, buildUploadPath/buildResultPath, buildCheckoutPath.
- Testes de integração da regra production_ready (pagamento antes/depois das fotos, concorrência, idempotência) são validados via Supabase real durante o smoke test ponta a ponta.