# Diretrizes do repositório - Felipe Design

## Estrutura do projeto

- `src/app` - rotas do App Router: `[locale]/` (site bilíngue), `auth/` (callback e signout) e `[locale]/dashboard/` (painel admin).
- `src/components` - componentes React; os de formulário são client components com `useActionState`.
- `src/domain` - lógica pura e testável (dias úteis, tempo com timezone).
- `src/services` - acesso a dados e regras (pricing, queue, plans, orders, settings) e a abstração `PaymentProvider`.
- `src/lib` - infraestrutura: clientes Supabase (server/browser/middleware), i18n, formatação e env.
- `src/types` - tipos do banco espelhando as migrations.
- `supabase/migrations` - schema SQL versionado (0001-0004).
- `tests` - testes Vitest das regras críticas.
- `docs/` - decisões de produto e documentos técnicos; `docs/project-brief.md` é a fonte da verdade.

## Comandos

- `npm run dev` - servidor de desenvolvimento.
- `npm run build` - build de produção (requer variáveis de ambiente, ver `.env.example`).
- `npm run lint` e `npm run typecheck` - qualidade; devem passar com zero erros antes de qualquer commit.
- `npm test` - testes de regras de negócio (pricing, business-days, queue).
- `supabase db push` - aplicar migrations (na ordem 0001-0004).

## Convenções de código

- TypeScript strict, sem `any`. Tipos do banco com `type` aliases no formato do supabase-js (Row/Insert/Update/Relationships).
- Componentes em PascalCase; arquivos em kebab-case; 2 espaços de indentação; linhas até 100 caracteres.
- Lógica de negócio nunca dentro de componentes React: sobe para services ou domínio puro.
- Consultas Supabase centralizadas em `src/services`; embeds (`select("*, rel(*)")`) exigem relacionamentos tipados, então prefira consultas separadas com junção em código.
- Validação de entrada com Zod nas server actions; limites espelhando as constraints SQL.
- Dicionários i18n tipados: `pt` é validado pelo tipo de `en`; qualquer chave nova precisa existir nos dois.

## Commits e pull requests

- Assunto no imperativo com escopo quando ajudar (ex.: `feat: add order deadline calculation`).
- PRs devem declarar problema, solução e verificação executada (testes, typecheck, lint, build).

## Segurança

- Nunca commitar chaves; `service_role` só em código server-side.
- RLS é a barreira real de acesso; nunca confiar apenas no frontend.
- `promised_delivery_date` nunca diminui; mudanças de preço nunca alteram pedidos antigos (snapshot).
