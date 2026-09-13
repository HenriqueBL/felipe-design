# Arquitetura - Felipe Design

> Decisões técnicas da fundação do MVP. Complementa o `docs/project-brief.md` (fonte da verdade do produto).

## Stack

- Next.js 15 (App Router, TypeScript strict) com renderização server-side para SEO.
- Supabase: PostgreSQL, Auth (magic link), Storage e RPCs.
- Vercel para deploy.
- Vitest para testes de regras de negócio; ESLint 9 + eslint-config-next para qualidade.

## Camadas

O fluxo de dados segue uma direção única, para manter a lógica de negócio fora dos componentes React:

1. **Rotas (App Router)** em `src/app`: páginas server-side que carregam dados via services e renderizam.
2. **Server actions** em `src/app/[locale]/dashboard/actions.ts`: validam entrada com Zod, chamam services e revalidam caminhos.
3. **Services** em `src/services`: orquestram acesso ao Supabase (planos, pedidos, configurações) e chamam o domínio puro.
4. **Domínio** em `src/domain`: funções puras e testáveis (dias úteis, tempo com timezone, cálculo de prazo).
5. **Clientes Supabase** em `src/lib/supabase`: browser, server (com cookies) e admin (service role, nunca no frontend).

Regras aplicadas:

- Nenhuma chamada direta ao Supabase dentro de componentes React; tudo passa por services ou actions.
- O servidor é a autoridade final de preço e prazo; o frontend apenas exibe estimativas.
- Sem `any`, sem números mágicos (limites vivem em schemas Zod ou constraints SQL).

## Internacionalização

- Rotas `/en` e `/pt` via segmento dinâmico `src/app/[locale]`; inglês é o padrão (redirecionamento em `src/middleware.ts`).
- Dicionários tipados em `src/lib/i18n`; o dicionário `pt` é validado pelo tipo do `en`, garantindo paridade de chaves.
- `generateMetadata` emite canonical e `hreflang` para as duas línguas.

## Autenticação e autorização

- Supabase Auth com magic link (`signInWithOtp`), troca de código por sessão em `/auth/callback` e logout em `/auth/signout`.
- `src/middleware.ts` atualiza a sessão e protege `/{locale}/dashboard`: exige usuário autenticado com `profiles.role = admin` (consulta ao banco, não apenas esconder páginas).
- RLS no PostgreSQL é a barreira real; ver `docs/database.md`.

## Pagamentos (preparado, não implementado)

- Abstração `PaymentProvider` em `src/services/payment-providers.ts` com registro por provedor; adapters futuros: `StripeProvider`, `MercadoPagoProvider`, `NowPaymentsProvider`.
- Tabelas `payments` e `payment_events` já modelam idempotência: `unique(provider, external_payment_id)` e `unique(provider, provider_event_id)`.

## Configuração e ambiente

- Variáveis em `.env.example`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (somente server) e `NEXT_PUBLIC_SITE_URL`.
- Timezone operacional do sistema vive no banco (`app_settings.timezone`, padrão `America/Sao_Paulo`), nunca na timezone da Vercel.

## Testes

- `tests/` cobre as regras críticas: preço, dias úteis e prazo/cutoff (`npm test`).
- Qualidade: `npm run typecheck` e `npm run lint` com zero erros; `npm run build` gera 17 rotas bilíngues com sucesso.
