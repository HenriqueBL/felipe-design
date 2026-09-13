# Fila e prazo de entrega - Felipe Design

> Regra de negócio crítica do sistema. Implementada duas vezes de forma idêntica: `src/services/queue.ts` (TypeScript puro, pré-compra) e `public.create_order`/`estimate_delivery` (SQL, autoridade no momento da compra).

## Regra

- Capacidade diária configurável (`app_settings.daily_capacity`, padrão 4).
- Dias necessários = `ceil((backlog + imagens do novo pedido) / capacidade)`.
- Prazo = primeiro dia de produção + (dias necessários - 1), avançando apenas dias úteis (segunda a sexta).
- Backlog = soma de `total_images` dos pedidos com status `pending` ou `in_progress`.
- Horário de corte (`app_settings.cutoff_time`, padrão 17:00) na timezone operacional (`app_settings.timezone`, padrão `America/Sao_Paulo`): pagamento confirmado em dia útil após o corte, ou em dia não útil, começa no próximo dia útil.

O prazo é calculado antes do pagamento (estimativa), gravado no pedido como `promised_delivery_date` na confirmação e nunca diminui automaticamente depois; mudanças de capacidade só afetam pedidos futuros.

## Concorrência

Dois clientes podem fechar pedidos quase ao mesmo tempo. A RPC `create_order` resolve isso no banco:

1. `select * from app_settings where id = 1 for update` serializa as transações concorrentes na mesma linha.
2. Cada pedido calcula o backlog já incluindo os pedidos confirmados antes dele, dentro da mesma transação.
3. O insert do pedido e o cálculo do prazo são atômicos.

O efeito prático: o segundo pedido recebe um prazo que conta com o primeiro na fila, mesmo que ambos tenham sido criados no mesmo instante. Teste equivalente cobre o cálculo acumulado em `tests/queue.test.ts`.

## Feriados e bloqueios

A implementação TypeScript aceita `blockedDates` (datas ISO) em todas as funções de calendário; a SQL valida apenas segunda a sexta por enquanto. Adicionar feriados/férias no futuro é uma extensão de dados (tabela de dias bloqueados + parâmetro para as funções SQL), sem mudança de arquitetura.

## Testes

`tests/queue.test.ts` (13 casos) cobre: backlog vazio, backlog existente, 1 imagem, várias imagens, capacidade atingida, sexta/sábado/domingo, pagamento antes/depois do corte, mudança de capacidade, dois pedidos quase simultâneos, dias bloqueados e configurações inválidas. `tests/business-days.test.ts` (9 casos) cobre o calendário, incluindo rejeição de datas inexistentes (ex.: 30 de fevereiro).
