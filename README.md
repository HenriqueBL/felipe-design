# Felipe Design

Portfólio e plataforma de contratação de serviços de design de cutelaria do profissional Felipe. Site bilíngue (EN / PT-BR) com vitrine de trabalhos, pedidos de edição de facas com prazo automático e painel administrativo.

## Estado atual

Fundação técnica do MVP implementada: Next.js 15 bilíngue (`/en`, `/pt`), autenticação por magic link, schema PostgreSQL completo com RLS, motor de preço e de fila/prazo com testes, painel administrativo mínimo e build de produção passando (17 rotas). Pagamentos, upload de fotos e portfólio dinâmico ficam para as próximas etapas.

- [docs/project-brief.md](docs/project-brief.md) - fonte da verdade do produto.
- [docs/architecture.md](docs/architecture.md) - camadas, decisões técnicas e convenções.
- [docs/database.md](docs/database.md) - schema, RLS, storage e RPCs.
- [docs/queue-and-deadline.md](docs/queue-and-deadline.md) - regra de prazo, cutoff e concorrência.
- [docs/decisoes-pendentes.md](docs/decisoes-pendentes.md) - decisões abertas que viram requisitos confirmados.
- [AGENTS.md](AGENTS.md) - guia de contribuição do repositório.

## O que o site entrega (visão completa)

- Vitrine de portfólio com comparações Antes/Depois, gerenciada pelo painel.
- Planos de 1, 2 ou 3 ângulos por faca, com preços BRL/USD geridos pelo painel (sem hardcode; pedidos antigos preservam o preço praticado).
- Prazo de entrega automático em dias úteis (capacidade 4 edições/dia, horário de corte e timezone configuráveis), exibido antes e depois da compra.
- Guia de envio de fotos liberado após o pagamento e área de upload para o cliente.
- Estados do pedido: Pendente, Em andamento, Concluído; 1 rodada de revisão gratuita.
- Pagamentos planejados com Stripe (cartão internacional), Mercado Pago (PIX/cartão) e NowPayments (cripto).
- Sistema de afiliados com código exclusivo, comissão registrada e percentual configurável.

## Stack

Next.js 15 + TypeScript strict + Supabase (PostgreSQL, Auth com magic link, Storage) + Vercel. Testes com Vitest; qualidade com ESLint 9.

## Desenvolvimento

```bash
npm install
cp .env.example .env   # preencha as variáveis do Supabase
npm run dev
```

Verificações: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`. Migrations em `supabase/migrations` (aplicar na ordem 0001-0004).

## Como contribuir

Siga as convenções de estrutura, estilo e commit descritas no [AGENTS.md](AGENTS.md).
